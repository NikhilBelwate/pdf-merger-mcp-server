#!/usr/bin/env node
/**
 * PDF Merger MCP Server
 *
 * Exposes the PDF Merger App's capabilities (upload, remove, merge, download)
 * as MCP tools that any MCP-compatible LLM client can use.
 *
 * Transports:
 *   - stdio  (default) — for local / desktop integrations
 *   - http   — set TRANSPORT=http for remote / multi-client access
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { API_BASE_URL } from "./constants.js";

// Tool registrations
import { registerUploadTool } from "./tools/upload.js";
import { registerRemoveTool } from "./tools/remove.js";
import { registerMergeTool } from "./tools/merge.js";
import { registerDownloadTool } from "./tools/download.js";

/* ------------------------------------------------------------------ */
/*  Server initialization                                              */
/* ------------------------------------------------------------------ */

const server = new McpServer({
  name: "pdf-merger-mcp-server",
  version: "1.0.0",
});

// Register all tools
registerUploadTool(server);
registerRemoveTool(server);
registerMergeTool(server);
registerDownloadTool(server);

/* ------------------------------------------------------------------ */
/*  Transport: stdio (default)                                         */
/* ------------------------------------------------------------------ */

async function runStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[pdf-merger-mcp] Server running via stdio`);
  console.error(`[pdf-merger-mcp] API target: ${API_BASE_URL}`);
}

/* ------------------------------------------------------------------ */
/*  Transport: Streamable HTTP                                         */
/* ------------------------------------------------------------------ */

async function runHttp(): Promise<void> {
  // Dynamic imports to avoid pulling express into the bundle when not needed.
  const { default: express } = await import("express");
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );

  const app = express();
  app.use(express.json());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.post("/mcp", async (req: any, res: any) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT ?? "4000", 10);
  const host= process.env.HOST || "http://localhost";
  app.listen(port, () => {
    console.error(`[pdf-merger-mcp] HTTP server on ${host}:${port}/mcp`);
    console.error(`[pdf-merger-mcp] API target: ${API_BASE_URL}`);
  });
}

/* ------------------------------------------------------------------ */
/*  Entry point                                                        */
/* ------------------------------------------------------------------ */

const transport = process.env.TRANSPORT ?? "stdio";

if (transport === "http") {
  runHttp().catch((err) => {
    console.error("[pdf-merger-mcp] Fatal:", err);
    process.exit(1);
  });
} else {
  runStdio().catch((err) => {
    console.error("[pdf-merger-mcp] Fatal:", err);
    process.exit(1);
  });
}
