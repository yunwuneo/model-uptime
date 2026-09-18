export type Provider = 'openai' | 'anthropic' | 'gemini';
export type ModelBrand =
  | 'openai'
  | 'google'
  | 'xai'
  | 'anthropic'
  | 'deepseek'
  | 'meta'
  | 'mistral'
  | 'qwen'
  | 'moonshot'
  | 'doubao'
  | 'zhipu'
  | 'minimax'
  | 'baidu'
  | 'generic';
export type IconPreference = 'auto' | ModelBrand;
export type Endpoint =
  'chat' | 'responses' | 'messages' | 'generate' | 'embedding' | 'image' | 'custom';
export type Health = 'operational' | 'degraded' | 'pending' | 'down' | 'unknown' | 'paused';
export interface Monitor {
  id: string;
  name: string;
  group: string;
  provider: Provider;
  endpoint: Endpoint;
  baseUrl: string;
  model: string;
  icon: IconPreference;
  enabled: boolean;
  intervalSeconds: number;
  timeoutSeconds: number;
  maxTokens: number;
  prompt: string;
  path: string;
  body: Record<string, unknown>;
  ttftThresholdMs: number;
  tpsThreshold: number;
  latencyThresholdMs: number;
  createdAt: number;
  nextRunAt: number;
  failureSince: number | null;
  lastHealth: Health;
  secret: string;
  revision: number;
}
export type MonitorInput = Omit<
  Monitor,
  'id' | 'createdAt' | 'nextRunAt' | 'failureSince' | 'lastHealth' | 'secret' | 'revision'
> & {
  apiKey?: string;
  headers?: Record<string, string>;
  clearApiKey?: boolean;
};
export interface Probe {
  id: string;
  monitorId: string;
  revision: number;
  checkedAt: number;
  success: boolean;
  latencyMs: number;
  ttftMs: number | null;
  tps: number | null;
  outputTokens: number | null;
  httpStatus: number | null;
  error: string | null;
  tokenSource: 'reported' | 'unavailable';
}
export interface Metrics {
  samples: number;
  successRate: number | null;
  ttftP50: number | null;
  ttftP95: number | null;
  latencyP50: number | null;
  latencyP95: number | null;
  tpsP50: number | null;
  tpsP95: number | null;
}
export interface HistoryDay {
  date: string;
  successRate: number | null;
  samples: number;
}
export interface PublicMonitor {
  id: string;
  name: string;
  group: string;
  provider: Provider;
  endpoint: Endpoint;
  baseUrl: string;
  url: string;
  model: string;
  icon: IconPreference;
  enabled: boolean;
  intervalSeconds: number;
  health: Health;
  failureSince: number | null;
  latest: Probe | null;
  metrics: Metrics;
  history: HistoryDay[];
  series: Probe[];
}
export interface Incident {
  id: string;
  title: string;
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved' | 'maintenance';
  severity: 'minor' | 'major' | 'maintenance';
  monitorId: string | null;
  body: string;
  startedAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  scheduledEnd: number | null;
  automatic: boolean;
}
export interface SiteSettings {
  title: string;
  description: string;
  defaultIntervalSeconds: number;
  downAfterSeconds: number;
  retentionDays: number;
  autoIncidents: boolean;
}
export interface StatusPage {
  site: Pick<SiteSettings, 'title' | 'description' | 'downAfterSeconds' | 'defaultIntervalSeconds'>;
  health: Health;
  monitors: PublicMonitor[];
  metrics: Metrics;
  incidents: Incident[];
  generatedAt: number;
  demo: boolean;
  worker: { alive: boolean; lastTick: number | null };
}
export type ChannelKind = 'webhook' | 'telegram' | 'email';
export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind;
  enabled: boolean;
  onDegraded: boolean;
  onDown: boolean;
  onRecovery: boolean;
  config: string;
}
export interface AlertLog {
  id: string;
  channelId: string;
  channelName: string;
  monitorId: string | null;
  event: string;
  success: boolean;
  error: string | null;
  createdAt: number;
}
export interface AdminMonitor extends Omit<Monitor, 'secret'> {
  hasKey: boolean;
  headerNames: string[];
  health: Health;
  latest: Probe | null;
}
export interface AdminChannel extends Omit<Channel, 'config'> {
  config: Record<string, unknown>;
  hasSecret: boolean;
}
