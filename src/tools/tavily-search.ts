import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { WebSearchConfig } from "../config.js";
import type { TavilyKeyPool } from "../tavily-key-pool.js";
import { json, postJson } from "../utils.js";

const TavilySearchSchema = {
  type: "object" as const,
  properties: {
    query: { type: "string" as const, description: "Search query (required)" },
    depth: {
      type: "string" as const,
      enum: ["basic", "advanced"],
      description: "Search depth. 'advanced' is slower but more comprehensive (default: basic)",
    },
    maxResults: {
      type: "number" as const,
      description: "Maximum number of results, 1-20 (default: 5)",
    },
    topic: {
      type: "string" as const,
      enum: ["general", "news"],
      description: "Search topic (default: general)",
    },
    days: {
      type: "number" as const,
      description: "For news topic, limit to last N days",
    },
    includeAnswer: {
      type: "boolean" as const,
      description: "Include AI-generated answer summary (default: true)",
    },
    includeRaw: {
      type: "boolean" as const,
      description: "Include raw page content in results (default: false)",
    },
  },
  required: ["query"],
};

interface TavilySearchParams {
  query: string;
  depth?: "basic" | "advanced";
  maxResults?: number;
  topic?: "general" | "news";
  days?: number;
  includeAnswer?: boolean;
  includeRaw?: boolean;
}

export function registerTavilySearch(api: OpenClawPluginApi, config: WebSearchConfig, keyPool: TavilyKeyPool) {
  api.registerTool(
    {
      name: "tavily_search",
      label: "Tavily Search",
      description:
        "AI-optimized web search via Tavily API. Returns structured results with titles, URLs, snippets, relevance scores, and optional AI-generated answer summary. Use for factual queries, news, and general web search.",
      parameters: TavilySearchSchema,
      async execute(_toolCallId, params) {
        const p = params as TavilySearchParams;
        if (!p.query) return json({ error: "Missing required parameter: query" });
        if (!keyPool.available) return json({ error: "No Tavily API keys configured" });

        try {
          const result = await keyPool.tryWithRotation(async (apiKey) => {
            const body: Record<string, unknown> = {
              api_key: apiKey,
              query: p.query,
              search_depth: p.depth ?? "basic",
              max_results: Math.max(1, Math.min(p.maxResults ?? 5, 20)),
              topic: p.topic ?? "general",
              include_answer: p.includeAnswer ?? true,
              include_raw_content: p.includeRaw ?? false,
            };

            if (p.topic === "news" && p.days) {
              body.days = p.days;
            }

            return await postJson("https://api.tavily.com/search", body);
          });

          const data = result as Record<string, unknown>;
          const results = (data.results as Array<Record<string, unknown>>) ?? [];

          // Format output
          const lines: string[] = [];
          if (data.answer) {
            lines.push("## Answer\n", String(data.answer), "\n---\n");
          }

          lines.push("## Sources\n");
          for (const r of results) {
            const title = String(r.title ?? "").trim();
            const url = String(r.url ?? "").trim();
            const content = String(r.content ?? "").trim();
            const score = typeof r.score === "number" ? ` (relevance: ${(r.score * 100).toFixed(0)}%)` : "";
            if (!title || !url) continue;
            lines.push(`- **${title}**${score}`);
            lines.push(`  ${url}`);
            if (content) {
              lines.push(`  ${content.slice(0, 300)}${content.length > 300 ? "..." : ""}`);
            }
            lines.push("");
          }

          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
            details: data,
          };
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "tavily_search" },
  );

  api.logger.info?.("oc-websearch: Registered tavily_search tool");
}
