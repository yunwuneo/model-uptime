import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import type { Monitor, Probe } from '../shared/types.js';

export interface Credentials {
  apiKey: string;
  headers: Record<string, string>;
}
type Json = Record<string, any>;
function merge(a: Json, b: Json): Json {
  const out = { ...a };
  for (const [key, value] of Object.entries(b)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    out[key] =
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      a[key] &&
      typeof a[key] === 'object'
        ? merge(a[key], value)
        : value;
  }
  return out;
}
export function buildRequest(
  m: Monitor,
  credentials: Credentials,
): { url: string; body: Json; headers: Record<string, string>; stream: boolean } {
  let path = '',
    body: Json = {},
    stream = false;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (credentials.apiKey) {
    if (m.provider === 'anthropic') headers['x-api-key'] = credentials.apiKey;
    else if (m.provider === 'gemini') headers['x-goog-api-key'] = credentials.apiKey;
    else headers.Authorization = `Bearer ${credentials.apiKey}`;
  }
  if (m.provider === 'anthropic') headers['anthropic-version'] = '2023-06-01';
  switch (m.endpoint) {
    case 'chat':
      path = '/chat/completions';
      stream = true;
      body = {
        model: m.model,
        messages: [{ role: 'user', content: m.prompt }],
        max_tokens: m.maxTokens,
        stream_options: { include_usage: true },
      };
      break;
    case 'responses':
      path = '/responses';
      stream = true;
      body = { model: m.model, input: m.prompt, max_output_tokens: m.maxTokens, store: false };
      break;
    case 'messages':
      path = '/messages';
      stream = true;
      body = {
        model: m.model,
        messages: [{ role: 'user', content: m.prompt }],
        max_tokens: m.maxTokens,
      };
      break;
    case 'generate':
      path = `/models/${encodeURIComponent(m.model.replace(/^models\//, ''))}:streamGenerateContent?alt=sse`;
      stream = true;
      body = {
        contents: [{ parts: [{ text: m.prompt }] }],
        generationConfig: { maxOutputTokens: m.maxTokens },
      };
      break;
    case 'embedding':
      if (m.provider === 'gemini') {
        path = `/models/${encodeURIComponent(m.model.replace(/^models\//, ''))}:embedContent`;
        body = { content: { parts: [{ text: m.prompt }] } };
      } else {
        path = '/embeddings';
        body = { model: m.model, input: m.prompt, encoding_format: 'float' };
      }
      break;
    case 'image':
      if (m.provider === 'gemini') {
        if (m.model.startsWith('imagen')) {
          path = `/models/${encodeURIComponent(m.model)}:predict`;
          body = { instances: [{ prompt: m.prompt }], parameters: { sampleCount: 1 } };
        } else {
          path = `/models/${encodeURIComponent(m.model.replace(/^models\//, ''))}:generateContent`;
          body = {
            contents: [{ parts: [{ text: m.prompt }] }],
            generationConfig: { responseModalities: ['IMAGE'] },
          };
        }
      } else {
        path = '/images/generations';
        body = {
          model: m.model,
          prompt: m.prompt,
          n: 1,
          size: m.model.includes('dall-e-2') ? '256x256' : '1024x1024',
          ...(m.model.startsWith('gpt-image') ? { quality: 'low' } : {}),
        };
      }
      break;
    case 'custom':
      path = m.path;
      body = { model: m.model };
      break;
  }
  body = merge(body, m.body);
  if (m.endpoint === 'chat' && 'max_completion_tokens' in m.body && !('max_tokens' in m.body))
    delete body.max_tokens;
  // Gemini selects streaming via the REST method, not a `stream` request field.
  if (stream && m.provider !== 'gemini') body.stream = true;
  if (m.provider === 'gemini') delete body.stream;
  // 接口根地址按原样保留：OpenAI / Anthropic 通常含 /v1，Gemini 通常含 /v1beta。
  return {
    url: m.baseUrl.replace(/\/+$/, '') + (m.path || path),
    body,
    headers: { ...headers, ...credentials.headers },
    stream,
  };
}

