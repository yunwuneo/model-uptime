import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, probe, sseData } from '../server/probe.js';
import { fixture } from './fixtures.js';

const credentials = { apiKey: 'fixture-secret-not-a-real-key', headers: {} };
function streaming(events: unknown[], end = false): typeof fetch {
  return (async () =>
    new Response(
      new ReadableStream({
        async start(controller) {
          for (const event of events) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
            await new Promise((resolve) => setTimeout(resolve, 8));
          }
          if (end) controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    )) as typeof fetch;
}
function json(value: unknown, status = 200): typeof fetch {
  return (async () => Response.json(value, { status })) as typeof fetch;
}
test('protocol URLs, auth headers and small request bodies', () => {
  const chat = buildRequest(fixture(), credentials);
  assert.equal(chat.url, 'https://api.example.com/v1/chat/completions');
  assert.equal(chat.body.max_tokens, 32);
  assert.equal(chat.body.stream_options.include_usage, true);
  assert.equal(chat.headers.Authorization, `Bearer ${credentials.apiKey}`);
  const anthropic = buildRequest(
    fixture({ provider: 'anthropic', endpoint: 'messages' }),
    credentials,
  );
  assert.equal(anthropic.headers['x-api-key'], credentials.apiKey);
  assert.equal(anthropic.headers['anthropic-version'], '2023-06-01');
  const gemini = buildRequest(
    fixture({ provider: 'gemini', endpoint: 'generate', baseUrl: 'https://example.com/v1beta' }),
    credentials,
  );
  assert.match(gemini.url, /:streamGenerateContent\?alt=sse$/);
  assert.equal(gemini.headers['x-goog-api-key'], credentials.apiKey);
  assert.equal(gemini.body.stream, undefined);
  assert.equal(gemini.body.generationConfig.maxOutputTokens, 32);
});
test('recursive request overrides and modern Chat token cap', () => {
  const r = buildRequest(
    fixture({
      body: {
        stream: false,
        max_completion_tokens: 16,
        stream_options: { include_obfuscation: false },
      },
    }),
    credentials,
  );
  assert.equal(r.body.stream, true);
  assert.equal(r.body.max_tokens, undefined);
  assert.equal(r.body.max_completion_tokens, 16);
  assert.equal(r.body.stream_options.include_usage, true);
});
test('SSE supports byte splits, UTF-8, CRLF, comments and multi-line data', async () => {
  const bytes = new TextEncoder().encode(
    ': heartbeat\r\n\r\ndata: {"text":\r\ndata: "中文"}\r\n\r\n',
  );
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const byte of bytes) c.enqueue(Uint8Array.of(byte));
      c.close();
    },
  });
  const data: string[] = [];
  for await (const value of sseData(body)) data.push(value);
  assert.deepEqual(data, ['{"text":\n"中文"}']);
});
test('Chat TTFT ignores role-only and heartbeat events; uses usage', async () => {
  const result = await probe(
    fixture(),
    credentials,
    streaming(
      [
        { choices: [{ delta: { role: 'assistant' } }] },
        { choices: [{ delta: { content: '1 ' } }] },
        { choices: [{ delta: { content: '2 3' } }] },
        { choices: [], usage: { completion_tokens: 5 } },
      ],
      true,
    ),
  );
  assert.equal(result.success, true);
  assert.ok(result.ttftMs! > 5);
  assert.ok(result.tps! > 0);
  assert.equal(result.outputTokens, 5);
});
test('absent usage and single-chunk output never fabricate token speed', async () => {
  const result = await probe(
    fixture(),
    credentials,
    streaming([{ choices: [{ delta: { content: 'hello' } }] }], true),
  );
  assert.equal(result.success, true);
  assert.equal(result.tps, null);
  assert.equal(result.tokenSource, 'unavailable');
});
test('truncated streams / stream errors / empty output fail even with HTTP 200', async () => {
  const truncated = await probe(
    fixture(),
    credentials,
    streaming([{ choices: [{ delta: { content: 'partial' } }] }]),
  );
  assert.equal(truncated.success, false);
  assert.equal(truncated.error, '流式连接提前结束');
  const error = await probe(
    fixture(),
    credentials,
    streaming([{ error: { message: credentials.apiKey } }], true),
  );
  assert.equal(error.success, false);
  assert.ok(!JSON.stringify(error).includes(credentials.apiKey));
  const empty = await probe(fixture(), credentials, streaming([], true));
  assert.equal(empty.success, false);
});
test('Responses reads output_text.delta and terminal usage excluding reasoning', async () => {
  const result = await probe(
    fixture({ endpoint: 'responses' }),
    credentials,
    streaming([
      { type: 'response.reasoning_summary_text.delta', delta: 'thinking' },
      { type: 'response.output_text.delta', delta: '1 ' },
      { type: 'response.output_text.delta', delta: '2 3' },
      {
        type: 'response.completed',
        response: { usage: { output_tokens: 15, output_tokens_details: { reasoning_tokens: 10 } } },
      },
    ]),
  );
  assert.equal(result.success, true);
  assert.equal(result.outputTokens, 5);
  assert.ok(result.tps! > 0);
});
test('Anthropic uses cumulative usage and message_stop', async () => {
  const result = await probe(
    fixture({ provider: 'anthropic', endpoint: 'messages' }),
    credentials,
    streaming([
      { type: 'message_start', message: { usage: { output_tokens: 1 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: '1 ' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: '2 3' } },
      { type: 'message_delta', usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ]),
  );
  assert.equal(result.success, true);
  assert.equal(result.outputTokens, 5);
  assert.ok(result.tps! > 0);
});
test('Gemini ignores thought parts, reads candidates usage and finish reason', async () => {
  const result = await probe(
    fixture({ provider: 'gemini', endpoint: 'generate' }),
    credentials,
    streaming([
      { candidates: [{ content: { parts: [{ text: 'think', thought: true }] } }] },
      { candidates: [{ content: { parts: [{ text: '1 ' }] } }] },
      {
        candidates: [{ content: { parts: [{ text: '2 3' }] }, finishReason: 'STOP' }],
        usageMetadata: { candidatesTokenCount: 5 },
      },
    ]),
  );
  assert.equal(result.success, true);
  assert.ok(result.ttftMs! > 5);
  assert.equal(result.outputTokens, 5);
});
test('OpenAI and Gemini embedding validate numeric vectors without TTFT', async () => {
  for (const [m, data] of [
    [fixture({ endpoint: 'embedding' }), { data: [{ embedding: [0.1, 0.2] }] }],
    [fixture({ provider: 'gemini', endpoint: 'embedding' }), { embedding: { values: [0.1, 0.2] } }],
  ] as const) {
    const result = await probe(m, credentials, json(data));
    assert.equal(result.success, true);
    assert.equal(result.ttftMs, null);
    assert.equal(result.tps, null);
  }
  const invalid = await probe(
    fixture({ endpoint: 'embedding' }),
    credentials,
    json({ data: [{ embedding: [] }] }),
  );
  assert.equal(invalid.success, false);
});
test('image success requires an image payload, including Gemini / Imagen', async () => {
  const valid = await probe(
    fixture({ endpoint: 'image' }),
    credentials,
    json({ data: [{ b64_json: 'image-fixture' }] }),
  );
  assert.equal(valid.success, true);
  assert.equal(valid.ttftMs, null);
  const gemini = await probe(
    fixture({ provider: 'gemini', endpoint: 'image' }),
    credentials,
    json({ candidates: [{ content: { parts: [{ inlineData: { data: 'image-fixture' } }] } }] }),
  );
  assert.equal(gemini.success, true);
  const imagen = await probe(
    fixture({ provider: 'gemini', endpoint: 'image', model: 'imagen-test' }),
    credentials,
    json({ predictions: [{ bytesBase64Encoded: 'image-fixture' }] }),
  );
  assert.equal(imagen.success, true);
  const empty = await probe(fixture({ endpoint: 'image' }), credentials, json({ data: [] }));
  assert.equal(empty.success, false);
});
test('HTTP failures are classified without exposing upstream body', async () => {
  const result = await probe(
    fixture(),
    credentials,
    json({ error: { message: credentials.apiKey } }, 429),
  );
  assert.equal(result.success, false);
  assert.match(result.error!, /429/);
  assert.ok(!JSON.stringify(result).includes(credentials.apiKey));
});
