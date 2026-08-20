#!/usr/bin/env node
import cors from "cors";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { runCliCommand } from "./cli/commands.js";
import { registerOuraPrompts } from "./prompts/oura-prompts.js";
import { registerOuraResources } from "./resources/oura-resources.js";
import { getConfig } from "./services/config.js";
import { assertHttpBindAllowed, authorizeBearer, getHttpAuthToken } from "./services/http-auth.js";
import { ensureSecureTokenFile } from "./services/token-store.js";
import { registerOuraTools } from "./tools/oura-tools.js";

async function hardenTokenFile(): Promise<void> {
  try {
    await ensureSecureTokenFile(getConfig().tokenPath);
  } catch {
    // CLI help and incomplete setup have no token file yet.
  }
}

function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });

  registerOuraTools(server);
  registerOuraResources(server);
  registerOuraPrompts(server);
  return server;
}

async function runStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function runHttp(): Promise<void> {
  const app = express();
  const host = process.env.OURA_MCP_HOST ?? "127.0.0.1";
  const port = Number(process.env.OURA_MCP_PORT ?? 3000);
  const allowedOrigin = process.env.OURA_MCP_ALLOWED_ORIGIN ?? `http://${host}:${port}`;
  const httpToken = getHttpAuthToken();
  assertHttpBindAllowed(host, httpToken);

  app.use(express.json({ limit: "1mb" }));
  app.use(cors({ origin: allowedOrigin }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, name: SERVER_NAME, version: SERVER_VERSION });
  });

  app.post("/mcp", (req, res, next) => {
    if (authorizeBearer(req.get("authorization"), httpToken)) {
      next();
      return;
    }
    res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
  });

  app.post("/mcp", async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    res.on("close", () => {
      transport.close().catch(() => undefined);
      server.close().catch(() => undefined);
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP HTTP request failed:", error);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  app.listen(port, host, () => {
    console.error(`${SERVER_NAME} HTTP transport listening on http://${host}:${port}/mcp`);
  });
}

const args = new Set(process.argv.slice(2));
let cliResult: number | undefined;

try {
  cliResult = await runCliCommand(process.argv.slice(2));
} catch (error) {
  console.error(`Error: ${(error as Error).message}`);
  process.exitCode = 1;
}

if (cliResult !== undefined) {
  process.exitCode = cliResult;
} else if (process.exitCode === undefined) {
  const transport = process.env.OURA_MCP_TRANSPORT ?? (args.has("--http") ? "http" : "stdio");

  try {
    await hardenTokenFile();
    if (transport === "http") {
      await runHttp();
    } else {
      await runStdio();
    }
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
