import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const smokeHome = mkdtempSync(join(tmpdir(), 'oura-mcp-smoke-'));

const expectedTools = [
  'oura_agent_manifest', 'oura_cache_status', 'oura_capabilities', 'oura_connection_status',
  'oura_daily_summary', 'oura_data_inventory', 'oura_demo', 'oura_exchange_code',
  'oura_get_auth_url', 'oura_get_personal_info', 'oura_list_daily_activity', 'oura_list_daily_cardiovascular_age',
  'oura_list_daily_readiness', 'oura_list_daily_resilience',
  'oura_list_daily_sleep', 'oura_list_daily_spo2', 'oura_list_daily_stress', 'oura_list_enhanced_tags',
  'oura_list_heartrate', 'oura_list_rest_mode_periods', 'oura_list_ring_battery', 'oura_list_ring_configuration',
  'oura_list_sessions',
  'oura_list_sleep', 'oura_list_sleep_time', 'oura_list_tags', 'oura_list_vo2_max', 'oura_list_workouts', 'oura_onboarding',
  'oura_privacy_audit', 'oura_profile_get', 'oura_profile_update', 'oura_quickstart',
  'oura_revoke_access', 'oura_weekly_summary', 'oura_wellness_context'
];

const expectedResources = [
  'oura://agent-manifest', 'oura://capabilities', 'oura://inventory', 'oura://latest/readiness',
  'oura://personal-info', 'oura://summary/daily', 'oura://summary/weekly'
];
const expectedPrompts = ['oura_daily_checkin', 'oura_heart_context_investigation', 'oura_weekly_review'];

const client = new Client({ name: 'oura-mcp-smoke-test', version: '0.0.0' });
const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
  env: {
    ...process.env,
    HOME: smokeHome,
    OURA_CLIENT_ID: '',
    OURA_CLIENT_SECRET: '',
    OURA_REDIRECT_URI: '',
    OURA_TOKEN_PATH: join(smokeHome, 'tokens.json')
  }
});
await client.connect(transport);
try {
  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, expectedTools.sort());

  const resources = await client.listResources();
  const resourceUris = resources.resources.map((resource) => resource.uri).sort();
  assert.deepEqual(resourceUris, expectedResources.sort());

  const prompts = await client.listPrompts();
  const promptNames = prompts.prompts.map((prompt) => prompt.name).sort();
  assert.deepEqual(promptNames, expectedPrompts.sort());

  const prompt = await client.getPrompt({ name: 'oura_daily_checkin', arguments: { focus: 'sleep' } });
  assert.ok(prompt.messages[0]?.content?.type === 'text');

  const auditResult = await client.callTool({ name: 'oura_privacy_audit', arguments: { response_format: 'json' } });
  assert.equal(auditResult.structuredContent?.unofficial, true);
  assert.ok(auditResult.structuredContent?.secret_env_vars?.includes('OURA_CLIENT_SECRET'));

  const capabilitiesResult = await client.callTool({ name: 'oura_capabilities', arguments: { response_format: 'json' } });
  assert.equal(capabilitiesResult.structuredContent?.unofficial, true);
  assert.ok(capabilitiesResult.structuredContent?.api_boundary?.does_not_include?.includes('raw accelerometer/device telemetry'));
  assert.ok(capabilitiesResult.structuredContent?.supported_data?.some((entry) => entry.tools?.includes('oura_list_daily_readiness')));
  assert.ok(capabilitiesResult.structuredContent?.supported_data?.some((entry) => entry.tools?.includes('oura_list_daily_stress')));
  for (const name of [
    'oura_list_enhanced_tags', 'oura_list_daily_resilience', 'oura_list_daily_cardiovascular_age',
    'oura_list_vo2_max', 'oura_list_ring_configuration', 'oura_list_ring_battery',
    'oura_list_sleep_time', 'oura_list_rest_mode_periods'
  ]) {
    assert.ok(capabilitiesResult.structuredContent?.supported_data?.some((entry) => entry.tools?.includes(name)), `capabilities missing ${name}`);
  }
  assert.ok(capabilitiesResult.structuredContent?.recommended_agent_flow?.some((step) => step.includes('oura_connection_status')));

  const inventoryResult = await client.callTool({ name: 'oura_data_inventory', arguments: { response_format: 'json' } });
  assert.equal(inventoryResult.structuredContent?.kind, 'data_inventory');
  assert.equal(typeof inventoryResult.structuredContent?.source, 'string');

  const manifestResult = await client.callTool({ name: 'oura_agent_manifest', arguments: { client: 'hermes', response_format: 'json' } });
  assert.equal(manifestResult.structuredContent?.client, 'hermes');
  assert.ok(manifestResult.structuredContent?.hermes?.common_tool_names?.includes('mcp_oura_oura_connection_status'));
  assert.ok(manifestResult.structuredContent?.standard_tools?.includes('oura_list_daily_sleep'));
  assert.ok(manifestResult.structuredContent?.standard_tools?.includes('oura_list_daily_stress'));
  assert.ok(inventoryResult.structuredContent?.categories?.some((entry) => entry.tools?.includes('oura_list_daily_stress')));
  assert.ok(inventoryResult.structuredContent?.categories?.some((entry) => entry.tools?.includes('oura_list_enhanced_tags')));
  assert.ok(inventoryResult.structuredContent?.categories?.some((entry) => entry.tools?.includes('oura_list_vo2_max')));
  assert.equal(manifestResult.structuredContent?.hermes?.no_gateway_restart_for_data_access, true);

  const statusResult = await client.callTool({ name: 'oura_connection_status', arguments: { client: 'hermes', response_format: 'json' } });
  assert.equal(statusResult.structuredContent?.ok, false);
  assert.ok(statusResult.structuredContent?.missing_env?.includes('OURA_CLIENT_ID'));
  assert.equal(statusResult.structuredContent?.client, 'hermes');

  console.log(JSON.stringify({ ok: true, tools: toolNames.length, resources: resourceUris.length, prompts: promptNames.length }, null, 2));
} finally {
  await client.close();
  rmSync(smokeHome, { recursive: true, force: true });
}
