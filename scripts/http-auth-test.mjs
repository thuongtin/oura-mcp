import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { assertHttpBindAllowed, authorizeBearer, getHttpAuthToken, isLoopbackBindHost } from '../dist/services/http-auth.js';

assert.equal(isLoopbackBindHost('127.0.0.1'), true);
assert.equal(isLoopbackBindHost('0.0.0.0'), false);
assert.equal(getHttpAuthToken({ OURA_MCP_HTTP_TOKEN: '  secret  ' }), 'secret');
assert.equal(authorizeBearer(undefined, undefined), true);
assert.equal(authorizeBearer('Bearer secret', 'secret'), true);
assert.equal(authorizeBearer('Bearer other', 'secret'), false);
assert.equal(authorizeBearer(undefined, 'secret'), false);
assert.throws(
  () => assertHttpBindAllowed('0.0.0.0', undefined),
  /OURA_MCP_HTTP_TOKEN/
);
assert.doesNotThrow(() => assertHttpBindAllowed('127.0.0.1', undefined));
assert.doesNotThrow(() => assertHttpBindAllowed('0.0.0.0', 'secret'));

const port = String(43000 + Math.floor(Math.random() * 1000));
const token = 'test-token-oura-mcp';
const child = spawn(process.execPath, ['dist/index.js', '--http'], {
  env: {
    ...process.env,
    OURA_MCP_PORT: port,
    OURA_MCP_HOST: '127.0.0.1',
    OURA_MCP_HTTP_TOKEN: token
  },
  stdio: ['ignore', 'ignore', 'pipe']
});

let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

function request(path, headers = {}, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers,
      timeout: 1500
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode, data }));
    });
    req.on('timeout', () => req.destroy(new Error('HTTP request timed out')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

try {
  let healthy = false;
  for (let i = 0; i < 100; i += 1) {
    try {
      const health = await request('/health');
      assert.equal(health.statusCode, 200);
      assert.match(health.data, /"ok":true/);
      healthy = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (!healthy) throw new Error(`HTTP server did not become healthy. stderr=${stderr}`);

  const denied = await request('/mcp', { 'content-type': 'application/json' }, 'POST', '{}');
  assert.equal(denied.statusCode, 401);
  assert.match(denied.data, /Unauthorized/);

  const allowed = await request(
    '/mcp',
    { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    'POST',
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
  );
  assert.notEqual(allowed.statusCode, 401);

  const openBind = spawn(process.execPath, ['dist/index.js', '--http'], {
    env: {
      ...process.env,
      OURA_MCP_PORT: String(Number(port) + 1),
      OURA_MCP_HOST: '0.0.0.0'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  const openErr = await new Promise((resolve) => {
    let text = '';
    openBind.stderr.on('data', (chunk) => { text += chunk.toString(); });
    openBind.on('exit', (code) => resolve({ code, text }));
  });
  assert.notEqual(openErr.code, 0);
  assert.match(openErr.text, /OURA_MCP_HTTP_TOKEN/);

  console.log(JSON.stringify({ ok: true, http_auth: true, port: Number(port) }, null, 2));
} finally {
  child.kill('SIGTERM');
}
