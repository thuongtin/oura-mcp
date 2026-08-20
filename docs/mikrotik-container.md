# Deploy oura-mcp on MikroTik containers

Target: RouterOS 7.x `container` package, `linux/arm64` (RB5009).
Design: `docs/plans/2026-08-20-oura-mcp-mikrotik-container-design.md`.
Remote Claude.ai pattern (Worker + Access + tunnel): `docs/remote-mcp-mikrotik-claude.md`.

OAuth stays on a machine with a browser. The router only serves HTTP MCP and refreshes tokens.

## 1. Authorize on the Mac

```bash
npx -y oura-mcp-unofficial setup
npx -y oura-mcp-unofficial auth
```

Copy `~/.oura-mcp/tokens.json` to the router mount later. Do not bake tokens into the image.

RouterOS FTP on this lab rejected `*.json` (553). Upload as `tokens.txt` and set `OURA_TOKEN_PATH=/data/tokens.txt`.

## 2. Build the image

```bash
docker build --platform linux/arm64 -t oura-mcp:local .
docker save oura-mcp:local -o oura-mcp-arm64.tar
```

Upload `oura-mcp-arm64.tar` to the router (SFTP/FTP), then:

```
/container add file=oura-mcp-arm64.tar interface=veth-oura root-dir=/containers/oura-mcp envlists=oura-mcp mounts=oura-data start-on-boot=yes
```

Or pull a published `linux/arm64` tag if you have a registry.

## 3. RouterOS network

Existing home lab used in this project:

- LAN `10.88.88.0/24`
- container bridge `containers` `10.10.10.1/24`
- dedicated `veth-oura` `10.10.10.12/24`

```
/interface veth add name=veth-oura address=10.10.10.12/24 gateway=10.10.10.1
/interface bridge port add bridge=containers interface=veth-oura
```

Firewall: allow LAN and the cloudflared veth to `10.10.10.12:3000`. Do not dst-nat port 3000 from WAN.

```
/ip firewall filter add chain=forward in-interface=BridgeLAN dst-address=10.10.10.12 protocol=tcp dst-port=3000 action=accept comment="oura-mcp LAN"
/ip firewall filter add chain=forward src-address=10.10.10.10 dst-address=10.10.10.12 protocol=tcp dst-port=3000 action=accept comment="oura-mcp cloudflared"
```

Optional LAN convenience:

```
/ip firewall nat add chain=dstnat in-interface=BridgeLAN protocol=tcp dst-port=3000 action=dst-nat to-addresses=10.10.10.12 to-ports=3000 comment="oura-mcp LAN dnat"
```

## 4. Env and mount

```
/container mounts add name=oura-data src=/containers/oura-data dst=/data
/container envs add name=oura-mcp key=OURA_MCP_TRANSPORT value=http
/container envs add name=oura-mcp key=OURA_MCP_HOST value=0.0.0.0
/container envs add name=oura-mcp key=OURA_MCP_PORT value=3000
/container envs add name=oura-mcp key=OURA_MCP_HTTP_TOKEN value=<random-hex>
/container envs add name=oura-mcp key=OURA_CLIENT_ID value=<oura-app-id>
/container envs add name=oura-mcp key=OURA_CLIENT_SECRET value=<oura-app-secret>
/container envs add name=oura-mcp key=OURA_REDIRECT_URI value=http://127.0.0.1:3000/callback
/container envs add name=oura-mcp key=OURA_TOKEN_PATH value=/data/tokens.txt
/container envs add name=oura-mcp key=OURA_CACHE value=0
```

Generate the HTTP token locally:

```bash
openssl rand -hex 32
```

## 5. Cloudflare

Point an existing cloudflared ingress at `http://10.10.10.12:3000`.
Put Cloudflare Access in front of that hostname.

- Humans: email allowlist
- Agents: Access Service Token

Remote clients send:

```
CF-Access-Client-Id: ...
CF-Access-Client-Secret: ...
Authorization: Bearer <OURA_MCP_HTTP_TOKEN>
```

LAN clients only need the bearer and `http://10.10.10.12:3000/mcp`.

## 6. Verify

```bash
curl -sS http://10.10.10.12:3000/health
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://10.10.10.12:3000/mcp
# expect 401
curl -sS -H "Authorization: Bearer <token>" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' \
  http://10.10.10.12:3000/mcp
```

Grok / Claude HTTP MCP:

```toml
[mcp_servers.oura]
url = "http://10.10.10.12:3000/mcp"
headers = { Authorization = "Bearer ${OURA_MCP_HTTP_TOKEN}" }
```

Outside the house, use the Cloudflare hostname plus Access service-token headers.

## 7. Claude.ai custom connector

Claude.ai always does OAuth Dynamic Client Registration. It cannot send Cloudflare Access headers or a static bearer, so do **not** paste `https://oura.thuongtin.com/mcp`.

Use the OAuth Worker instead:

```text
https://oura-mcp-oauth.ho-31c.workers.dev/mcp
```

In Claude.ai: Settings → Connectors → Add custom connector.

- Name: `Home Oura MCP` (not just `Oura`, so it is not confused with Oura Cloud)
- Remote MCP server URL: `https://oura-mcp-oauth.ho-31c.workers.dev/mcp`
- OAuth Client ID / Secret: leave empty
- Connect, then enter the approve PIN from `~/.oura-mcp/oauth-approve-pin`

The Worker injects Access + origin bearer toward `https://oura.thuongtin.com`. Grok keeps using the Access-protected origin URL.

## Safety

- Tokens and client secrets stay in RouterOS env/mounts, never in git.
- `/health` must not return credentials or health records.
- This connector is wellness data for personal agents, not medical advice.
