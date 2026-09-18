// Isolated browser acceptance fixture. Never touches the project's data/ directory.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { fixture } from './fixtures.js';

const directory = mkdtempSync(join(tmpdir(), 'lumen-ui-test-'));
const store = new Store(directory),
  salt = 'local-ui-fixture-salt';
store.set('admin', { salt, hash: scryptSync('ui-fixture-password', salt, 64).toString('hex') });
store.set('settings', {
  ...store.settings(),
  title: 'Lumen · 验收',
  description: '隔离测试实例 · 所有数据为模拟样本',
});
store.set('workerHeartbeat', Date.now());
const fake = createServer(async (req, res) => {
  let data = '';
  for await (const chunk of req) data += chunk;
  if (req.url === '/hook') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.url === '/v1/embeddings') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write('data: {"choices":[{"delta":{"content":"1 "}}]}\n\n');
  await new Promise((resolve) => setTimeout(resolve, 40));
  res.write('data: {"choices":[{"delta":{"content":"2 3"}}]}\n\n');
  res.end('data: {"choices":[],"usage":{"completion_tokens":5}}\n\ndata: [DONE]\n\n');
});
fake.listen(3013, '127.0.0.1');
const names = ['GPT 主渠道', 'Claude 主渠道', 'Gemini 快速渠道'];
for (let i = 0; i < names.length; i++) {
  const m = fixture({
    id: randomUUID(),
    name: names[i],
    group: ['OpenAI', 'Anthropic', 'Google'][i],
    baseUrl: 'http://127.0.0.1:3013/v1',
    nextRunAt: Date.now() + 86400000,
    secret: store.encrypt({ apiKey: 'non-live-fixture-key', headers: {} }),
    lastHealth: 'operational',
  });
  store.saveMonitor(m);
  for (let j = 0; j < 96; j++)
    store.saveProbe({
      id: randomUUID(),
      monitorId: m.id,
      revision: 1,
      checkedAt: Date.now() - (95 - j) * 900000,
      success: true,
      latencyMs: 1600 + Math.sin(j) * 100,
      ttftMs: 650 + Math.cos(j * 0.7) * 120,
      tps: 70 + Math.sin(j) * 10,
      outputTokens: 32,
      httpStatus: 200,
      error: null,
      tokenSource: 'reported',
    });
}
process.env.PUBLIC_ORIGIN = 'http://127.0.0.1:3012';
const { app, worker } = createApp(store, { worker: false });
const server = app.listen(3012, '127.0.0.1', () =>
  console.log('Isolated UI acceptance fixture: http://127.0.0.1:3012'),
);
let stopping = false;
async function cleanup() {
  if (stopping) return;
  stopping = true;
  await worker.drain();
  server.close();
  fake.close();
  store.close();
  if (directory.includes('lumen-ui-test-')) rmSync(directory, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGINT', () => {
  void cleanup();
});
process.on('SIGTERM', () => {
  void cleanup();
});
