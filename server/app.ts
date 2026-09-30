import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { ZodError } from 'zod';
import type { AdminChannel, AdminMonitor, Channel, Incident, Monitor } from '../shared/types.js';
import type { Credentials } from './probe.js';
import { Store } from './store.js';
import { Worker } from './worker.js';
import { statusPage } from './status.js';
import { health } from './domain.js';
import { channelSchema, incidentSchema, monitorSchema, settingsSchema } from './schemas.js';
import { deliver, safeChannelConfig } from './alerts.js';

type Admin = { salt: string; hash: string };
type CasdoorConfig = {
  origin: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const passwordHash = (password: string, salt: string) =>
  scryptSync(password, salt, 64).toString('hex');
function matches(password: string, admin: Admin) {
  return timingSafeEqual(
    Buffer.from(passwordHash(password, admin.salt), 'hex'),
    Buffer.from(admin.hash, 'hex'),
  );
}
function checkPassword(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128)
    throw new Error('密码需为 12–128 位');
}
function cookie(req: Request, name: string) {
  return (
    req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(name + '='))
      ?.slice(name.length + 1) ?? ''
  );
}
function casdoorConfig(): CasdoorConfig | null {
  const origin = process.env.CASDOOR_ORIGIN?.trim() ?? '';
  const clientId = process.env.CASDOOR_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.CASDOOR_CLIENT_SECRET?.trim() ?? '';
  const redirectUri = process.env.CASDOOR_REDIRECT_URI?.trim() ?? '';
  if (![origin, clientId, clientSecret, redirectUri].some(Boolean)) return null;
  if (![origin, clientId, clientSecret, redirectUri].every(Boolean))
    throw new Error(
      'Casdoor 配置不完整，需要 CASDOOR_ORIGIN、CASDOOR_CLIENT_ID、CASDOOR_CLIENT_SECRET 和 CASDOOR_REDIRECT_URI',
    );
  if (
    process.env.NODE_ENV === 'production' &&
    (!origin.startsWith('https://') || !redirectUri.startsWith('https://'))
  )
    throw new Error('生产环境 Casdoor origin 和回调地址必须使用 HTTPS');
  try {
    const originUrl = new URL(origin);
    const redirectUrl = new URL(redirectUri);
    if (
      !['http:', 'https:'].includes(originUrl.protocol) ||
      !['http:', 'https:'].includes(redirectUrl.protocol)
    )
      throw new Error();
  } catch {
    throw new Error('Casdoor origin 和回调地址必须是有效的 HTTP(S) URL');
  }
  return { origin: origin.replace(/\/$/, ''), clientId, clientSecret, redirectUri };
}
function safeCasdoorProfile(value: Record<string, unknown>) {
  const displayName = [
    value.name,
    value.displayName,
    value.preferred_username,
    value.username,
  ].find((item): item is string => typeof item === 'string' && item.length > 0);
  const email = typeof value.email === 'string' ? value.email : undefined;
  return { displayName: displayName?.slice(0, 160), email: email?.slice(0, 320) };
}
const wrap =
  (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res).catch(next);
  };

