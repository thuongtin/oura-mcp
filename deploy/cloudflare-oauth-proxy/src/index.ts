import OAuthProvider, {
  type AuthRequest,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { WorkerEntrypoint } from "cloudflare:workers";

export interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  ORIGIN_URL: string;
  CF_ACCESS_CLIENT_ID: string;
  CF_ACCESS_CLIENT_SECRET: string;
  OURA_MCP_HTTP_TOKEN: string;
  OAUTH_APPROVE_PIN: string;
}

function timingSafeEqualString(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.byteLength !== right.byteLength) {
    const dummy = new Uint8Array(left.byteLength);
    crypto.subtle.timingSafeEqual(left, dummy);
    return false;
  }
  return crypto.subtle.timingSafeEqual(left, right);
}

function allowedRedirect(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")) {
    return true;
  }
  if (parsed.protocol !== "https:") return false;
  return (
    parsed.hostname === "claude.ai" ||
    parsed.hostname === "claude.com" ||
    parsed.hostname.endsWith(".claude.ai") ||
    parsed.hostname.endsWith(".anthropic.com")
  );
}

function shouldForwardHeader(name: string): boolean {
  const lower = name.toLowerCase();
  if (
    lower === "host" ||
    lower === "cookie" ||
    lower === "authorization" ||
    lower === "connection" ||
    lower === "content-length" ||
    lower === "cf-access-jwt-assertion" ||
    lower === "cf-access-client-id" ||
    lower === "cf-access-client-secret" ||
    lower === "cdn-loop" ||
    lower.startsWith("cf-") ||
    lower.startsWith("x-forwarded-")
  ) {
    return false;
  }
  return true;
}

class OriginProxy extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    const incoming = new URL(request.url);
    const target = new URL(incoming.pathname + incoming.search, this.env.ORIGIN_URL);
    const headers = new Headers();
    request.headers.forEach((value, key) => {
      if (shouldForwardHeader(key)) headers.set(key, value);
    });
    headers.set("CF-Access-Client-Id", this.env.CF_ACCESS_CLIENT_ID);
    headers.set("CF-Access-Client-Secret", this.env.CF_ACCESS_CLIENT_SECRET);
    headers.set("Authorization", `Bearer ${this.env.OURA_MCP_HTTP_TOKEN}`);

    const init: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers,
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
      init.duplex = "half";
    }
    return fetch(target, init);
  }
}

function renderAuthorizePage(oauthReqInfo: AuthRequest, error?: string): Response {
  const encoded = encodeURIComponent(JSON.stringify(oauthReqInfo));
  const errorHtml = error ? `<p class="err">${escapeHtml(error)}</p>` : "";
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Approve Oura MCP</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; background:#0f172a; color:#e2e8f0; margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; }
    .card { background:#1e293b; padding:2rem; border-radius:16px; max-width:28rem; width:100%; box-shadow:0 20px 50px rgba(0,0,0,.35); }
    h1 { font-size:1.25rem; margin:0 0 0.5rem; }
    p { color:#94a3b8; line-height:1.5; }
    label { display:block; margin:1rem 0 0.35rem; font-size:0.9rem; }
    input { width:100%; box-sizing:border-box; padding:0.7rem 0.8rem; border-radius:8px; border:1px solid #334155; background:#0f172a; color:#e2e8f0; }
    button { margin-top:1.2rem; width:100%; padding:0.8rem; border:0; border-radius:8px; background:#10b981; color:#042f2e; font-weight:700; cursor:pointer; }
    .err { color:#fda4af; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Approve Oura MCP</h1>
    <p>Claude wants read-only access to your self-hosted Oura MCP. Enter the approve PIN from <code>~/.oura-mcp/oauth-approve-pin</code>.</p>
    ${errorHtml}
    <form method="POST" action="/approve">
      <input type="hidden" name="oauthReqInfo" value="${encoded}" />
      <label for="pin">Approve PIN</label>
      <input id="pin" name="pin" type="password" autocomplete="current-password" required />
      <button type="submit">Approve</button>
    </form>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({
        ok: true,
        name: "oura-mcp-oauth",
        mcp: `${url.origin}/mcp`,
      });
    }

    if (
      url.pathname === "/.well-known/oauth-protected-resource/mcp" ||
      url.pathname === "/.well-known/oauth-authorization-server/mcp"
    ) {
      const metadata =
        url.pathname === "/.well-known/oauth-protected-resource/mcp"
          ? {
              resource: `${url.origin}/mcp`,
              authorization_servers: [url.origin],
              scopes_supported: ["mcp"],
              bearer_methods_supported: ["header"],
              resource_name: "Home Oura MCP",
            }
          : {
              issuer: url.origin,
              authorization_endpoint: `${url.origin}/authorize`,
              token_endpoint: `${url.origin}/token`,
              registration_endpoint: `${url.origin}/register`,
              scopes_supported: ["mcp"],
              response_types_supported: ["code"],
              grant_types_supported: ["authorization_code", "refresh_token"],
              token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
              code_challenge_methods_supported: ["S256"],
            };
      return Response.json(metadata, {
        headers: {
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=60",
        },
      });
    }

    if (url.pathname === "/authorize" && request.method === "GET") {
      try {
        const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
        if (!allowedRedirect(oauthReqInfo.redirectUri)) {
          return new Response("Redirect URI is not allowed", { status: 400 });
        }
        return renderAuthorizePage(oauthReqInfo);
      } catch (error) {
        const description = error instanceof Error ? error.message : "Invalid authorization request";
        return new Response(description, { status: 400 });
      }
    }

    if (url.pathname === "/approve" && request.method === "POST") {
      const form = await request.formData();
      const pin = String(form.get("pin") ?? "");
      let oauthReqInfo: AuthRequest | null = null;
      try {
        oauthReqInfo = JSON.parse(decodeURIComponent(String(form.get("oauthReqInfo") ?? ""))) as AuthRequest;
      } catch {
        oauthReqInfo = null;
      }
      if (!oauthReqInfo) {
        return new Response("Invalid authorization request", { status: 400 });
      }
      if (!env.OAUTH_APPROVE_PIN || !timingSafeEqualString(pin, env.OAUTH_APPROVE_PIN)) {
        return renderAuthorizePage(oauthReqInfo, "PIN did not match.");
      }
      if (!allowedRedirect(oauthReqInfo.redirectUri)) {
        return new Response("Redirect URI is not allowed", { status: 400 });
      }
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReqInfo,
        userId: "home",
        metadata: { label: "home oura mcp" },
        scope: oauthReqInfo.scope,
        props: { userId: "home" },
      });
      return Response.redirect(redirectTo, 302);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

export default new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: OriginProxy,
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["mcp"],
  resourceMetadata: {
    resource: "https://oura-mcp-oauth.ho-31c.workers.dev/mcp",
    resource_name: "Home Oura MCP",
    scopes_supported: ["mcp"],
    bearer_methods_supported: ["header"],
  },
});
