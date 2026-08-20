# Remote MCP on MikroTik + Cloudflare + Claude.ai

This is the pattern that made a self-hosted MCP usable from Claude.ai
while Grok and LAN clients keep a tighter path.

Worked example: `oura-mcp` on an RB5009 (RouterOS 7.24), tunnel hostname
`oura.thuongtin.com`, Claude front
`https://oura-mcp-oauth.ho-31c.workers.dev/mcp`.

Apply the same layout to another MCP (Garmin, etc.) by swapping names,
ports, and the origin token file.

## Why three hops

Claude.ai custom connectors always do OAuth Dynamic Client Registration
(`/.well-known`, `POST /register`, redirect
`https://claude.ai/api/mcp/auth_callback`). They cannot send Cloudflare
Access headers or a static `Authorization: Bearer`.

If you paste the Access-protected origin URL into Claude, Connect fails
(DCR 302/404, or Claude follows the public IdP of a lookalike name).

So:

```
Claude.ai  --OAuth DCR + PIN-->  Cloudflare Worker (workers.dev)
                                   | injects CF-Access-* + origin Bearer
                                   v
Grok / curl  --Access + Bearer-->  https://<name>.thuongtin.com
                                   | Cloudflare Tunnel (no WAN dst-nat)
                                   v
MikroTik container                 http://10.10.10.N:PORT/mcp
                                   | bind-mount tokens
                                   v
Vendor API (Oura, Garmin, ...)
```

LAN clients talk to `http://10.10.10.N:PORT/mcp` with only the origin
bearer.

## 1. Authorize on a machine with a browser

Do vendor OAuth on the Mac. Copy tokens onto the router later. Do not
bake tokens into the image.

Oura:

```bash
npx -y oura-mcp-unofficial auth
# ~/.oura-mcp/tokens.json
```

Garmin (tokens already on this lab):

```bash
garmin-mcp-auth
# ~/.garminconnect/garmin_tokens.json
```

RouterOS FTP on this lab rejected `*.json` (553). Upload as `*.txt` and
point the server at that path, or copy `tokens.txt` to the expected
filename in the container entrypoint.

## 2. HTTP MCP must require a bearer off-loopback

The container binds `0.0.0.0`. Refuse to start without
`<NAME>_MCP_HTTP_TOKEN`. `/health` (or `/healthz`) stays public and
must not return tokens or personal records.

Generate:

```bash
openssl rand -hex 32
```

## 3. linux/arm64 image

```bash
docker build --platform linux/arm64 -t <name>-mcp:local .
docker save <name>-mcp:local -o <name>-mcp-arm64.tar
```

FTP/SFTP the tar to the router. Import:

```
/container add name=<name>-mcp file=<name>-mcp-arm64.tar interface=veth-<name> root-dir=/containers/<name>-mcp start-on-boot=yes
/container set [find name=<name>-mcp] envlist=<name>-mcp mountlists=<name>-data
```

On RouterOS 7.24:

- Mount definitions use `list=`, not `name=`.
- Container attach uses `mountlists=` and `envlist=`, not `mounts=` / `envlists=` on add.
- RB5009 flash is 1GiB. Delete the import tar as soon as extract finishes. Do not keep two 250MB images plus their tars.

After extract finishes (`E` flag gone), start:

```
/container start <name>-mcp
```

Delete the tar when the container is healthy. A 270MB image sitting on
the router wastes flash.

## 4. RouterOS network (this lab)

- LAN `10.88.88.0/24`
- container bridge `containers` `10.10.10.1/24`
- cloudflared veth `10.10.10.10`
- Oura veth `veth-oura` `10.10.10.12:3000`
- Garmin veth `veth-garmin` `10.10.10.13:8000`

```
/interface veth add name=veth-<name> address=10.10.10.N/24 gateway=10.10.10.1
/interface bridge port add bridge=containers interface=veth-<name>
```

