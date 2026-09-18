import type { Health, Metrics, Monitor, Probe, SiteSettings, HistoryDay } from '../shared/types.js';

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest rank: 小样本的 P95 是最大值，不插值制造未发生的结果。
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}
export function metrics(probes: Probe[]): Metrics {
  const successful = probes.filter((p) => p.success);
  const ttft = successful.flatMap((p) => (p.ttftMs === null ? [] : [p.ttftMs]));
  const latency = successful.map((p) => p.latencyMs);
  const tps = successful.flatMap((p) => (p.tps === null ? [] : [p.tps]));
  return {
    samples: probes.length,
    successRate: probes.length ? (successful.length / probes.length) * 100 : null,
    ttftP50: percentile(ttft, 0.5),
    ttftP95: percentile(ttft, 0.95),
    latencyP50: percentile(latency, 0.5),
    latencyP95: percentile(latency, 0.95),
    tpsP50: percentile(tps, 0.5),
    tpsP95: percentile(tps, 0.95),
  };
}
export function health(
  m: Monitor,
  latest: Probe | null,
  settings: SiteSettings,
  now = Date.now(),
): Health {
  if (!m.enabled) return 'paused';
  if (!latest) return 'unknown';
  // 停滞的数据不能冒充实时正常，也不能单靠墙上时间宣告接口故障。
  if (now - latest.checkedAt > Math.max(m.intervalSeconds * 2, m.timeoutSeconds + 60) * 1000)
    return 'unknown';
  if (!latest.success)
    return m.failureSince !== null && now - m.failureSince > settings.downAfterSeconds * 1000
      ? 'down'
      : 'pending';
  if (
    (latest.ttftMs !== null && latest.ttftMs > m.ttftThresholdMs) ||
    (latest.tps !== null && latest.tps < m.tpsThreshold) ||
    latest.latencyMs > m.latencyThresholdMs
  )
    return 'degraded';
  return 'operational';
}
export function overall(states: Health[]): Health {
  const active: Health[] = states.filter((s) => s !== 'paused');
  if (!active.length) return 'unknown';
  for (const s of ['down', 'pending', 'degraded', 'unknown'] as Health[])
    if (active.includes(s)) return s;
  return 'operational';
}
export function dailyHistory(probes: Probe[], days = 90, now = Date.now()): HistoryDay[] {
  const dateKey = (ms: number) => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
  const grouped = new Map<string, Probe[]>();
  for (const p of probes) {
    const key = dateKey(p.checkedAt);
    grouped.set(key, [...(grouped.get(key) ?? []), p]);
  }
  return Array.from({ length: days }, (_, i) => {
    const date = dateKey(now - (days - 1 - i) * 86400000);
    const rows = grouped.get(date) ?? [];
    return { date, successRate: metrics(rows).successRate, samples: rows.length };
  });
}
