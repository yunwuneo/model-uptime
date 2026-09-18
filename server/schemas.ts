import { z } from 'zod';
import { iconOptions } from '../shared/model-brand.js';
z.config(z.locales.zhCN());

const baseUrl = z
  .string()
  .url()
  .max(1000)
  .refine((s) => {
    const u = new URL(s);
    return (
      ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash
    );
  }, '地址仅支持 HTTP(S)，不允许包含凭据、查询参数或片段');
export const monitorSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    group: z.string().trim().min(1).max(80),
    provider: z.enum(['openai', 'anthropic', 'gemini']),
    endpoint: z.enum(['chat', 'responses', 'messages', 'generate', 'embedding', 'image', 'custom']),
    baseUrl,
    model: z.string().trim().min(1).max(200),
    icon: z.enum(iconOptions).optional(),
    enabled: z.boolean().default(true),
    intervalSeconds: z.number().int().min(60).max(86400),
    timeoutSeconds: z.number().int().min(5).max(300),
    maxTokens: z.number().int().min(16).max(4096),
    prompt: z.string().min(1).max(4000),
    path: z
      .string()
      .max(300)
      .default('')
      .refine((s) => !s || /^\/(?!\/)[^?#]*$/.test(s), '自定义路径必须以单个 / 开头，不含查询参数'),
    body: z.record(z.string(), z.unknown()).default({}),
    apiKey: z.string().max(4000).optional(),
    clearApiKey: z.boolean().optional(),
    headers: z.record(z.string().regex(/^[a-zA-Z0-9-]+$/), z.string().max(4000)).optional(),
    ttftThresholdMs: z.number().min(100).max(300000),
    tpsThreshold: z.number().min(0).max(10000),
    latencyThresholdMs: z.number().min(100).max(300000),
  })
  .superRefine((m, ctx) => {
    const allowed: Record<string, string[]> = {
      openai: ['chat', 'responses', 'embedding', 'image', 'custom'],
      anthropic: ['messages', 'custom'],
      gemini: ['generate', 'embedding', 'image', 'custom'],
    };
    if (!allowed[m.provider].includes(m.endpoint))
      ctx.addIssue({ code: 'custom', message: '协议与端点类型不匹配', path: ['endpoint'] });
    if (m.endpoint === 'custom' && !m.path)
      ctx.addIssue({ code: 'custom', message: '请填写自定义端点路径', path: ['path'] });
    const forbidden = ['host', 'content-length', 'connection', 'transfer-encoding', 'cookie'];
    if (Object.keys(m.headers ?? {}).some((k) => forbidden.includes(k.toLowerCase())))
      ctx.addIssue({
        code: 'custom',
        message: '不支持覆写连接或 Cookie 请求头',
        path: ['headers'],
      });
  });
export const settingsSchema = z.object({
  title: z.string().trim().min(1).max(40),
  description: z.string().trim().max(160),
  defaultIntervalSeconds: z.number().int().min(60).max(86400),
  downAfterSeconds: z.number().int().min(60).max(86400),
  retentionDays: z.number().int().min(7).max(365),
  autoIncidents: z.boolean(),
});
export const incidentSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(6000),
    status: z.enum(['investigating', 'identified', 'monitoring', 'resolved', 'maintenance']),
    severity: z.enum(['minor', 'major', 'maintenance']),
    monitorId: z.string().nullable().default(null),
    startedAt: z.number().int().positive(),
    scheduledEnd: z.number().int().positive().nullable().default(null),
  })
  .refine((i) => !i.scheduledEnd || i.scheduledEnd > i.startedAt, '结束时间必须晚于开始时间');
export const channelSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['webhook', 'telegram', 'email']),
  enabled: z.boolean(),
  onDegraded: z.boolean(),
  onDown: z.boolean(),
  onRecovery: z.boolean(),
  config: z.record(z.string(), z.unknown()),
});
