import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import type {
  AdminChannel,
  AdminMonitor,
  AlertLog,
  Incident,
  Probe,
  StatusPage,
} from '../shared/types.js';
import { fixture } from './fixtures.js';

test('API end-to-end: auth, CSRF, persistence, probes, incidents and Webhook delivery', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'lumen-api-test-'));
  const store = new Store(directory),
    { app, worker } = createApp(store, { worker: false });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  let cookie = '',
    csrf = '';
  const webhookBodies: unknown[] = [];
  const upstream = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (req.url === '/hook') {
      webhookBodies.push(JSON.parse(raw));
      res.writeHead(204);
      res.end();
      return;
    }
    const body = JSON.parse(raw);
    if (req.headers.authorization !== 'Bearer test-upstream-secret') {
      res.writeHead(401);
      res.end();
      return;
    }
    assert.equal(body.max_tokens, 32);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"1 "}}]}\n\n');
    await new Promise((resolve) => setTimeout(resolve, 15));
    res.write('data: {"choices":[{"delta":{"content":"2 3"}}]}\n\n');
    res.end('data: {"choices":[],"usage":{"completion_tokens":5}}\n\ndata: [DONE]\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const upstreamAddress = upstream.address();
  assert.ok(upstreamAddress && typeof upstreamAddress === 'object');
  const upstreamUrl = `http://127.0.0.1:${upstreamAddress.port}`;
  const close = (s: Server) =>
    new Promise<void>((resolve, reject) => s.close((error) => (error ? reject(error) : resolve())));
  t.after(async () => {
    await worker.drain();
    await close(server);
    await close(upstream);
    store.close();
    assert.ok(directory.includes('lumen-api-test-'));
    rmSync(directory, { recursive: true, force: true });
  });
  async function request<T = any>(
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(base + '/api' + path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: (await response.json()) as T, response };
  }
  await t.test('unauthenticated access is denied and initial public state is honest', async () => {
    assert.equal((await request('/admin/monitors')).status, 401);
    const state = await request<StatusPage>('/status');
    assert.equal(state.data.metrics.successRate, null);
    assert.equal(state.data.health, 'unknown');
    assert.equal((await request('/status?hours=999')).status, 400);
    assert.equal((await request('/auth/setup', 'POST', { password: 'weak' })).status, 400);
    assert.equal(
      (
        await request(
          '/auth/setup',
          'POST',
          { password: 'test-password-1234' },
          { origin: 'https://evil.example' },
        )
      ).status,
      403,
    );
  });
  await t.test(
    'setup creates hashed admin, HttpOnly session, and rejects missing CSRF',
    async () => {
      const result = await request('/auth/setup', 'POST', { password: 'test-password-1234' });
      assert.equal(result.status, 200);
      const setCookie = result.response.headers.get('set-cookie')!;
      assert.match(setCookie, /HttpOnly/);
      assert.match(setCookie, /SameSite=Strict/);
      cookie = setCookie.split(';')[0];
      csrf = result.data.csrf;
      assert.ok(!JSON.stringify(store.get('admin')).includes('test-password-1234'));
      assert.equal(
        (await request('/auth/setup', 'POST', { password: 'test-password-1234' })).status,
        409,
      );
      assert.equal(
        (await request('/admin/settings', 'PUT', store.settings(), { 'x-csrf-token': '' })).status,
        403,
      );
    },
  );
  let id = '',
    channelId = '',
    incidentId = '';
  await t.test('create monitor validates protocols and encrypts all auth material', async () => {
    assert.equal(
      (
        await request('/admin/monitors', 'POST', {
          ...fixture(),
          provider: 'anthropic',
          endpoint: 'chat',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request('/admin/monitors', 'POST', {
          ...fixture(),
          baseUrl: 'https://user:secret@example.com/v1',
        })
      ).status,
      400,
    );
    const { icon: _icon, ...withoutIcon } = fixture();
    const result = await request<AdminMonitor>('/admin/monitors', 'POST', {
      ...withoutIcon,
      baseUrl: upstreamUrl + '/v1',
      apiKey: 'test-upstream-secret',
      headers: { 'x-private': 'test-header-secret' },
    });
    assert.equal(result.status, 201);
    id = result.data.id;
    assert.equal(result.data.hasKey, true);
    assert.equal(result.data.icon, 'auto');
    assert.ok(!JSON.stringify(result.data).includes('test-upstream-secret'));
    assert.ok(!JSON.stringify(result.data).includes('test-header-secret'));
    assert.ok(!JSON.stringify(store.monitor(id)).includes('test-upstream-secret'));
  });
  await t.test(
    'manual real HTTP probe persists output and public DTO never leaks credentials',
    async () => {
      const result = await request<Probe>(`/admin/monitors/${id}/probe`, 'POST', {});
      assert.equal(result.status, 200);
      assert.equal(result.data.success, true);
      assert.ok(result.data.tps! > 0);
      const publicState = await request<StatusPage>('/status');
      assert.equal(publicState.data.metrics.samples, 1);
      assert.equal(publicState.data.monitors[0].metrics.successRate, 100);
      assert.equal(publicState.data.monitors[0].url, upstreamUrl + '/v1/chat/completions');
      assert.ok(!JSON.stringify(publicState.data).includes('test-upstream-secret'));
      assert.ok(!JSON.stringify(publicState.data).includes('test-header-secret'));
      assert.ok(!('prompt' in publicState.data.monitors[0]));
      assert.ok(!('secret' in publicState.data.monitors[0]));
    },
  );
  await t.test(
    'manual icon persists, publishes, and preserves metrics and the next probe schedule',
    async () => {
      const existing = (await request<AdminMonitor[]>('/admin/monitors')).data[0];
      const saved = await request<AdminMonitor>(`/admin/monitors/${id}`, 'PUT', {
        ...existing,
        icon: 'xai',
      });
      assert.equal(saved.status, 200);
      assert.equal(saved.data.icon, 'xai');
      assert.equal(saved.data.revision, existing.revision);
      assert.equal(saved.data.nextRunAt, existing.nextRunAt);
      assert.equal(saved.data.failureSince, existing.failureSince);
      assert.equal(saved.data.latest?.id, existing.latest?.id);
      const page = (await request<StatusPage>('/status')).data;
      assert.equal(page.monitors[0].icon, 'xai');
      assert.equal(page.monitors[0].metrics.samples, 1);
      const { icon: _icon, ...omitted } = saved.data;
      assert.equal(
        (await request<AdminMonitor>(`/admin/monitors/${id}`, 'PUT', omitted)).data.icon,
        'xai',
      );
      assert.equal(
        (await request(`/admin/monitors/${id}`, 'PUT', { ...saved.data, icon: 'fake-brand' }))
          .status,
        400,
      );
      assert.equal(
        (
          await request<AdminMonitor>(`/admin/monitors/${id}`, 'PUT', {
            ...saved.data,
            icon: 'auto',
          })
        ).data.icon,
        'auto',
      );
    },
  );
  await t.test('edit retains keys, pause prevents manual probes', async () => {
    const existing = (await request<AdminMonitor[]>('/admin/monitors')).data[0];
    const saved = await request<AdminMonitor>(`/admin/monitors/${id}`, 'PUT', {
      ...existing,
      enabled: false,
      apiKey: '',
    });
    assert.equal(saved.data.hasKey, true);
    assert.equal(saved.data.health, 'paused');
    assert.equal((await request(`/admin/monitors/${id}/probe`, 'POST', {})).status, 400);
    assert.equal(
      (await request(`/admin/monitors/${id}`, 'PUT', { ...existing, enabled: true })).status,
      200,
    );
  });
  await t.test('settings and incidents persist and publish on the public page', async () => {
    assert.equal(
      (await request('/admin/settings', 'PUT', { ...store.settings(), title: '测试状态页' }))
        .status,
      200,
    );
    const incident = await request<Incident>('/admin/incidents', 'POST', {
      title: '测试维护',
      body: '仅测试用途',
      status: 'maintenance',
      severity: 'maintenance',
      monitorId: id,
      startedAt: Date.now(),
      scheduledEnd: Date.now() + 3600000,
    });
    assert.equal(incident.status, 201);
    incidentId = incident.data.id;
    const publicPage = (await request<StatusPage>('/status')).data;
    assert.equal(publicPage.site.title, '测试状态页');
    assert.equal(publicPage.incidents[0].title, '测试维护');
    const updated = await request<Incident>(`/admin/incidents/${incidentId}`, 'PUT', {
      ...incident.data,
      status: 'resolved',
    });
    assert.ok(updated.data.resolvedAt);
  });
  await t.test('Webhook sends tested JSON and produces delivery log without secrets', async () => {
    const channel = await request<AdminChannel>('/admin/channels', 'POST', {
      name: '测试 Hook',
      kind: 'webhook',
      enabled: true,
      onDown: true,
      onDegraded: true,
      onRecovery: true,
      config: { url: upstreamUrl + '/hook', secret: 'test-webhook-secret' },
    });
    assert.equal(channel.status, 201);
    channelId = channel.data.id;
    assert.equal(channel.data.config.secret, '');
    assert.equal(channel.data.hasSecret, true);
    assert.equal((await request(`/admin/channels/${channelId}/test`, 'POST', {})).status, 200);
    assert.equal(webhookBodies.length, 1);
    assert.equal((webhookBodies[0] as { event: string }).event, 'test');
    const logs = await request<AlertLog[]>('/admin/alerts');
    assert.equal(logs.data[0].success, true);
    assert.ok(!JSON.stringify(logs).includes('test-webhook-secret'));
  });
  await t.test(
    'delete cascades probe data while preserving published incidents and logs',
    async () => {
      assert.equal((await request(`/admin/monitors/${id}`, 'DELETE')).status, 200);
      assert.equal(store.probes(id, 0).length, 0);
      assert.equal(store.incidents().length, 1);
      assert.equal((await request(`/admin/incidents/${incidentId}`, 'DELETE')).status, 200);
      assert.equal((await request(`/admin/channels/${channelId}`, 'DELETE')).status, 200);
      assert.equal(store.alerts().length, 1);
    },
  );
  await t.test(
    'endpoint configuration versions exclude old model metrics and allow explicit key removal',
    async () => {
      const created = await request<AdminMonitor>('/admin/monitors', 'POST', {
        ...fixture(),
        baseUrl: upstreamUrl + '/v1',
        apiKey: 'test-upstream-secret',
      });
      await request(`/admin/monitors/${created.data.id}/probe`, 'POST', {});
      const updated = await request<AdminMonitor>(`/admin/monitors/${created.data.id}`, 'PUT', {
        ...created.data,
        model: 'changed-model',
        clearApiKey: true,
      });
      assert.equal(updated.data.hasKey, false);
      assert.equal(updated.data.latest, null);
      assert.equal(updated.data.revision, 2);
      const publicPage = (await request<StatusPage>('/status')).data;
      assert.equal(publicPage.metrics.samples, 0);
      assert.equal(publicPage.monitors[0].metrics.successRate, null);
      assert.equal(
        store.db
          .prepare('SELECT COUNT(*) AS count FROM probes WHERE monitor_id = ?')
          .get(created.data.id)!.count,
        1,
      );
      await request(`/admin/monitors/${created.data.id}`, 'DELETE');
    },
  );
  await t.test('logout and password rotation revoke persistent sessions', async () => {
    assert.equal((await request('/admin/logout', 'POST', {})).status, 200);
    assert.equal((await request('/admin/settings')).status, 401);
    assert.equal((await request('/auth/login', 'POST', { password: 'incorrect' })).status, 401);
    const login = await request('/auth/login', 'POST', { password: 'test-password-1234' });
    cookie = login.response.headers.get('set-cookie')!.split(';')[0];
    csrf = login.data.csrf;
    assert.equal(
      (
        await request('/admin/password', 'POST', {
          currentPassword: 'test-password-1234',
          password: 'new-test-password-1234',
        })
      ).status,
      200,
    );
    assert.equal((await request('/admin/settings')).status, 401);
    assert.equal(
      (await request('/auth/login', 'POST', { password: 'test-password-1234' })).status,
      401,
    );
  });
});
