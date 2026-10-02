/** Dependency-free tests: node --test --experimental-strip-types src/tools/*.test.ts */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// OpenClaw resolves .js imports to TypeScript. Reproduce that resolution for node:test.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && specifier.endsWith(".js")) {
      return nextResolve(specifier.slice(0, -3) + ".ts", context);
    }
    return nextResolve(specifier, context);
  },
});
after(() => hooks.deregister());
const { registerParallelSearch } = await import("./parallel-search.ts");
const { resolveConfig } = await import("../config.ts");
const { default: plugin } = await import("../../index.ts");
let tool: any;
registerParallelSearch({ registerTool(t: unknown) { tool = t; }, logger: {} } as any);

const result = { content: [{ type: "text", text: "Node.js docs: https://nodejs.org/en/docs\nNode.js runs JavaScript." }], structuredContent: { results: [{ url: "https://nodejs.org/en/docs" }] } };

async function withFetch(mock: typeof fetch, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { await fn(); } finally { globalThis.fetch = original; }
}

function reply(body: any, streamed = false) {
  return new Response(streamed ? `: keepalive\r\n\r\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/message" })}\r\n\r\nevent: message\r\ndata: ${JSON.stringify(body)}\r\n\r\n` : JSON.stringify(body), {
    headers: { "content-type": streamed ? "text/event-stream" : "application/json", "mcp-session-id": "test-session" },
  });
}

test("Parallel is opt-in through native configuration", () => {
  assert.equal(resolveConfig().parallelEnabled, false);
  assert.equal(resolveConfig({ parallelEnabled: true }).parallelEnabled, true);
  assert.equal(resolveConfig({ parallelEnabled: false }).parallelEnabled, false);
});

test("plugin entry registers Parallel only when enabled, retaining all incumbent tools", () => {
  const originalNames = ["grok_search", "tavily_search", "ws_fetch", "ws_map", "dual_search", "exa_search"];
  for (const enabled of [undefined, false, true]) {
    const names: string[] = [];
    plugin.register({ pluginConfig: { parallelEnabled: enabled }, logger: {}, registerTool(t: any) { names.push(t.name); } } as any);
    assert.deepEqual(names, enabled ? [...originalNames, "parallel_search"] : originalNames);
  }
});

test("saved dotenv true/false takes precedence over plugin JSON without affecting provider keys", async () => {
  for (const enabled of ["true", "false"]) {
    const dir = mkdtempSync(join(tmpdir(), "oc-websearch-test-"));
    try {
      mkdirSync(join(dir, "src"));
      cpSync(new URL("../config.ts", import.meta.url), join(dir, "src/config.ts"));
      writeFileSync(join(dir, "web-search.env"), `PARALLEL_ENABLED=${enabled}\n`);
      const { resolveConfig: resolveSaved } = await import(pathToFileURL(join(dir, "src/config.ts")).href);
      const config = resolveSaved({ parallelEnabled: enabled !== "true", exaApiKey: "fixture-exa", tavilyApiKeys: ["fixture-tavily"] });
      assert.equal(config.parallelEnabled, enabled === "true");
      assert.equal(config.exaApiKey, "fixture-exa");
      assert.deepEqual(config.tavilyApiKeys, ["fixture-tavily"]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

for (const streamed of [false, true]) {
  test(`registered tool returns source text through ${streamed ? "SSE" : "JSON"} MCP`, async () => {
    const requests: any[] = [];
    await withFetch(async (url, options) => {
      const body = JSON.parse(options!.body as string);
      requests.push(body);
      assert.equal(url, "https://search.parallel.ai/mcp");
      const headers = new Headers(options!.headers);
      assert.equal(headers.get("User-Agent"), "openclaw-websearch-plugin/1.0.0");
      assert.equal(headers.get("Authorization"), null);
      assert.ok(options!.signal);
      if (body.method === "initialize") {
        return reply({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26" } }, streamed);
      }
      assert.equal(headers.get("Mcp-Session-Id"), "test-session");
      assert.equal(headers.get("MCP-Protocol-Version"), "2025-03-26");
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      assert.deepEqual(body.params, { name: "web_search", arguments: { objective: "Node.js docs", search_queries: ["Node.js official documentation"], session_id: "conversation-1" } });
      return reply({ jsonrpc: "2.0", id: body.id, result }, streamed);
    }, async () => {
      const answer = await tool.execute("call", { query: "Node.js docs", searchQueries: ["Node.js official documentation"], sessionId: "conversation-1" });
      assert.deepEqual(answer.content, result.content);
      assert.deepEqual(answer.details, result.structuredContent);
      assert.deepEqual(requests.map((r) => r.method), ["initialize", "notifications/initialized", "tools/call"]);
    });
  });
}

test("invalid parameters produce an error without a network request", async () => {
  await withFetch(async () => { throw new Error("must not fetch"); }, async () => {
    for (const params of [{ query: " " }, { query: "x", searchQueries: [] }, { query: "x", searchQueries: [""] }, { query: "x", sessionId: "x".repeat(101) }]) {
      assert.ok((await tool.execute("call", params)).details.error);
    }
  });
});

test("default keyword query and HTTP rate limits are preserved", async () => {
  await withFetch(async (_url, options) => {
    const body = JSON.parse(options!.body as string);
    if (body.method === "initialize") return reply({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05" } });
    if (!body.id) return new Response(null, { status: 202 });
    assert.deepEqual(body.params.arguments, { objective: "Node docs", search_queries: ["Node docs"] });
    return new Response("rate limited", { status: 429 });
  }, async () => {
    assert.equal((await tool.execute("call", { query: "Node docs" })).details.error, "Parallel MCP HTTP 429");
  });
});

test("MCP tool errors are marked as errors", async () => {
  await withFetch(async (_url, options) => {
    const body = JSON.parse(options!.body as string);
    if (body.method === "initialize") return reply({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05" } });
    if (!body.id) return new Response(null, { status: 202 });
    return reply({ jsonrpc: "2.0", id: 2, result: { isError: true, content: [{ type: "text", text: "Search unavailable" }] } });
  }, async () => {
    const answer = await tool.execute("call", { query: "Node docs" });
    assert.equal(answer.isError, true);
    assert.equal(answer.content[0].text, "Search unavailable");
  });
});

test("caller cancellation is passed to the whole MCP operation", async () => {
  const controller = new AbortController();
  controller.abort();
  await withFetch(async (_url, options) => {
    assert.equal(options!.signal!.aborted, true);
    options!.signal!.throwIfAborted();
    throw new Error("unreachable");
  }, async () => {
    const answer = await tool.execute("call", { query: "Node docs" }, controller.signal);
    assert.match(answer.details.error, /abort/i);
  });
});

test("malformed and mismatched RPC replies fail visibly", async () => {
  for (const body of [{ jsonrpc: "2.0", id: 99, result: {} }, { jsonrpc: "2.0", id: 1, error: { message: "server failure" } }, { jsonrpc: "2.0", id: 1 }]) {
    await withFetch(async () => reply(body), async () => {
      assert.ok((await tool.execute("call", { query: "Node docs" })).details.error);
    });
  }
});
