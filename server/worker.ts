import { randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import type { Credentials } from './probe.js';
import { probe } from './probe.js';
import { health } from './domain.js';
import { notify } from './alerts.js';

export class Worker {
  private running = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private store: Store) {}
  isRunning(id: string) {
    return this.running.has(id);
  }
  get activeCount() {
    return this.running.size;
  }
  async run(id: string) {
    const m = this.store.monitor(id);
    if (!m || !m.enabled) throw new Error('目标不存在或已暂停');
    if (this.running.has(id)) throw new Error('该目标正在探测，请稍后再试');
    if (this.running.size >= 3) throw new Error('探测并发已满，请稍后再试');
    this.running.add(id);
    try {
      this.store.saveMonitor({ ...m, nextRunAt: Date.now() + m.intervalSeconds * 1000 });
      const p = await probe(m, this.store.decrypt<Credentials>(m.secret));
      // 编辑/暂停/删除时不把旧配置覆盖回数据库。
      const current = this.store.monitor(id);
      if (!current) return p;
      const staleBefore = this.store.latest(id);
      this.store.saveProbe(p);
      const uninterrupted =
        m.failureSince !== null &&
        staleBefore &&
        p.checkedAt - staleBefore.checkedAt <= m.intervalSeconds * 2 * 1000;
      let updated = {
        ...current,
        failureSince: p.success ? null : uninterrupted ? m.failureSince : p.checkedAt,
      };
      const state = health(updated, p, this.store.settings());
      const before = current.lastHealth;
      updated = { ...updated, lastHealth: state };
      this.store.saveMonitor(updated);
      if (this.store.settings().autoIncidents) {
        const open = this.store
          .incidents()
          .find((i) => i.automatic && i.monitorId === id && i.status !== 'resolved');
        if (state === 'down' && !open) {
          const now = Date.now();
          this.store.saveIncident({
            id: randomUUID(),
            title: `${m.name} 服务异常`,
            status: 'investigating',
            severity: 'major',
            monitorId: id,
            body: `自动探测持续失败超过 ${Math.round(this.store.settings().downAfterSeconds / 60)} 分钟，正在等待恢复。`,
            startedAt: updated.failureSince ?? now,
            updatedAt: now,
            resolvedAt: null,
            scheduledEnd: null,
            automatic: true,
          });
        } else if (p.success && open)
          this.store.saveIncident({
            ...open,
            status: 'resolved',
            body: '自动探测已恢复成功。',
            updatedAt: Date.now(),
            resolvedAt: Date.now(),
          });
      }
      await notify(this.store, updated, before, state);
      return p;
    } finally {
      this.running.delete(id);
    }
  }
  tick() {
    this.store.set('workerHeartbeat', Date.now());
    // 有限并发，避免大量目标同时消耗上游配额；错峰由 nextRunAt 管理。
    for (const m of this.store.monitors()) {
      if (this.running.size >= 3) break;
      if (m.enabled && m.nextRunAt <= Date.now() && !this.running.has(m.id))
        void this.run(m.id).catch(() => {});
    }
  }
  start() {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), 5000);
    this.timer.unref();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  async drain() {
    this.stop();
    while (this.running.size) await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
