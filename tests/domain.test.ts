import test from 'node:test';
import assert from 'node:assert/strict';
import type { Probe } from '../shared/types.js';
import { dailyHistory, health, metrics, overall, percentile } from '../server/domain.js';
import { defaults } from '../server/store.js';
import { fixture } from './fixtures.js';
const now = Date.now();
const sample: Probe = {
  id: 'probe',
  monitorId: 'fixture',
  revision: 1,
  checkedAt: now,
  success: true,
  latencyMs: 2000,
  ttftMs: 800,
  tps: 40,
  outputTokens: 32,
  httpStatus: 200,
  error: null,
  tokenSource: 'reported',
};
test('no samples are unknown, never fake 100%', () => {
  assert.equal(metrics([]).successRate, null);
  assert.equal(health(fixture(), null, defaults), 'unknown');
  assert.equal(overall([]), 'unknown');
  assert.equal(overall(['paused']), 'unknown');
});
test('P50/P95 uses nearest rank and successful samples only', () => {
  assert.equal(percentile([100, 300, 200, 400], 0.5), 200);
  assert.equal(percentile([100, 300, 200, 400], 0.95), 400);
  const result = metrics([sample, { ...sample, success: false, ttftMs: 99999 }]);
  assert.equal(result.successRate, 50);
  assert.equal(result.ttftP95, 800);
  assert.equal(result.samples, 2);
  assert.equal(result.tpsP95, 40);
});
test('failures must exceed one hour, not merely reach it', () => {
  const m = fixture({ failureSince: now - 3600000 });
  assert.equal(health(m, { ...sample, success: false }, defaults, now), 'pending');
  assert.equal(health(m, { ...sample, success: false }, defaults, now + 1), 'down');
});
test('stale/paused samples cannot appear healthy or manufacture downtime', () => {
  assert.equal(
    health(fixture(), { ...sample, checkedAt: now - 1800001 }, defaults, now),
    'unknown',
  );
  assert.equal(health(fixture({ enabled: false }), sample, defaults, now), 'paused');
  assert.equal(
    health(
      fixture({ failureSince: now - 7200000 }),
      { ...sample, success: false, checkedAt: now - 3600000 },
      defaults,
      now,
    ),
    'unknown',
  );
});
test('degradation thresholds and worst active status aggregation', () => {
  assert.equal(health(fixture({ ttftThresholdMs: 500 }), sample, defaults, now), 'degraded');
  assert.equal(health(fixture({ tpsThreshold: 50 }), sample, defaults, now), 'degraded');
  assert.equal(health(fixture({ latencyThresholdMs: 1000 }), sample, defaults, now), 'degraded');
  assert.equal(overall(['operational', 'pending', 'down']), 'down');
  assert.equal(overall(['operational', 'paused']), 'operational');
});
test('90-day history preserves absent data and Asia/Shanghai date boundaries', () => {
  const day = Date.parse('2026-09-18T00:00:00+08:00');
  const rows = dailyHistory([{ ...sample, checkedAt: day + 1000 }], 90, day + 2000);
  assert.equal(rows.length, 90);
  assert.equal(rows.at(-1)?.date, '2026-09-18');
  assert.equal(rows.at(-1)?.successRate, 100);
  assert.equal(rows[0].successRate, null);
});
