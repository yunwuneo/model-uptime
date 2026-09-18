import type { Store } from './store.js';
import type { PublicMonitor, StatusPage } from '../shared/types.js';
import { dailyHistory, health, metrics, overall } from './domain.js';
import { buildRequest } from './probe.js';

export function statusPage(store: Store, hours: number): StatusPage {
  const settings = store.settings(),
    now = Date.now();
  const monitors: PublicMonitor[] = store.monitors().map((m) => {
    const latest = store.latest(m.id),
      rows = store.probes(m.id, now - hours * 3600000);
    return {
      id: m.id,
      name: m.name,
      group: m.group,
      provider: m.provider,
      endpoint: m.endpoint,
      baseUrl: m.baseUrl,
      url: buildRequest(m, { apiKey: '', headers: {} }).url,
      model: m.model,
      icon: m.icon,
      enabled: m.enabled,
      intervalSeconds: m.intervalSeconds,
      health: health(m, latest, settings, now),
      failureSince: m.failureSince,
      latest,
      metrics: metrics(rows),
      series:
        rows.length <= 672
          ? rows
          : rows.filter(
              (_p, i) => i === 0 || i === rows.length - 1 || i % Math.ceil(rows.length / 670) === 0,
            ),
      history: dailyHistory(store.probes(m.id, now - 90 * 86400000), 90, now),
    };
  });
  const lastTick = store.get<number>('workerHeartbeat');
  const activeIds = new Set(monitors.filter((m) => m.enabled).map((m) => m.id));
  const revisions = new Map(store.monitors().map((m) => [m.id, m.revision]));
  return {
    site: {
      title: settings.title,
      description: settings.description,
      downAfterSeconds: settings.downAfterSeconds,
      defaultIntervalSeconds: settings.defaultIntervalSeconds,
    },
    health: overall(monitors.map((m) => m.health)),
    monitors,
    metrics: metrics(
      store
        .probes(null, now - hours * 3600000)
        .filter((p) => activeIds.has(p.monitorId) && revisions.get(p.monitorId) === p.revision),
    ),
    incidents: store.incidents().slice(0, 100),
    generatedAt: now,
    demo: false,
    worker: { alive: lastTick !== null && now - lastTick < 20000, lastTick },
  };
}
