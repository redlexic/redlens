// MCP server factory. Registers the shared atlas tool set (tool-registry.ts)
// over the in-memory indexes + Postgres. The same registry backs the /api/chat
// agentic loop, so MCP clients (ask-atlas) and the chatbot see identical tools.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getIndexes } from "./indexes.ts";
import type { ToolResult } from "./tools.ts";
import { ATLAS_TOOLS } from "./tool-registry.ts";

function ok(meta: Record<string, string | null>, payload: ToolResult) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ _meta: meta, ...payload }) }] };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "redlens-atlas", version: "2.0.0-railway" });
  const ix = getIndexes();

  for (const t of ATLAS_TOOLS) {
    server.tool(t.name, t.description, t.shape, async (args) => ok(ix.meta, await t.handler(ix, args)));
  }

  return server;
}