Allow LAN and cloudflared to the MCP port. Do not dst-nat that port from WAN.

```
/ip firewall filter add chain=forward in-interface=BridgeLAN dst-address=10.10.10.N protocol=tcp dst-port=PORT action=accept comment="<name>-mcp LAN"
/ip firewall filter add chain=forward src-address=10.10.10.10 dst-address=10.10.10.N protocol=tcp dst-port=PORT action=accept comment="<name>-mcp cloudflared"
```

Mount:

```
/container mounts add name=<name>-data src=/containers/<name>-data dst=/data
```

Env list: transport, host `0.0.0.0`, port, HTTP bearer, vendor client
id/secret if the process refreshes OAuth, token path under `/data`.

Entrypoint should `chmod 600` the token file as root. RouterOS FTP
leaves bind-mount files at `666`.

## 5. Cloudflare Tunnel + Access

Add a public hostname on the existing tunnel (`HomeMik`):

```
<name>.thuongtin.com  ->  http://10.10.10.N:PORT
```

Access application on that hostname:

- Allow email (human)
- Service Auth (Grok, Worker)

Grok / curl from outside:

```
CF-Access-Client-Id
CF-Access-Client-Secret
Authorization: Bearer <HTTP token>
```

Do not paste `https://<name>.thuongtin.com/mcp` into Claude.ai.

## 6. Worker OAuth front

`deploy/cloudflare-oauth-proxy` using
`@cloudflare/workers-oauth-provider`. Public URL is workers.dev so the
tunnel DNS for the origin hostname is unchanged.

Endpoints Claude needs:

- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/oauth-protected-resource` (resource must be the `/mcp` URL)
- `POST /register`
- `GET /authorize` + `POST /approve` (PIN from `~/.oura-mcp/oauth-approve-pin` or the Garmin equivalent)
- `POST /token`
- `POST /mcp` (proxies to origin with Access + origin bearer)

Redirect allowlist: `claude.ai`, `claude.com`, `*.anthropic.com`, localhost.

Set Worker secrets with `wrangler secret bulk` from a 0600 JSON file.
Never echo secrets. Create a dedicated KV namespace per Worker
(`OAUTH_KV`).

Advertise `resource` as `https://<worker>/mcp` so token audience matches
the MCP path.

## 7. Claude.ai

Settings → Connectors → Add custom connector.

- Name: `Home <Vendor> MCP` (not a lookalike of the vendor's official product)
- URL: `https://<worker>.workers.dev/mcp`
- OAuth Client ID / Secret: empty
- Connect, then type the approve PIN

A previous failed connector can be deleted; Claude caches DCR client
state per URL.

## 8. Verify

```bash
curl -sS http://10.10.10.N:PORT/health
# 401 without bearer
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://10.10.10.N:PORT/mcp
curl -sS https://<worker>.workers.dev/health
curl -sS https://<worker>.workers.dev/.well-known/oauth-protected-resource
```

Origin through Access: 302 without headers, 200 `/health` with the
service token.

## Lessons from the Oura lab

- Oura granted scopes arrive as `extapi:daily`. Doctor must strip the
  prefix or it reports `missing_recommended` while the APIs work.
- Heartrate time-series uses `start_datetime` / `end_datetime`. Daily
  collections use `start_date` / `end_date`.
- Collection markdown must print fields that exist (including `0`). Do
  not use a workout template that prints `n/a`.
- Reusing `/container` `root-dir` after a new image import can leave an
  old overlay. Confirm `/health` and a real tool payload, not only that
  the container is running.
- `python urllib` without a User-Agent can get Cloudflare 1010 on
  workers.dev. `curl` is fine. Claude's servers are fine.

## Safety

- Never commit OAuth tokens, Access secrets, HTTP bearers, or PIN files.
- Wellness language only. Not medical advice.
- `/health` is public. Everything else on the origin is Access + bearer.
