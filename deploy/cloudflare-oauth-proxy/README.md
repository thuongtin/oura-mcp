# oura-mcp-oauth

Cloudflare Worker that fronts the Access-protected origin `https://oura.thuongtin.com`.

Claude.ai custom connectors always do OAuth Dynamic Client Registration. They cannot send `CF-Access-*` headers or a static bearer. This Worker is the public MCP URL for Claude.

- Public MCP: `https://oura-mcp-oauth.ho-31c.workers.dev/mcp`
- Origin (Grok / LAN via tunnel): `https://oura.thuongtin.com/mcp`

Secrets (wrangler, not git):

- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`
- `OURA_MCP_HTTP_TOKEN`
- `OAUTH_APPROVE_PIN`

Approve PIN is also stored locally at `~/.oura-mcp/oauth-approve-pin`.

```bash
npx wrangler deploy
```