// SSE incremental decoder: 支持 UTF-8 跨网络块、CRLF、注释和多行 data。
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    bytes = 0;
  function data(frame: string) {
    return frame
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4 * 1024 * 1024) throw new Error('response_too_large');
      buffer += decoder.decode(value, { stream: true });
      // CRLF may itself be split across chunks; normalize only after appending.
      buffer = buffer.replace(/\r\n/g, '\n');
      let index: number;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const payload = data(frame);
        if (payload) yield payload;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const payload = data(buffer);
      if (payload) yield payload;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function boundedJson(response: Response): Promise<Json> {
  if (!response.body) throw new Error('empty_response');
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 32 * 1024 * 1024) throw new Error('response_too_large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
const httpErrors: Record<number, string> = {
  400: '请求参数不兼容',
  401: '身份验证失败',
  403: '无访问权限',
  404: '端点或模型不存在',
  429: '请求限流 / 额度不足',
  500: '上游服务异常',
  502: '网关异常',
  503: '服务暂不可用',
  529: '上游过载',
};
export async function probe(
  m: Monitor,
  credentials: Credentials,
  fetcher: typeof fetch = fetch,
): Promise<Probe> {
  const started = performance.now();
  const result: Probe = {
    id: randomUUID(),
    monitorId: m.id,
    revision: m.revision,
    checkedAt: Date.now(),
    success: false,
    latencyMs: 0,
    ttftMs: null,
    tps: null,
    outputTokens: null,
    httpStatus: null,
    error: null,
    tokenSource: 'unavailable',
  };
  let lastText: number | null = null,
    textEvents = 0,
    finished = false,
    hasReasoning = false;
  const abort = new AbortController(),
    timer = setTimeout(() => abort.abort(), m.timeoutSeconds * 1000);
  const text = (value: unknown) => {
    if (typeof value !== 'string' || !value.length) return;
    const now = performance.now() - started;
    if (result.ttftMs === null) result.ttftMs = now;
    lastText = now;
    textEvents++;
  };
  const tokens = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      result.outputTokens = value;
      result.tokenSource = 'reported';
    }
  };
  try {
    const request = buildRequest(m, credentials);
    const response = await fetcher(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: abort.signal,
      redirect: 'error',
    });
    result.httpStatus = response.status;
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status} · ${httpErrors[response.status] ?? '请求失败'}`);
    }
    if (!response.body) throw new Error('empty_response');
    if (request.stream) {
      if (!response.headers.get('content-type')?.includes('text/event-stream'))
        throw new Error('not_streaming');
      for await (const payload of sseData(response.body)) {
        if (payload === '[DONE]') {
          finished = true;
          continue;
        }
        let event: Json;
        try {
          event = JSON.parse(payload);
        } catch {
          throw new Error('invalid_stream');
        }
        if (event.error || ['error', 'response.failed'].includes(event.type))
          throw new Error('stream_error');
        switch (m.endpoint) {
          case 'chat':
            for (const c of event.choices ?? []) {
              text(c.delta?.content);
              if (c.delta?.reasoning_content || c.delta?.reasoning) hasReasoning = true;
            }
            if (event.usage)
              tokens(
                typeof event.usage.completion_tokens === 'number'
                  ? event.usage.completion_tokens -
                      (event.usage.completion_tokens_details?.reasoning_tokens ?? 0)
                  : null,
              );
            break;
          case 'responses':
            if (event.type === 'response.output_text.delta') text(event.delta);
            if (event.type?.includes('reasoning')) hasReasoning = true;
            if (['response.completed', 'response.incomplete'].includes(event.type)) {
              if (
                event.type === 'response.incomplete' &&
                event.response?.incomplete_details?.reason !== 'max_output_tokens'
              )
                throw new Error('stream_error');
              finished = true;
              const usage = event.response?.usage;
              if (usage)
                tokens(
                  typeof usage.output_tokens === 'number'
                    ? usage.output_tokens - (usage.output_tokens_details?.reasoning_tokens ?? 0)
                    : null,
                );
            }
            break;
          case 'messages':
            if (['thinking', 'redacted_thinking'].includes(event.content_block?.type))
              hasReasoning = true;
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta')
              text(event.delta.text);
            if (event.delta?.type === 'thinking_delta') hasReasoning = true;
            if (event.type === 'content_block_start' && event.content_block?.type === 'text')
              text(event.content_block.text);
            if (event.type === 'message_delta') tokens(event.usage?.output_tokens);
            if (event.type === 'message_stop') finished = true;
            break;
          case 'generate':
            for (const c of event.candidates ?? []) {
              for (const part of c.content?.parts ?? []) {
                if (part.thought) hasReasoning = true;
                else text(part.text);
              }
              if (['STOP', 'MAX_TOKENS'].includes(c.finishReason)) finished = true;
              else if (c.finishReason) throw new Error('stream_error');
            }
            tokens(event.usageMetadata?.candidatesTokenCount);
            break;
        }
      }
      if (!finished) throw new Error('incomplete_stream');
      if (!textEvents) throw new Error('empty_output');
      // TPOT 不等于 SSE 帧速度。只使用上游明确报告的 token 数，不按字符伪造。
      // Thinking 的计数口径不明时不展示速度，避免混入隐藏思考 token。
      const reasoningKnown = m.endpoint === 'responses' || m.endpoint === 'generate';
      if (
        result.outputTokens !== null &&
        result.outputTokens > 1 &&
        textEvents > 1 &&
        lastText !== null &&
        result.ttftMs !== null &&
        lastText > result.ttftMs &&
        (!hasReasoning || reasoningKnown)
      ) {
        result.tps = (result.outputTokens - 1) / ((lastText - result.ttftMs) / 1000);
      }
    } else {
      const json = await boundedJson(response);
      if (json.error) throw new Error('invalid_output');
      if (m.endpoint === 'embedding') {
        const vectors =
          m.provider === 'gemini'
            ? [json.embedding?.values]
            : json.data?.map((d: Json) => d.embedding);
        if (
          !Array.isArray(vectors) ||
          !vectors.length ||
          !vectors.every(
            (v) =>
              Array.isArray(v) &&
              v.length > 0 &&
              v.every((n) => typeof n === 'number' && Number.isFinite(n)),
          )
        )
          throw new Error('invalid_output');
      } else if (m.endpoint === 'image') {
        const image =
          m.provider === 'gemini'
            ? json.candidates?.some((c: Json) =>
                c.content?.parts?.some((p: Json) => p.inlineData?.data),
              ) || json.predictions?.some((p: Json) => p.bytesBase64Encoded)
            : json.data?.some(
                (d: Json) =>
                  (typeof d.b64_json === 'string' && d.b64_json.length) ||
                  (typeof d.url === 'string' && /^https?:\/\//.test(d.url)),
              );
        if (!image) throw new Error('invalid_output');
      }
    }
    result.success = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const known: Record<string, string> = {
      empty_response: '上游返回空响应',
      not_streaming: '上游未返回 SSE 流，无法测量 TTFT',
      invalid_stream: '流式数据格式不正确',
      stream_error: '上游流式请求失败 / 输出被拦截',
      incomplete_stream: '流式连接提前结束',
      empty_output: '请求结束但没有正文输出',
      invalid_output: '响应结构不符合端点协议',
      response_too_large: '响应超过安全大小限制',
    };
    // 不向公开页暴露上游原文、请求头、请求体或包含凭据的网络错误。
    result.error = abort.signal.aborted
      ? `请求超时（${m.timeoutSeconds}s）`
      : (known[message] ??
        (/^HTTP \d{3} ·/.test(message) ? message : '网络连接失败 / 响应无法解析'));
    result.ttftMs = null;
    result.tps = null;
  } finally {
    clearTimeout(timer);
    result.latencyMs = performance.now() - started;
  }
  return result;
}