export function createApp(store: Store, options: { worker?: boolean; staticDir?: string } = {}) {
  const app = express(),
    worker = new Worker(store);
  const casdoor = casdoorConfig();
  const secure = process.env.COOKIE_SECURE === 'true';
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure,
    path: '/',
    maxAge: 7 * 86400000,
  };
  const casdoorStateCookie = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: 10 * 60 * 1000,
  };
  const casdoorLinkCookie = { ...casdoorStateCookie, maxAge: 10 * 60 * 1000 };
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          upgradeInsecureRequests: secure ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: '96kb' }));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  // Same-origin gate also protects unauthenticated setup/login against login CSRF.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const allowed = new Set([
      process.env.PUBLIC_ORIGIN ?? 'http://localhost:3001',
      'http://127.0.0.1:3001',
    ]);
    if (process.env.NODE_ENV !== 'production') {
      allowed.add('http://localhost:5173');
      allowed.add('http://127.0.0.1:5173');
    }
    if (req.headers.origin && !allowed.has(req.headers.origin))
      return res.status(403).json({ error: '请求来源不受信任，请检查 PUBLIC_ORIGIN' });
    if (req.headers['sec-fetch-site'] === 'cross-site')
      return res.status(403).json({ error: '不允许跨站操作' });
    next();
  });
  app.get('/api/status', (req, res) => {
    const hours = Number(req.query.hours ?? 24);
    if (![24, 168, 720].includes(hours)) return res.status(400).json({ error: '不支持的时间范围' });
    res.json(statusPage(store, hours));
  });
  app.get('/api/health', (_req, res) => {
    const tick = store.get<number>('workerHeartbeat');
    res.json({ ok: true, workerAlive: tick !== null && Date.now() - tick < 20000 });
  });
  app.get('/api/auth/session', (req, res) => {
    const session = store.db
      .prepare('SELECT csrf FROM sessions WHERE token_hash = ? AND expires > ?')
      .get(hashToken(cookie(req, 'lumen_session')), Date.now());
    res.json({
      initialized: !!store.get('admin'),
      authenticated: !!session,
      csrf: session?.csrf ?? null,
      casdoorEnabled: !!casdoor,
    });
  });
  const attempts = new Map<string, { count: number; reset: number }>();
  function throttle(req: Request, res: Response, next: NextFunction) {
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown',
      current = attempts.get(key);
    const item =
      current && current.reset > Date.now() ? current : { count: 0, reset: Date.now() + 600000 };
    item.count++;
    attempts.set(key, item);
    if (item.count > 10) return res.status(429).json({ error: '尝试次数过多，请 10 分钟后再试' });
    if (attempts.size > 1000)
      for (const [k, v] of attempts) if (v.reset < Date.now()) attempts.delete(k);
    next();
  }
  function signIn(res: Response, redirectPath?: string) {
    const token = randomBytes(32).toString('hex'),
      csrf = randomBytes(24).toString('hex');
    store.db
      .prepare('INSERT INTO sessions VALUES (?, ?, ?)')
      .run(hashToken(token), Date.now() + cookieOptions.maxAge, csrf);
    const response = res.cookie('lumen_session', token, cookieOptions);
    if (redirectPath) return response.redirect(redirectPath);
    return response.json({ authenticated: true, initialized: true, csrf });
  }
  app.get('/api/auth/casdoor/config', (_req, res) => {
    res.json({ enabled: !!casdoor });
  });
  app.get('/api/auth/casdoor/start', (req, res) => {
    if (!casdoor) return res.status(404).json({ error: 'Casdoor 登录未启用' });
    if (!store.get('admin')) return res.status(409).json({ error: '请先初始化管理员' });
    const state = randomBytes(32).toString('hex');
    const authorize = new URL(`${casdoor.origin}/login/oauth/authorize`);
    authorize.search = new URLSearchParams({
      client_id: casdoor.clientId,
      response_type: 'code',
      redirect_uri: casdoor.redirectUri,
      scope: 'openid profile email',
      state,
    }).toString();
    res.cookie('lumen_casdoor_state', state, casdoorStateCookie).redirect(authorize.toString());
  });
  app.get(
    '/api/auth/casdoor/callback',
    wrap(async (req, res) => {
      if (!casdoor) return res.status(404).send('Casdoor 登录未启用');
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const expected = cookie(req, 'lumen_casdoor_state');
      res.clearCookie('lumen_casdoor_state', casdoorStateCookie);
      if (
        !state ||
        !expected ||
        state.length !== expected.length ||
        !timingSafeEqual(Buffer.from(state), Buffer.from(expected))
      )
        return res.status(400).send('Casdoor 登录状态无效，请重新发起登录');
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      if (!code) return res.status(400).send('Casdoor 登录未返回授权码');
      const tokenResponse = await fetch(`${casdoor.origin}/api/login/oauth/access_token`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: casdoor.clientId,
          client_secret: casdoor.clientSecret,
          code,
          redirect_uri: casdoor.redirectUri,
        }),
      });
      if (!tokenResponse.ok) return res.status(502).send('Casdoor 登录失败，请稍后重试');
      const tokenBody = (await tokenResponse.json()) as { access_token?: unknown };
      if (typeof tokenBody.access_token !== 'string' || !tokenBody.access_token)
        return res.status(502).send('Casdoor 登录失败，请稍后重试');
      const profileResponse = await fetch(`${casdoor.origin}/api/userinfo`, {
        headers: { authorization: `Bearer ${tokenBody.access_token}`, accept: 'application/json' },
      });
      if (!profileResponse.ok) return res.status(502).send('Casdoor 登录失败，请稍后重试');
      const profile = (await profileResponse.json()) as Record<string, unknown>;
      const subject =
        typeof profile.sub === 'string' && profile.sub
          ? profile.sub
          : typeof profile.id === 'string'
            ? profile.id
            : '';
      if (!subject) return res.status(502).send('Casdoor 身份信息无效，请联系管理员');
      const account = store.casdoorAccount(subject);
      if (account) return signIn(res, '/admin');
      store.db.prepare('DELETE FROM casdoor_link_intents WHERE expires_at < ?').run(Date.now());
      const linkToken = randomBytes(32).toString('hex');
      store.saveCasdoorIntent(
        hashToken(linkToken),
        subject,
        safeCasdoorProfile(profile),
        Date.now() + 10 * 60 * 1000,
      );
      return res
        .cookie('lumen_casdoor_link', linkToken, casdoorLinkCookie)
        .redirect('/admin?casdoor=pending');
    }),
  );
  app.get('/api/auth/casdoor/pending', (req, res) => {
    if (!casdoor) return res.status(404).json({ error: 'Casdoor 登录未启用' });
    const intent = store.casdoorIntent(hashToken(cookie(req, 'lumen_casdoor_link')));
    if (!intent) return res.status(404).json({ error: '绑定已失效，请重新使用 Casdoor 登录' });
    res.json({ pending: true, profile: intent.profile });
  });
  app.post('/api/auth/casdoor/bind', throttle, (req, res) => {
    if (!casdoor) return res.status(404).json({ error: 'Casdoor 登录未启用' });
    const origin = req.headers.origin;
    const allowed = new Set([
      process.env.PUBLIC_ORIGIN ?? 'http://localhost:3001',
      'http://127.0.0.1:3001',
    ]);
    if (process.env.NODE_ENV !== 'production') {
      allowed.add('http://localhost:5173');
      allowed.add('http://127.0.0.1:5173');
    }
    if (req.headers['x-casdoor-bind'] !== '1' || !origin || !allowed.has(origin))
      return res.status(403).json({ error: '绑定请求来源不受信任' });
    const token = cookie(req, 'lumen_casdoor_link');
    const intent = store.casdoorIntent(hashToken(token));
    const admin = store.get<Admin>('admin');
    if (!intent || !admin)
      return res.status(400).json({ error: '绑定已失效，请重新使用 Casdoor 登录' });
    if (
      typeof req.body.password !== 'string' ||
      req.body.password.length > 128 ||
      !matches(req.body.password, admin)
    )
      return res.status(401).json({ error: '用户名或密码不正确' });
    const existing = store.casdoorUsername('admin');
    if (existing && existing.subject !== intent.subject)
      return res.status(409).json({ error: '该管理员账号已经绑定其他 Casdoor 身份' });
    if (!existing) {
      try {
        store.saveCasdoorAccount(intent.subject, 'admin');
      } catch {
        return res.status(409).json({ error: '该管理员账号已经绑定其他 Casdoor 身份' });
      }
    }
    store.deleteCasdoorIntent(hashToken(token));
    res.clearCookie('lumen_casdoor_link', casdoorLinkCookie);
    signIn(res);
  });
  app.post('/api/auth/setup', throttle, (req, res) => {
    if (store.get('admin')) return res.status(409).json({ error: '管理员已经初始化' });
    const address = req.socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? ''))
      return res.status(403).json({ error: '请先在服务器本机初始化管理员' });
    checkPassword(req.body.password);
    const salt = randomBytes(16).toString('hex');
    store.set('admin', { salt, hash: passwordHash(req.body.password, salt) });
    signIn(res);
  });
  app.post('/api/auth/login', throttle, (req, res) => {
    const admin = store.get<Admin>('admin');
    if (!admin) return res.status(409).json({ error: '请先初始化管理员' });
    if (
      typeof req.body.password !== 'string' ||
      req.body.password.length > 128 ||
      !matches(req.body.password, admin)
    )
      return res.status(401).json({ error: '密码不正确' });
    attempts.delete(req.ip ?? req.socket.remoteAddress ?? 'unknown');
    signIn(res);
  });
  app.use('/api/admin', (req, res, next) => {
    const session = store.db
      .prepare('SELECT csrf FROM sessions WHERE token_hash = ? AND expires > ?')
      .get(hashToken(cookie(req, 'lumen_session')), Date.now());
    if (!session) return res.status(401).json({ error: '请先登录管理后台' });
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-csrf-token'] !== session.csrf)
      return res.status(403).json({ error: '会话验证失败，请刷新页面重试' });
    next();
  });
  app.post('/api/admin/logout', (req, res) => {
    store.db
      .prepare('DELETE FROM sessions WHERE token_hash = ?')
      .run(hashToken(cookie(req, 'lumen_session')));
    res.clearCookie('lumen_session', cookieOptions).json({ ok: true });
  });
  app.post('/api/admin/password', throttle, (req, res) => {
    const admin = store.get<Admin>('admin')!;
    if (
      typeof req.body.currentPassword !== 'string' ||
      req.body.currentPassword.length > 128 ||
      !matches(req.body.currentPassword, admin)
    )
      return res.status(400).json({ error: '当前密码不正确' });
    checkPassword(req.body.password);
    const salt = randomBytes(16).toString('hex');
    store.set('admin', { salt, hash: passwordHash(req.body.password, salt) });
    store.db.exec('DELETE FROM sessions');
    res.clearCookie('lumen_session', cookieOptions).json({ ok: true });
  });
  const adminMonitor = (m: Monitor): AdminMonitor => {
    const { secret, ...publicFields } = m,
      c = store.decrypt<Credentials>(secret),
      latest = store.latest(m.id);
    return {
      ...publicFields,
      hasKey: !!c.apiKey,
      headerNames: Object.keys(c.headers),
      health: health(m, latest, store.settings()),
      latest,
    };
  };
  app.get('/api/admin/monitors', (_req, res) => res.json(store.monitors().map(adminMonitor)));
  const saveMonitor = (req: Request, res: Response) => {
    const input = monitorSchema.parse(req.body),
      id = String(req.params.id ?? randomUUID());
    const existing = store.monitor(id);
    if (req.params.id && !existing) return res.status(404).json({ error: '监控目标不存在' });
    if (worker.isRunning(id)) return res.status(409).json({ error: '正在探测，请结束后再修改' });
    const old = existing
      ? store.decrypt<Credentials>(existing.secret)
      : { apiKey: '', headers: {} };
    const { apiKey, headers, clearApiKey, ...rest } = input;
    const credentials = {
      apiKey: clearApiKey ? '' : apiKey === undefined || apiKey === '' ? old.apiKey : apiKey,
      headers: headers ?? old.headers,
    };
    const changed =
      (!!existing &&
        (['provider', 'endpoint', 'baseUrl', 'model', 'prompt', 'path', 'maxTokens'] as const).some(
          (key) => existing[key] !== rest[key],
        )) ||
      (!!existing &&
        (JSON.stringify(existing.body) !== JSON.stringify(rest.body) ||
          JSON.stringify(old) !== JSON.stringify(credentials)));
    const m: Monitor = {
      ...rest,
      icon: input.icon ?? existing?.icon ?? 'auto',
      id,
      createdAt: existing?.createdAt ?? Date.now(),
      nextRunAt:
        existing &&
        !changed &&
        existing.enabled === rest.enabled &&
        existing.intervalSeconds === rest.intervalSeconds
          ? existing.nextRunAt
          : Date.now() + 3000,
      failureSince: existing?.failureSince ?? null,
      lastHealth: existing?.lastHealth ?? 'unknown',
      secret: store.encrypt(credentials),
      revision: (existing?.revision ?? 1) + (changed ? 1 : 0),
    };
    if (existing && (!existing.enabled || !m.enabled || changed)) {
      m.failureSince = null;
      m.lastHealth = 'unknown';
    }
    store.saveMonitor(m);
    res.status(existing ? 200 : 201).json(adminMonitor(m));
  };
  app.post('/api/admin/monitors', saveMonitor);
  app.put('/api/admin/monitors/:id', saveMonitor);
  app.delete('/api/admin/monitors/:id', (req, res) => {
    const id = String(req.params.id);
    if (worker.isRunning(id)) return res.status(409).json({ error: '正在探测，请结束后再删除' });
    if (!store.monitor(id)) return res.status(404).json({ error: '监控目标不存在' });
    store.deleteMonitor(id);
    res.json({ ok: true });
  });
  app.post(
    '/api/admin/monitors/:id/probe',
    wrap(async (req, res) => {
      const id = String(req.params.id);
      if (!store.monitor(id)) return res.status(404).json({ error: '目标不存在' });
      if (worker.isRunning(id)) return res.status(409).json({ error: '正在探测中' });
      if (worker.activeCount >= 3)
        return res.status(429).json({ error: '探测并发已满，请稍后再试' });
      return res.json(await worker.run(id));
    }),
  );
  app.get('/api/admin/settings', (_req, res) => res.json(store.settings()));
  app.put('/api/admin/settings', (req, res) => {
    const settings = settingsSchema.parse(req.body);
    store.set('settings', settings);
    res.json(settings);
  });
  app.get('/api/admin/incidents', (_req, res) => res.json(store.incidents()));
  const saveIncident = (req: Request, res: Response) => {
    const input = incidentSchema.parse(req.body),
      id = String(req.params.id ?? randomUUID());
    const existing = store.incidents().find((i) => i.id === id);
    if (req.params.id && !existing) return res.status(404).json({ error: '公告不存在' });
    if (input.monitorId && !store.monitor(input.monitorId))
      return res.status(400).json({ error: '关联的监控目标不存在' });
    const incident: Incident = {
      ...input,
      id,
      updatedAt: Date.now(),
      resolvedAt: input.status === 'resolved' ? (existing?.resolvedAt ?? Date.now()) : null,
      automatic: existing?.automatic ?? false,
    };
    store.saveIncident(incident);
    res.status(existing ? 200 : 201).json(incident);
  };
  app.post('/api/admin/incidents', saveIncident);
  app.put('/api/admin/incidents/:id', saveIncident);
  app.delete('/api/admin/incidents/:id', (req, res) => {
    store.deleteIncident(String(req.params.id));
    res.json({ ok: true });
  });
  const adminChannel = (c: Channel): AdminChannel => {
    const config = store.decrypt<Record<string, unknown>>(c.config);
    const hasSecret = !!(config.password || config.token || config.secret);
    for (const k of ['password', 'token', 'secret']) if (k in config) config[k] = '';
    return { ...c, config, hasSecret };
  };
  app.get('/api/admin/channels', (_req, res) => res.json(store.channels().map(adminChannel)));
  const saveChannel = (req: Request, res: Response) => {
    const input = channelSchema.parse(req.body),
      id = String(req.params.id ?? randomUUID());
    const existing = store.channels().find((c) => c.id === id);
    if (req.params.id && !existing) return res.status(404).json({ error: '告警渠道不存在' });
    const config = safeChannelConfig(
      input.kind,
      input.config,
      existing && existing.kind === input.kind ? store.decrypt(existing.config) : {},
    );
    const c: Channel = { ...input, id, config: store.encrypt(config) };
    store.saveChannel(c);
    res.status(existing ? 200 : 201).json(adminChannel(c));
  };
  app.post('/api/admin/channels', saveChannel);
  app.put('/api/admin/channels/:id', saveChannel);
  app.delete('/api/admin/channels/:id', (req, res) => {
    store.deleteChannel(String(req.params.id));
    res.json({ ok: true });
  });
  app.post(
    '/api/admin/channels/:id/test',
    wrap(async (req, res) => {
      const c = store.channels().find((c) => c.id === req.params.id);
      if (!c) return res.status(404).json({ error: '告警渠道不存在' });
      const ok = await deliver(
        store,
        c,
        'test',
        null,
        '告警渠道测试\n这是一条来自 Lumen 的测试通知。',
      );
      return res
        .status(ok ? 200 : 502)
        .json(ok ? { ok: true } : { error: '发送失败，请检查配置；详情已记录到发送日志' });
    }),
  );
  app.get('/api/admin/alerts', (_req, res) => res.json(store.alerts()));
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));
  const staticDir = options.staticDir ?? resolve('dist/client');
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(staticDir, 'index.html')));
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError)
      return res
        .status(400)
        .json({ error: error.issues.map((i) => `${i.path.join('.')}：${i.message}`).join('；') });
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'JSON 格式不正确' });
    // Only expected validation messages are safe to surface; don't leak raw networking/SQL errors.
    const message = error instanceof Error ? error.message : '';
    if (/^(密码需|请填写|Webhook URL|SMTP |请选择 SMTP|目标不存在|该目标正在)/.test(message))
      return res.status(400).json({ error: message });
    return res.status(500).json({ error: '操作失败，请检查配置或稍后重试' });
  });
  if (options.worker !== false) worker.start();
  return { app, worker };
}
