import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { json } from "../utils.js";

const ENDPOINT = "https://search.parallel.ai/mcp";
const USER_AGENT = "openclaw-websearch-plugin/1.0.0";

interface RpcResponse {
  jsonrpc: string;
  id?: number;
  result?: Record<string, unknown>;
  error?: { message: string };
}

/** Read one matching response, then close the POST stream (no persistent SSE connection). */
async function readResponse(response: Response, id: number): Promise<RpcResponse> {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    return await response.json() as RpcResponse;
  }
  if (!response.body) throw new Error("Empty MCP response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const event = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = event.split("\n").filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        const message = JSON.parse(data) as RpcResponse;
        if (message.id === id) return message;
      }
      if (done) throw new Error("MCP stream ended without a matching response");
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

/** A short-lived, keyless Streamable HTTP MCP session for one search. */
async function search(query: string, searchQueries: string[], sessionId: string | undefined, signal?: AbortSignal) {
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
    : AbortSignal.timeout(120_000);
  let mcpSession: string | null = null;
  let protocol = "2024-11-05";
  async function request(method: string, params: Record<string, unknown>, id?: number) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "User-Agent": USER_AGENT,
        ...(method !== "initialize" ? { "MCP-Protocol-Version": protocol } : {}),
        ...(mcpSession ? { "Mcp-Session-Id": mcpSession } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...(id !== undefined ? { id } : {}), method, params }),
      signal: requestSignal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Parallel MCP HTTP ${response.status}`);
    }
    if (method === "initialize") mcpSession = response.headers.get("mcp-session-id");
    if (id === undefined) {
      await response.body?.cancel();
      return {};
    }
    const message = await readResponse(response, id);
    if (message.jsonrpc !== "2.0" || message.id !== id) throw new Error("Invalid MCP response");
    if (message.error) throw new Error(`Parallel MCP: ${message.error.message}`);
    if (!message.result) throw new Error("Missing MCP result");
    return message.result;
  }
  const initialized = await request("initialize", {
    protocolVersion: protocol,
    capabilities: {},
    clientInfo: { name: "openclaw-websearch-plugin", version: "1.0.0" },
  }, 1);
  if (typeof initialized.protocolVersion !== "string") throw new Error("Missing MCP protocol version");
  protocol = initialized.protocolVersion;
  await request("notifications/initialized", {});
  return await request("tools/call", {
    name: "web_search",
    arguments: { objective: query, search_queries: searchQueries, ...(sessionId ? { session_id: sessionId } : {}) },
  }, 2);
}

export function registerParallelSearch(api: OpenClawPluginApi) {
  api.registerTool({
    name: "parallel_search",
    label: "Parallel Search",
    description: "Free, keyless web search via Parallel Search MCP. Returns source URLs and relevant excerpts. Select this tool explicitly for web research; anonymous rate limits apply.",
    parameters: {
      type: "object" as const,
      properties: {
        query: { type: "string" as const, minLength: 1, description: "A focused description of the information to find" },
        searchQueries: {
          type: "array" as const, minItems: 1, items: { type: "string" as const, minLength: 1 },
          description: "Related keyword queries, ideally 3-6 words each (default: query)",
        },
        sessionId: { type: "string" as const, maxLength: 100, description: "Optional stable ID for this conversation; reuse on related searches" },
      },
      required: ["query"],
    },
    async execute(_toolCallId, params, signal) {
      const p = params as { query: string; searchQueries?: string[]; sessionId?: string };
      if (typeof p.query !== "string" || !p.query.trim()) return json({ error: "Missing required parameter: query" });
      if (p.searchQueries !== undefined && (!Array.isArray(p.searchQueries) || !p.searchQueries.length
        || p.searchQueries.some((q) => typeof q !== "string" || !q.trim()))) {
        return json({ error: "searchQueries must contain nonempty strings" });
      }
      if (p.sessionId !== undefined && (typeof p.sessionId !== "string" || p.sessionId.length > 100)) {
        return json({ error: "sessionId must be a string of at most 100 characters" });
      }
      try {
        const result = await search(p.query, p.searchQueries ?? [p.query], p.sessionId, signal);
        const content = Array.isArray(result.content)
          ? result.content.filter((c): c is { type: "text"; text: string } =>
            !!c && c.type === "text" && typeof c.text === "string") : [];
        if (!content.length) throw new Error("Parallel MCP returned no text content");
        return { content, details: result.structuredContent ?? result, ...(result.isError ? { isError: true } : {}) };
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  }, { name: "parallel_search" });
  api.logger.info?.("oc-websearch: Registered parallel_search tool");
}
