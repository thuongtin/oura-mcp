import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConnectionStatus } from '../dist/services/connection-status.js';
import { formatCollection } from '../dist/services/format.js';

const dir = mkdtempSync(join(tmpdir(), 'oura-mcp-agent-readiness-'));

try {
  const markdown = formatCollection('Oura Activities', [
    { id: 1, name: 'Morning Tennis', sport_type: 'Tennis', start_date: '2026-04-27T12:30:43Z', distance: 41.3 },
    { id: 2, name: 'Afternoon Tennis', sport_type: 'Tennis', start_date: '2026-04-26T20:05:51Z', distance: 4557 }
  ], {
    endpoint: '/1/user/-/activities/list.json',
    privacy_mode: 'summary',
    count: 2,
    records: [{ id: 1 }, { id: 2 }],
    pages_fetched: 1
  });

  assert.doesNotMatch(markdown, /\[object Object\]/, 'Markdown previews must never leak JavaScript object stringification.');
  assert.doesNotMatch(markdown, /\*\*records\*\*/i, 'Collection markdown should not duplicate full record arrays in metadata.');
  assert.match(markdown, /Morning Tennis/);
  assert.match(markdown, /sport_type/);

  const sleepMarkdown = formatCollection('Oura Daily Sleep', [
    { id: 'sleep-1', day: '2026-08-20', score: 80, contributors: { total_sleep: 78, efficiency: 90 } }
  ], {
    endpoint: '/usercollection/daily_sleep',
    privacy_mode: 'structured',
    count: 1,
    records: [{ id: 'sleep-1' }],
    pages_fetched: 1
  });
  assert.match(sleepMarkdown, /\*\*day\*\*: 2026-08-20/);
  assert.match(sleepMarkdown, /\*\*score\*\*: 80/);
  assert.doesNotMatch(sleepMarkdown, /n\/a/);
  assert.doesNotMatch(sleepMarkdown, /sport\/type/);
  assert.doesNotMatch(sleepMarkdown, /start\/created/);

  const tokenPath = join(dir, 'tokens.json');
  writeFileSync(tokenPath, JSON.stringify({
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: 2_000_000,
    scope: 'personal'
  }), { mode: 0o600 });

  const limited = await buildConnectionStatus({
    env: {
      OURA_CLIENT_ID: 'client-id',
      OURA_CLIENT_SECRET: 'client-secret',
      OURA_REDIRECT_URI: 'http://127.0.0.1:4567/callback',
      OURA_TOKEN_PATH: tokenPath
    },
    homeDir: dir,
    nowMs: 1_000_000
  });

  assert.equal(limited.ready_for_oura_api, false, 'A personal-only token should not be reported as fully ready for Oura health tools.');
  assert.equal(limited.ok, false);
  assert.deepEqual(limited.oauth.granted_scopes, ['personal']);
  assert.ok(limited.oauth.missing_recommended_scopes.includes('daily'));
  assert.ok(limited.oauth.missing_recommended_scopes.includes('workout'));
  assert.ok(!limited.oauth.missing_recommended_scopes.includes('sleep'), 'Oura has no sleep OAuth scope; doctor must not require it.');
  assert.equal(limited.oauth.activity_tools_ready, false);
  assert.equal(limited.oauth.profile_tools_ready, true);
  assert.ok(limited.next_steps.some((step) => /re-authorize/i.test(step) && /daily/.test(step)));

  // Partial historical grant: five scopes is not the full Oura consent set.
  writeFileSync(tokenPath, JSON.stringify({
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: 2_000_000,
    scope: 'daily heartrate personal workout spo2'
  }), { mode: 0o600 });

  const partial = await buildConnectionStatus({
    env: {
      OURA_CLIENT_ID: 'client-id',
      OURA_CLIENT_SECRET: 'client-secret',
      OURA_REDIRECT_URI: 'http://127.0.0.1:4567/callback',
      OURA_TOKEN_PATH: tokenPath
    },
    homeDir: dir,
    nowMs: 1_000_000
  });
  assert.equal(partial.ok, false);
  assert.ok(partial.oauth.missing_recommended_scopes.includes('email'));
  assert.ok(partial.oauth.missing_recommended_scopes.includes('stress'));
  assert.ok(partial.oauth.missing_recommended_scopes.includes('heart_health'));
  assert.equal(partial.oauth.activity_tools_ready, true);

  // Full Oura consent set (no separate "sleep" scope: sleep lives under daily).
  writeFileSync(tokenPath, JSON.stringify({
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: 2_000_000,
    scope: 'personal daily email heartrate workout tag session spo2 ring_configuration stress heart_health'
  }), { mode: 0o600 });

  const ready = await buildConnectionStatus({
    env: {
      OURA_CLIENT_ID: 'client-id',
      OURA_CLIENT_SECRET: 'client-secret',
      OURA_REDIRECT_URI: 'http://127.0.0.1:4567/callback',
      OURA_TOKEN_PATH: tokenPath
    },
    homeDir: dir,
    nowMs: 1_000_000
  });

  assert.equal(ready.ok, true);
  assert.equal(ready.ready_for_oura_api, true);
  assert.deepEqual(ready.oauth.missing_recommended_scopes, []);
  assert.equal(ready.oauth.activity_tools_ready, true);

  // OpenAPI wire name spo2Daily must satisfy the spo2 recommendation (#8 regression).
  writeFileSync(tokenPath, JSON.stringify({
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: 2_000_000,
    scope: 'personal daily email heartrate workout tag session spo2Daily ring_configuration stress heart_health'
  }), { mode: 0o600 });

  const aliased = await buildConnectionStatus({
    env: {
      OURA_CLIENT_ID: 'client-id',
      OURA_CLIENT_SECRET: 'client-secret',
      OURA_REDIRECT_URI: 'http://127.0.0.1:4567/callback',
      OURA_TOKEN_PATH: tokenPath
    },
    homeDir: dir,
    nowMs: 1_000_000
  });

  assert.equal(aliased.oauth.scope_status, 'ok');
  assert.deepEqual(aliased.oauth.missing_recommended_scopes, []);
  assert.equal(aliased.ok, true);

  // Oura returns granted scopes as extapi:daily. Doctor must not mark them missing.
  writeFileSync(tokenPath, JSON.stringify({
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: 2_000_000,
    scope: 'extapi:personal extapi:daily extapi:email extapi:heartrate extapi:workout extapi:tag extapi:session extapi:spo2 extapi:ring_configuration extapi:stress extapi:heart_health'
  }), { mode: 0o600 });

  const namespaced = await buildConnectionStatus({
    env: {
      OURA_CLIENT_ID: 'client-id',
      OURA_CLIENT_SECRET: 'client-secret',
      OURA_REDIRECT_URI: 'http://127.0.0.1:4567/callback',
      OURA_TOKEN_PATH: tokenPath
    },
    homeDir: dir,
    nowMs: 1_000_000
  });
  assert.equal(namespaced.oauth.scope_status, 'ok');
  assert.deepEqual(namespaced.oauth.missing_recommended_scopes, []);
  assert.equal(namespaced.ok, true);
  assert.ok(namespaced.oauth.granted_scopes.includes('daily'));
  assert.ok(!namespaced.oauth.granted_scopes.some((scope) => scope.startsWith('extapi:')));

  writeFileSync(tokenPath, JSON.stringify({
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: 2_000_000,
    scope: 'extapi:personal extapi:daily extapi:email extapi:heartrate extapi:workout extapi:tag extapi:session extapi:spo2 extapi:ring_configuration extapi:stress extapi:heart_health'
  }), { mode: 0o666 });

  const repaired = await buildConnectionStatus({
    env: {
      OURA_CLIENT_ID: 'client-id',
      OURA_CLIENT_SECRET: 'client-secret',
      OURA_REDIRECT_URI: 'http://127.0.0.1:4567/callback',
      OURA_TOKEN_PATH: tokenPath
    },
    homeDir: dir,
    nowMs: 1_000_000
  });
  assert.equal(repaired.token.secure_permissions, true, 'connection_status must chmod 600 the token file when it can');
  assert.equal(repaired.oauth.scope_status, 'ok');
  assert.equal(repaired.ok, true);
  assert.ok(!repaired.next_steps.some((step) => /chmod 600/.test(step)));

  // Legacy local tokens that still list the non-existent "sleep" scope should not fail.
  writeFileSync(tokenPath, JSON.stringify({
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: 2_000_000,
    scope: 'personal daily email heartrate workout tag session sleep spo2 ring_configuration stress heart_health'
  }), { mode: 0o600 });

  const legacy = await buildConnectionStatus({
    env: {
      OURA_CLIENT_ID: 'client-id',
      OURA_CLIENT_SECRET: 'client-secret',
      OURA_REDIRECT_URI: 'http://127.0.0.1:4567/callback',
      OURA_TOKEN_PATH: tokenPath
    },
    homeDir: dir,
    nowMs: 1_000_000
  });
  assert.equal(legacy.oauth.scope_status, 'ok');
  assert.deepEqual(legacy.oauth.missing_recommended_scopes, []);

  console.log(JSON.stringify({ ok: true, markdown: true, scope_diagnostics: true, spo2_alias: true }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
