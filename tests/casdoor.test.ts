import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';

test('Casdoor authorization code login binds the existing admin and then signs in directly', async (t) => {
  const casdoorServer = createServer((req, res) => {
    if (req.url === '/api/login/oauth/access_token') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        assert.match(body, /client_id=client/);
        assert.match(body, /client_secret=secret/);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ access_token: 'server-only-token' }));
      });
      return;
    }
    if (req.url === '/api/userinfo') {
      assert.equal(req.headers.authorization, 'Bearer server-only-token');
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({ sub: 'stable-subject', name: 'Casdoor User', email: 'user@example.com' }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  casdoorServer.listen(0, '127.0.0.1');
  await once(casdoorServer, 'listening');
  const casdoorAddress = casdoorServer.address();
  assert.ok(casdoorAddress && typeof casdoorAddress === 'object');
  const oldEnv = {
    origin: process.env.CASDOOR_ORIGIN,
    clientId: process.env.CASDOOR_CLIENT_ID,
    clientSecret: process.env.CASDOOR_CLIENT_SECRET,
    redirectUri: process.env.CASDOOR_REDIRECT_URI,
  };
  process.env.CASDOOR_ORIGIN = `http://127.0.0.1:${casdoorAddress.port}`;
  process.env.CASDOOR_CLIENT_ID = 'client';
  process.env.CASDOOR_CLIENT_SECRET = 'secret';
  process.env.CASDOOR_REDIRECT_URI = 'http://127.0.0.1:3001/api/auth/casdoor/callback';
  const directory = mkdtempSync(join(tmpdir(), 'lumen-casdoor-test-'));
  const store = new Store(directory);
  const { app, worker } = createApp(store, { worker: false });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const close = (s: Server) =>
    new Promise<void>((resolve, reject) => s.close((error) => (error ? reject(error) : resolve())));
  t.after(async () => {
    await worker.drain();
    await close(server);
    await close(casdoorServer);
    store.close();
    rmSync(directory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined)
        delete process.env[
          {
            origin: 'CASDOOR_ORIGIN',
            clientId: 'CASDOOR_CLIENT_ID',
            clientSecret: 'CASDOOR_CLIENT_SECRET',
            redirectUri: 'CASDOOR_REDIRECT_URI',
          }[key] as string
        ];
      else
        process.env[
          {
            origin: 'CASDOOR_ORIGIN',
            clientId: 'CASDOOR_CLIENT_ID',
            clientSecret: 'CASDOOR_CLIENT_SECRET',
            redirectUri: 'CASDOOR_REDIRECT_URI',
          }[key] as string
        ] = value;
    }
  });
  const request = (path: string, init: RequestInit = {}) =>
    fetch(base + '/api' + path, { redirect: 'manual', ...init });
  const readCookie = (response: Response, name: string) => {
    const header = response.headers.get('set-cookie') ?? '';
    const item = header
      .split(/,(?=\s*[^;,]+=)/)
      .find((value) => value.trim().startsWith(`${name}=`));
    return item?.trim().split(';')[0] ?? `${name}=`;
  };
  const setup = await request('/auth/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'test-password-1234' }),
  });
  assert.equal(setup.status, 200);
  const sessionCookie = readCookie(setup, 'lumen_session');
  const start = await request('/auth/casdoor/start', { headers: { cookie: sessionCookie } });
  assert.equal(start.status, 302);
  const authorize = new URL(start.headers.get('location')!);
  assert.equal(authorize.searchParams.get('client_id'), 'client');
  const stateCookie = readCookie(start, 'lumen_casdoor_state');
  const invalid = await request('/auth/casdoor/callback?state=wrong&code=code', {
    headers: { cookie: stateCookie },
  });
  assert.equal(invalid.status, 400);
  const callback = await request(
    `/auth/casdoor/callback?state=${authorize.searchParams.get('state')}&code=code`,
    { headers: { cookie: stateCookie } },
  );
  assert.equal(callback.status, 302);
  assert.match(callback.headers.get('location')!, /casdoor=pending/);
  const linkCookie = readCookie(callback, 'lumen_casdoor_link');
  const pending = await request('/auth/casdoor/pending', { headers: { cookie: linkCookie } });
  assert.equal(pending.status, 200);
  assert.match(await pending.text(), /Casdoor User/);
  const rejected = await request('/auth/casdoor/bind', {
    method: 'POST',
    headers: {
      cookie: linkCookie,
      origin: 'http://127.0.0.1:5173',
      'x-casdoor-bind': '1',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ password: 'wrong-password-1234' }),
  });
  assert.equal(rejected.status, 401);
  const bound = await request('/auth/casdoor/bind', {
    method: 'POST',
    headers: {
      cookie: linkCookie,
      origin: 'http://127.0.0.1:5173',
      'x-casdoor-bind': '1',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ password: 'test-password-1234' }),
  });
  assert.equal(bound.status, 200);
  assert.equal(
    (
      await (
        await request('/auth/session', { headers: { cookie: readCookie(bound, 'lumen_session') } })
      ).json()
    ).authenticated,
    true,
  );
  const startAgain = await request('/auth/casdoor/start');
  const authorizeAgain = new URL(startAgain.headers.get('location')!);
  const callbackAgain = await request(
    `/auth/casdoor/callback?state=${authorizeAgain.searchParams.get('state')}&code=code`,
    { headers: { cookie: readCookie(startAgain, 'lumen_casdoor_state') } },
  );
  assert.equal(callbackAgain.status, 302);
  assert.equal(callbackAgain.headers.get('location'), '/admin');
  assert.ok(!(await callbackAgain.text()).includes('server-only-token'));
});
