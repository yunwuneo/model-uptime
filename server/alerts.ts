import nodemailer from 'nodemailer';
import type { Channel, Health, Monitor } from '../shared/types.js';
import type { Store } from './store.js';

const label: Record<Health, string> = {
  operational: '已恢复',
  degraded: '性能下降',
  pending: '异常待确认',
  down: '服务故障',
  unknown: '暂无数据',
  paused: '已暂停',
};
export function safeChannelConfig(
  kind: Channel['kind'],
  input: Record<string, unknown>,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const config = { ...existing, ...input };
  for (const key of ['password', 'token', 'secret'])
    if (input[key] === '') config[key] = existing[key] ?? '';
  const required = (key: string) => {
    if (typeof config[key] !== 'string' || !(config[key] as string).trim())
      throw new Error(`请填写 ${key}`);
  };
  if (kind === 'webhook') {
    required('url');
    const u = new URL(config.url as string);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
      throw new Error('Webhook URL 必须为不含身份凭据的 HTTP(S) 地址');
  } else if (kind === 'telegram') {
    required('token');
    required('chatId');
  } else {
    for (const k of ['host', 'from', 'to']) required(k);
    if (typeof config.port !== 'number' || config.port < 1 || config.port > 65535)
      throw new Error('SMTP 端口无效');
    if (typeof config.secure !== 'boolean') throw new Error('请选择 SMTP TLS 方式');
    if (config.user && !config.password) throw new Error('请填写 SMTP 密码');
  }
  return config;
}
export async function deliver(
  store: Store,
  channel: Channel,
  event: string,
  monitor: Pick<Monitor, 'id' | 'name'> | null,
  message: string,
): Promise<boolean> {
  let success = false,
    error: string | null = null;
  try {
    const c = store.decrypt<Record<string, any>>(channel.config);
    if (channel.kind === 'email') {
      const transport = nodemailer.createTransport({
        host: c.host,
        port: c.port,
        secure: c.secure,
        requireTLS: !c.secure,
        ...(c.user ? { auth: { user: c.user, pass: c.password } } : {}),
        connectionTimeout: 10000,
        socketTimeout: 15000,
      });
      try {
        await transport.sendMail({
          from: c.from,
          to: c.to,
          subject: `[${store.settings().title}] ${message.split('\n')[0]}`,
          text: message,
        });
      } finally {
        transport.close();
      }
    } else {
      const telegram = channel.kind === 'telegram';
      const url = telegram ? `https://api.telegram.org/bot${c.token}/sendMessage` : c.url;
      const response = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          ...(!telegram && c.secret ? { Authorization: `Bearer ${c.secret}` } : {}),
        },
        body: JSON.stringify(
          telegram
            ? { chat_id: c.chatId, text: message }
            : {
                event,
                monitor: monitor ? { id: monitor.id, name: monitor.name } : null,
                message,
                timestamp: new Date().toISOString(),
              },
        ),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('delivery_failed');
      }
      if (telegram) {
        const json = (await response.json()) as { ok?: boolean };
        if (!json.ok) throw new Error('delivery_failed');
      } else await response.body?.cancel();
    }
    success = true;
  } catch {
    error = '发送失败，请检查目标地址、凭据、网络与 SMTP TLS 配置';
  }
  store.logAlert({
    channelId: channel.id,
    channelName: channel.name,
    monitorId: monitor?.id ?? null,
    event,
    success,
    error,
  });
  return success;
}
export async function notify(store: Store, monitor: Monitor, before: Health, after: Health) {
  if (before === after) return;
  const event =
    after === 'down'
      ? 'down'
      : after === 'degraded'
        ? 'degraded'
        : after === 'operational' && ['down', 'degraded', 'pending'].includes(before)
          ? 'recovery'
          : null;
  if (!event) return;
  const channels = store
    .channels()
    .filter(
      (c) =>
        c.enabled &&
        (event === 'down' ? c.onDown : event === 'degraded' ? c.onDegraded : c.onRecovery),
    );
  const message = `${monitor.name} · ${label[after]}\n时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n接口：${monitor.baseUrl}\n模型：${monitor.model}`;
  await Promise.allSettled(channels.map((c) => deliver(store, c, event, monitor, message)));
}
