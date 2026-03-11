import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { WebSearchConfig } from "../config.js";
import type { TavilyKeyPool } from "../tavily-key-pool.js";
import { json, postJson } from "../utils.js";

const WebFetchSchema = {
  type: "object" as const,
  properties: {
    urls: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "URLs to fetch content from (required, 1 or more)",
    },
    depth: {
      type: "string" as const,
      enum: ["basic", "advanced"],
      description: "Extraction depth (default: basic)",
    },
    format: {
      type: "string" as const,
      enum: ["markdown", "text"],
      description: "Output format (default: markdown)",
    },
  },
  required: ["urls"],
};

interface WebFetchParams {
  urls: string[];
  depth?: "basic" | "advanced";
  format?: "markdown" | "text";
}

interface FetchResult {
  url: string;
  raw_content: string;
}

/** Try Tavily Extract API first. */
async function tavilyExtract(
  urls: string[],
  keyPool: TavilyKeyPool,
): Promise<FetchResult[] | null> {
  if (!keyPool.available) return null;

  try {
    const data = (await keyPool.tryWithRotation(async (apiKey) => {
      return await postJson("https://api.tavily.com/extract", {
        api_key: apiKey,
        urls,
      });
    })) as Record<string, unknown>;

    const results = (data.results as Array<Record<string, unknown>>) ?? [];
    const valid = results.filter(
      (r) => r.raw_content && String(r.raw_content).trim().length > 0,
    );

    if (valid.length === 0) return null;
    return valid.map((r) => ({
      url: String(r.url ?? ""),
      raw_content: String(r.raw_content ?? ""),
    }));
  } catch {
    return null;
  }
}

/** Fallback: FireCrawl Scrape API (single URL at a time). */
async function firecrawlScrape(
  urls: string[],
  config: WebSearchConfig,
): Promise<FetchResult[] | null> {
  if (!config.firecrawlApiKey) return null;

  const results: FetchResult[] = [];
  for (const url of urls) {
    try {
      const data = (await postJson(
        `${config.firecrawlApiUrl}/scrape`,
        { url, formats: ["markdown"] },
        { Authorization: `Bearer ${config.firecrawlApiKey}` },
      )) as Record<string, unknown>;

      const d = data.data as Record<string, unknown> | undefined;
      const content = String(d?.markdown ?? d?.content ?? "").trim();
      if (content && content !== "null") {
        results.push({ url, raw_content: content });
      }
    } catch {
      // Skip failed URLs in FireCrawl
    }
  }

  return results.length > 0 ? results : null;
}

export function registerWebFetch(api: OpenClawPluginApi, config: WebSearchConfig, keyPool: TavilyKeyPool) {
  api.registerTool(
    {
      name: "ws_fetch",
      label: "WS Fetch",
      description:
        "Fetch and extract content from web pages. Supports multiple URLs. Uses Tavily Extract with FireCrawl fallback. Returns page content in markdown or text format.",
      parameters: WebFetchSchema,
      async execute(_toolCallId, params) {
        const p = params as WebFetchParams;
        if (!p.urls || p.urls.length === 0) {
          return json({ error: "Missing required parameter: urls" });
        }

        try {
          // Level 1: Tavily Extract
          const tavilyResults = await tavilyExtract(p.urls, keyPool);
          if (tavilyResults) {
            return formatResults("tavily", tavilyResults, p.urls);
          }

          // Level 2: FireCrawl Scrape
          const firecrawlResults = await firecrawlScrape(p.urls, config);
          if (firecrawlResults) {
            return formatResults("firecrawl", firecrawlResults, p.urls);
          }

          return json({ error: "All extraction methods failed (Tavily Extract and FireCrawl Scrape)" });
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "ws_fetch" },
  );

  api.logger.info?.("oc-websearch: Registered ws_fetch tool");
}

function formatResults(source: string, results: FetchResult[], requestedUrls: string[]) {
  const fetchedUrls = new Set(results.map((r) => r.url));
  const failedUrls = requestedUrls.filter((u) => !fetchedUrls.has(u));

  const lines: string[] = [];
  for (const r of results) {
    lines.push(`# ${r.url}\n`);
    lines.push(r.raw_content);
    lines.push("\n---\n");
  }

  if (failedUrls.length > 0) {
    lines.push("## Failed URLs\n");
    for (const u of failedUrls) {
      lines.push(`- ${u}`);
    }
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    details: { source, results, failedUrls },
  };
}
