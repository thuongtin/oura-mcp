/**
 * Markdown collection previews must show the fields that exist on each Oura
 * domain record. A missing field list must not print n/a, skip 0, or hide nested
 * objects such as spo2_percentage.average.
 */
import assert from 'node:assert/strict';
import { formatCollection } from '../dist/services/format.js';

function recordBlock(markdown, id) {
  const heading = `## ${id}`;
  const start = markdown.indexOf(heading);
  assert.ok(start >= 0, `missing heading ${id}`);
  const rest = markdown.slice(start + heading.length);
  const next = rest.search(/\n## /);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function markdownKeys(block) {
  return [...block.matchAll(/^- \*\*([^*]+)\*\*: (.*)$/gm)].map((match) => [match[1], match[2]]);
}

function presentEntries(record) {
  return Object.entries(record).filter(([key, value]) => (
    key !== 'id' && key !== 'id_str' && value !== undefined && value !== null && value !== ''
  ));
}

const fixtures = [
  {
    title: 'Oura Daily Sleep',
    record: {
      id: 'sleep-1',
      day: '2026-08-17',
      score: 83,
      timestamp: '2026-08-17T00:00:00.000+00:00',
      contributors: { deep_sleep: 82, efficiency: 97, total_sleep: 70 }
    }
  },
  {
    title: 'Oura Daily Readiness',
    record: {
      id: 'ready-1',
      day: '2026-08-17',
      score: 80,
      timestamp: '2026-08-17T00:00:00.000+00:00',
      contributors: { recovery_index: 33, resting_heart_rate: 100 },
      temperature_deviation: -0.03
    }
  },
  {
    title: 'Oura Daily SpO2',
    record: {
      id: 'spo2-1',
      day: '2026-08-19',
      spo2_percentage: { average: 96.865 },
      breathing_disturbance_index: 0
    }
  },
  {
    title: 'Oura Daily Activity',
    record: {
      id: 'act-1',
      day: '2026-08-19',
      score: 88,
      steps: 0,
      active_calories: 12,
      contributors: { stay_active: 70 }
    }
  },
  {
    title: 'Oura Workouts',
    record: {
      id: 'wo-1',
      day: '2026-08-19',
      activity: 'cycling',
      intensity: 'moderate',
      start_datetime: '2026-08-19T01:00:00Z',
      end_datetime: '2026-08-19T02:00:00Z',
      distance: 12000
    }
  },
  {
    title: 'Oura Heart Rate',
    record: {
      id: 'hr-1',
      timestamp: '2026-08-19T22:00:43.000Z',
      bpm: 52,
      source: 'rest'
    }
  }
];

for (const fixture of fixtures) {
  const markdown = formatCollection(fixture.title, [fixture.record], {
    endpoint: fixture.title,
    privacy_mode: 'structured',
    count: 1,
    records: [fixture.record],
    pages_fetched: 1
  });
  const block = recordBlock(markdown, fixture.record.id);
  const rendered = Object.fromEntries(markdownKeys(block));
  assert.doesNotMatch(block, /n\/a/, `${fixture.title} must not print n/a`);
  assert.doesNotMatch(block, /start\/created/, `${fixture.title} must not use the workout start/created label`);
  assert.doesNotMatch(block, /sport\/type/, `${fixture.title} must not use the workout sport/type label`);

  for (const [key, value] of presentEntries(fixture.record)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && 'average' in value) {
      assert.equal(rendered[`${key}.average`], String(value.average), `${fixture.title} missing ${key}.average`);
      continue;
    }
    assert.ok(key in rendered, `${fixture.title} markdown dropped ${key}`);
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
      assert.equal(rendered[key], String(value), `${fixture.title} ${key} mismatch`);
    }
  }
}

const spo2Markdown = formatCollection('Oura Daily SpO2', [{
  id: 'spo2-1',
  day: '2026-08-19',
  spo2_percentage: { average: 96.865 },
  breathing_disturbance_index: 0
}], { count: 1, records: [], pages_fetched: 1 });
assert.match(spo2Markdown, /\*\*spo2_percentage\.average\*\*: 96\.865/);
assert.match(spo2Markdown, /\*\*breathing_disturbance_index\*\*: 0/);

const activityZero = formatCollection('Oura Daily Activity', [{
  id: 'act-1',
  day: '2026-08-19',
  steps: 0,
  score: 1
}], { count: 1, records: [], pages_fetched: 1 });
assert.match(activityZero, /\*\*steps\*\*: 0/);

const unknownDomain = formatCollection('Oura Mystery', [{
  id: 'x-1',
  widget: 'alpha',
  count: 0
}], { count: 1, records: [], pages_fetched: 1 });
assert.match(unknownDomain, /\*\*widget\*\*: alpha/);
assert.match(unknownDomain, /\*\*count\*\*: 0/);
assert.doesNotMatch(unknownDomain, /n\/a/);

console.log(JSON.stringify({
  ok: true,
  suite: 'format-collection',
  domains: fixtures.map((fixture) => fixture.title),
  leftover_fallback: true,
  zero_preserved: true
}, null, 2));
