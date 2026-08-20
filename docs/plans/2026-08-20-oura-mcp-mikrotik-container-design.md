# oura-mcp on MikroTik container

Date: 2026-08-20
Status: approved
Router: RB5009UG+S+ (home-01), RouterOS 7.24

## Goal

Run oura-mcp as an always-on HTTP MCP server on the home RB5009, reachable from LAN and from outside via the existing cloudflared tunnel. OAuth stays on the Mac. Tokens and client secrets stay off git.

## Why not stock oura-mcp as-is

- HTTP binds `127.0.0.1` and has no bearer.
- `auth` requires a loopback redirect. It cannot complete inside a container.
- `better-sqlite3` is a native addon. The image must be `linux/arm64`.
- The repo had no Dockerfile.
- NAND is 1 GB with dnsproxy + cloudflared already running.

## Architecture

```
LAN clients (bearer)                 Remote clients
10.88.88.0/24                        HTTPS + Cloudflare Access
        |                            Service Token + bearer
        v                            v
 BridgeLAN -----> containers 10.10.10.1/24 <---- cloudflared 10.10.10.10
                         |
                         v
                  veth-oura 10.10.10.12:3000
                         |
                         v
                    oura-mcp
                    mount /data (tokens.json)
                         |
                         v
                  api.ouraring.com
```

Three gates:

1. WAN never dst-nats port 3000.
2. Cloudflare Access in front of the tunnel hostname (email allowlist for humans, Access Service Token for agents).
3. `OURA_MCP_HTTP_TOKEN` on `POST /mcp`. `/health` stays unauthenticated and secret-free.

OAuth: run `oura-mcp-unofficial auth` on the Mac, copy `tokens.json` onto the mount. The container refreshes tokens using `OURA_CLIENT_ID` / `OURA_CLIENT_SECRET`.

## Network

| Resource | Value |
|---|---|
| LAN | `10.88.88.0/24`, gateway `10.88.88.1` |
| Container bridge | `containers` `10.10.10.1/24` |
| Existing veth | `veth` `10.10.10.10` (dnsproxy + cloudflared) |
| New veth | `veth-oura` `10.10.10.12/24`, gateway `10.10.10.1` |
| MCP port | `3000/tcp` |

Firewall:

- accept forward `BridgeLAN` -> `10.10.10.12:3000`
- accept forward `containers` `10.10.10.10` -> `10.10.10.12:3000`
- optional dst-nat `10.88.88.1:3000` -> `10.10.10.12:3000` for LAN convenience
- no WAN mapping

cloudflared ingress: `oura.<domain> -> http://10.10.10.12:3000`

## Image and runtime

- `linux/arm64`, multi-stage, `node:22-bookworm-slim` so `better-sqlite3` uses prebuilds
- non-root user, `EXPOSE 3000`, healthcheck on `/health`
- `OURA_CACHE=0` on the router
- RAM high-water about 256 MB
- root-dir `/containers/oura-mcp`
- mount `/containers/oura-data` -> `/data`

Envlist `oura-mcp`:

- `OURA_MCP_TRANSPORT=http`
- `OURA_MCP_HOST=0.0.0.0`
- `OURA_MCP_PORT=3000`
- `OURA_MCP_HTTP_TOKEN`
- `OURA_CLIENT_ID` / `OURA_CLIENT_SECRET` / `OURA_REDIRECT_URI`
- `OURA_TOKEN_PATH=/data/tokens.json`
- `OURA_CACHE=0`

Binding a non-loopback host without `OURA_MCP_HTTP_TOKEN` is a startup error.

## Repo changes

- HTTP bearer middleware (`OURA_MCP_HTTP_TOKEN`)
- `Dockerfile` + `.dockerignore`
- `docs/mikrotik-container.md`
- HTTP auth smoke test
- stdio and loopback HTTP without a token stay unchanged

## Out of scope for this pass

- OAuth callback inside the container
- Validating Cloudflare Access JWTs in Node
- Enabling sqlite cache on NAND
- USB `usb1` (currently read-only)
- Publishing a public image that embeds secrets
