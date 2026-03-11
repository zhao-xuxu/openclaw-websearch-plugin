import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { WebSearchConfig } from "../config.js";
import type { TavilyKeyPool } from "../tavily-key-pool.js";
import { json, postJson } from "../utils.js";

const WebMapSchema = {
  type: "object" as const,
  properties: {
    url: { type: "string" as const, description: "Target site URL (required)" },
    depth: {
      type: "number" as const,
      description: "Crawl depth, 1-5 (default: 1)",
    },
    breadth: {
      type: "number" as const,
      description: "Crawl breadth per level (default: 20)",
    },
    limit: {
      type: "number" as const,
      description: "Maximum number of URLs to return (default: 50)",
    },
    instructions: {
      type: "string" as const,
      description: "Optional crawl instructions (e.g., 'only documentation pages')",
    },
  },
  required: ["url"],
};

interface WebMapParams {
  url: string;
  depth?: number;
  breadth?: number;
  limit?: number;
  instructions?: string;
}

export function registerWebMap(api: OpenClawPluginApi, config: WebSearchConfig, keyPool: TavilyKeyPool) {
  api.registerTool(
    {
      name: "ws_map",
      label: "WS Map",
      description:
        "Discover and map the URL structure of a website using Tavily Map API. Returns a list of discovered URLs. Useful for understanding site structure before fetching specific pages.",
      parameters: WebMapSchema,
      async execute(_toolCallId, params) {
        const p = params as WebMapParams;
        if (!p.url) return json({ error: "Missing required parameter: url" });
        if (!keyPool.available) return json({ error: "No Tavily API keys configured" });

        const depth = Math.max(1, Math.min(p.depth ?? 1, 5));

        try {
          const result = await keyPool.tryWithRotation(async (apiKey) => {
            const body: Record<string, unknown> = {
              api_key: apiKey,
              url: p.url,
              depth,
              breadth: p.breadth ?? 20,
              limit: p.limit ?? 50,
            };
            if (p.instructions) {
              body.instructions = p.instructions;
            }
            return await postJson("https://api.tavily.com/map", body);
          });

          return json(result);
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "ws_map" },
  );

  api.logger.info?.("oc-websearch: Registered ws_map tool");
}
