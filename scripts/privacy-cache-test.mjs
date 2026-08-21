import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPrivacyAudit } from '../dist/services/audit.js';
import { OuraCache } from '../dist/services/cache.js';
import { applyPrivacy, normalizeStreams } from '../dist/services/privacy.js';
import { redactErrorMessage, redactSensitive } from '../dist/services/redaction.js';

const activity = {
  id: 123,
  name: 'Morning Ride',
  activity: 'Ride',
  distance: 42,
  active_calories: 520,
  start_latlng: [40.1, -73.1],
  map: { summary_polyline: 'encoded' },
  average_heart_rate: 142
};

const structured = applyPrivacy('/usercollection/workout', activity, 'structured');
assert.equal(structured.id, 123);
assert.equal(structured.average_heart_rate, 142);
assert.equal(structured.start_latlng, undefined);
assert.equal(structured.map, undefined);

const summary = applyPrivacy('/usercollection/workout', activity, 'summary');
assert.equal(summary.activity, 'Ride');
assert.equal(summary.active_calories, 520);
assert.equal(summary.map, undefined);

const raw = applyPrivacy('/usercollection/workout', activity, 'raw');
assert.equal(raw.map.summary_polyline, 'encoded');

const futureStructured = applyPrivacy('/usercollection/daily_readiness', {
  id: 'future-record',
  day: '2026-07-08',
  score: 84,
  contributors: { recovery_index: 91 },
  futureMetrics: { cardiovascularAge: 37 },
}, 'structured');
assert.deepEqual(futureStructured.contributors, { recovery_index: 91 });
assert.deepEqual(futureStructured.futureMetrics, { cardiovascularAge: 37 });

const stressStructured = applyPrivacy('/usercollection/daily_stress', {
  id: 'stress-1',
  day: '2026-08-17',
  day_summary: 'restored',
  recovery_high: 3660,
  stress_high: 90,
  email: 'hidden@example.com'
}, 'structured');
assert.equal(stressStructured.day_summary, 'restored');
assert.equal(stressStructured.recovery_high, 61);
assert.equal(stressStructured.stress_high, 2);
assert.equal(stressStructured.email, undefined);

const stressSummary = applyPrivacy('/usercollection/daily_stress', {
  id: 'stress-1',
  day: '2026-08-17',
  day_summary: 'stressful',
  recovery_high: 0,
  stress_high: 1800
}, 'summary');
assert.equal(stressSummary.day_summary, 'stressful');
assert.equal(stressSummary.recovery_high, 0);
assert.equal(stressSummary.stress_high, 30);
assert.equal(stressSummary.email, undefined);

const stressRaw = applyPrivacy('/usercollection/daily_stress', {
  id: 'stress-1',
  recovery_high: 3660,
  stress_high: 90
}, 'raw');
assert.equal(stressRaw.recovery_high, 3660);
assert.equal(stressRaw.stress_high, 90);

const sleepStructured = applyPrivacy('/usercollection/sleep', {
  id: 'sleep-1',
  type: 'long_sleep',
  total_sleep_duration: 3660,
  awake_time: 90,
  time_in_bed: 3720,
  latency: 30,
  deep_sleep_duration: 1800
}, 'structured');
assert.equal(sleepStructured.type, 'long_sleep');
assert.equal(sleepStructured.total_sleep_duration, 61);
assert.equal(sleepStructured.awake_time, 2);
assert.equal(sleepStructured.time_in_bed, 62);
assert.equal(sleepStructured.latency, 1);
assert.equal(sleepStructured.deep_sleep_duration, 30);

const sleepRaw = applyPrivacy('/usercollection/sleep', {
  total_sleep_duration: 3660,
  awake_time: 90
}, 'raw');
assert.equal(sleepRaw.total_sleep_duration, 3660);
assert.equal(sleepRaw.awake_time, 90);

const activityTimes = applyPrivacy('/usercollection/daily_activity', {
  id: 'act-1',
  steps: 100,
  sedentary_time: 3600,
  high_activity_time: 90,
  non_wear_time: 0
}, 'structured');
assert.equal(activityTimes.steps, 100);
assert.equal(activityTimes.sedentary_time, 60);
assert.equal(activityTimes.high_activity_time, 2);
assert.equal(activityTimes.non_wear_time, 0);

const activityRaw = applyPrivacy('/usercollection/daily_activity', {
  sedentary_time: 3600
}, 'raw');
assert.equal(activityRaw.sedentary_time, 3600);

const streams = normalizeStreams({ heartrate: { data: [120, 121] }, latlng: { data: [[1, 2]] } }, 'structured', false);
assert.equal(streams.latlng, undefined);
assert.deepEqual(streams.heartrate.data, [120, 121]);

assert.equal(redactSensitive({ access_token: 'abc', nested: { client_secret: 'def' } }).access_token, '[REDACTED]');
assert.match(redactErrorMessage('Authorization: Bearer abc.def.ghi'), /REDACTED/);
assert.equal(buildPrivacyAudit().unofficial, true);
assert.equal(buildPrivacyAudit().gps_redaction_default, true);

const dir = mkdtempSync(join(tmpdir(), 'oura-mcp-cache-'));
try {
  const path = join(dir, 'cache.sqlite');
  const cache = new OuraCache(path);
  cache.set('GET', 'https://example.com/a', { ok: true });
  assert.deepEqual(cache.get('GET', 'https://example.com/a'), { ok: true });
  assert.equal(cache.status().entries, 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, privacy: true, cache: true, redaction: true, audit: true }, null, 2));

// Agent raw escalation requires explicit_user_intent
{
  const { resolvePrivacyMode } = await import('../dist/services/privacy.js');
  const cfg = { privacyMode: 'structured' };
  try {
    resolvePrivacyMode(cfg, 'raw', { explicit_user_intent: false });
    assert.fail('raw without intent should throw');
  } catch (e) {
    assert.match(String(e.message || e), /USER_ACTION_REQUIRED|explicit_user_intent/i);
  }
  assert.equal(resolvePrivacyMode(cfg, 'raw', { explicit_user_intent: true }), 'raw');
  assert.equal(resolvePrivacyMode({ privacyMode: 'raw' }), 'raw');
  console.log(JSON.stringify({ ok: true, suite: 'privacy-escalation-gate' }, null, 2));
}
