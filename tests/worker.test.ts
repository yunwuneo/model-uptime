import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { Worker } from '../server/worker.js';
import { safeChannelConfig } from '../server/alerts.js';
import { fixture } from './fixtures.js';

test('worker confirms sustained failure, deduplicates alerts, publishes and resolves incident', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'lumen-worker-test-')),
    store = new Store(directory),
    worker = new Worker(store);
  let status = 503,
    notifications = 0;
  const upstream = createServer(async (req, res) => {
    for await (const _chunk of req) {
      /* consume request */
    }
    if (req.url === '/hook') {
      notifications++;
      res.writeHead(204);
      res.end();
      return;
    }
    if (status !== 200) {
      res.writeHead(status);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"1 "}}]}\n\n');
    await new Promise((resolve) => setTimeout(resolve, 15));
    res.end(
      'data: {"choices":[{"delta":{"content":"2 3"}}]}\n\ndata: {"choices":[],"usage":{"completion_tokens":5}}\n\ndata: [DONE]\n\n',
    );
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const address = upstream.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await worker.drain();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    store.close();
    assert.ok(directory.includes('lumen-worker-test-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const m = fixture({
    baseUrl: base + '/v1',
    failureSince: Date.now() - 3600001,
    lastHealth: 'pending',
    secret: store.encrypt({ apiKey: '', headers: {} }),
  });
  store.saveMonitor(m);
  store.saveProbe({
    id: randomUUID(),
    monitorId: m.id,
    revision: 1,
    checkedAt: Date.now() - 900000,
    success: false,
    latencyMs: 10,
    ttftMs: null,
    tps: null,
    outputTokens: null,
    httpStatus: 503,
    error: 'HTTP 503',
    tokenSource: 'unavailable',
  });
  store.saveChannel({
    id: 'channel',
    name: 'test',
    kind: 'webhook',
    enabled: true,
    onDown: true,
    onDegraded: false,
    onRecovery: true,
    config: store.encrypt({ url: base + '/hook' }),
  });
  await worker.run(m.id);
  assert.equal(store.monitor(m.id)!.lastHealth, 'down');
  assert.equal(store.incidents().length, 1);
  assert.equal(store.incidents()[0].automatic, true);
  assert.equal(notifications, 1);
  await worker.run(m.id);
  assert.equal(notifications, 1);
  assert.equal(store.incidents().length, 1);
  status = 200;
  await worker.run(m.id);
  assert.equal(store.monitor(m.id)!.lastHealth, 'operational');
  assert.equal(store.monitor(m.id)!.failureSince, null);
  assert.equal(store.incidents()[0].status, 'resolved');
  assert.equal(notifications, 2);
  await worker.run(m.id);
  assert.equal(notifications, 2);
  const running = worker.run(m.id);
  await assert.rejects(worker.run(m.id), /正在探测/);
  await running;
  const peers = ['peer-1', 'peer-2', 'peer-3'].map((id) => ({ ...m, id, failureSince: null }));
  for (const peer of peers) store.saveMonitor(peer);
  const concurrent = peers.map((peer) => worker.run(peer.id));
  await assert.rejects(worker.run(m.id), /并发已满/);
  await Promise.all(concurrent);
});
test('probe gap resets continuity instead of claiming an hour of unobserved failure', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'lumen-gap-test-')),
    store = new Store(directory),
    worker = new Worker(store);
  const upstream = createServer((_req, res) => {
    res.writeHead(503);
    res.end();
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const address = upstream.address();
  assert.ok(address && typeof address === 'object');
  t.after(async () => {
    await worker.drain();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    store.close();
    assert.ok(directory.includes('lumen-gap-test-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const m = fixture({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    failureSince: Date.now() - 7200000,
    lastHealth: 'pending',
    secret: store.encrypt({ apiKey: '', headers: {} }),
  });
  store.saveMonitor(m);
  store.saveProbe({
    id: randomUUID(),
    monitorId: m.id,
    revision: 1,
    checkedAt: Date.now() - 3600000,
    success: false,
    latencyMs: 10,
    ttftMs: null,
    tps: null,
    outputTokens: null,
    httpStatus: 503,
    error: 'HTTP 503',
    tokenSource: 'unavailable',
  });
  await worker.run(m.id);
  assert.equal(store.monitor(m.id)!.lastHealth, 'pending');
  assert.ok(Date.now() - store.monitor(m.id)!.failureSince! < 1000);
  assert.equal(store.incidents().length, 0);
});
test('alert configuration validates inputs and retains redacted secrets on edit', () => {
  assert.throws(() => safeChannelConfig('webhook', { url: 'file:///etc/passwd' }));
  assert.throws(() => safeChannelConfig('telegram', { token: '', chatId: '123' }));
  assert.throws(() =>
    safeChannelConfig('email', {
      host: 'smtp.test',
      port: 0,
      from: 'x@test',
      to: 'y@test',
      secure: false,
    }),
  );
  const config = safeChannelConfig(
    'telegram',
    { token: '', chatId: '456' },
    { token: 'fixture-token', chatId: '123' },
  );
  assert.equal(config.token, 'fixture-token');
  assert.equal(config.chatId, '456');
});
test('SQLite settings and encrypted credentials survive a new process-like Store instance', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lumen-persistence-test-'));
  let store = new Store(directory);
  store.set('settings', { ...store.settings(), title: '持久化测试' });
  const m = fixture({ secret: store.encrypt({ apiKey: 'fixture-only-key', headers: {} }) });
  store.saveMonitor(m);
  store.close();
  store = new Store(directory);
  assert.equal(store.settings().title, '持久化测试');
  assert.equal(
    store.decrypt<{ apiKey: string }>(store.monitor(m.id)!.secret).apiKey,
    'fixture-only-key',
  );
  store.close();
  assert.ok(directory.includes('lumen-persistence-test-'));
  rmSync(directory, { recursive: true, force: true });
});
