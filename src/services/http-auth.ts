import { timingSafeEqual } from "node:crypto";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackBindHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

export function getHttpAuthToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.OURA_MCP_HTTP_TOKEN?.trim();
  return value ? value : undefined;
}

export function assertHttpBindAllowed(host: string, token: string | undefined): void {
  if (!isLoopbackBindHost(host) && !token) {
    throw new Error(
      "OURA_MCP_HTTP_TOKEN is required when OURA_MCP_HOST is not loopback. Refusing to expose /mcp without a bearer token."
    );
  }
}

export function authorizeBearer(header: string | undefined, token: string | undefined): boolean {
  if (!token) return true;
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header ?? "");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
