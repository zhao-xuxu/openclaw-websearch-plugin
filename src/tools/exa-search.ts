import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { WebSearchConfig } from "../config.js";
import { json, postJson } from "../utils.js";
import {
  buildContents,
  extractSnippet,
  type ExaContentsRequest,
  type ExaSearchResult,
} from "./exa-search-helpers.js";

const EXA_API_URL = "https://api.exa.ai/search";
const EXA_INTEGRATION_HEADER = "openclaw-websearch-plugin";

const ExaSearchSchema = {
  type: "object" as const,
  properties: {
    query: { type: "string" as const, description: "Search query (required)" },
    type: {
      type: "string" as const,
      enum: ["auto", "neural", "fast", "deep-lite", "deep", "deep-reasoning", "instant"],
      description: "Search type. 'auto' picks the best mode; 'neural' is semantic; 'fast' is low-latency; 'deep*' variants perform multi-step research (default: auto)",
    },
    numResults: {
      type: "number" as const,
      description: "Number of results, 1-100 (default: 5)",
    },
    category: {
      type: "string" as const,
      enum: [
        "company",
        "research paper",
        "news",
        "pdf",
        "github",
        "tweet",
        "personal site",
        "linkedin profile",
        "financial report",
      ],
      description: "Focus search on a specific content category",
    },
    includeDomains: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Only return results from these domains",
    },
    excludeDomains: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Exclude results from these domains",
    },
    includeText: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Only return results whose text contains all of these strings (max 1 string, up to 5 words)",
    },
    excludeText: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Exclude results whose text contains any of these strings",
    },
    startPublishedDate: {
      type: "string" as const,
      description: "Only return results published on or after this date (ISO 8601, e.g. 2024-01-01)",
    },
    endPublishedDate: {
      type: "string" as const,
      description: "Only return results published on or before this date (ISO 8601)",
    },
    userLocation: {
      type: "string" as const,
      description: "Two-letter ISO country code to localize results (e.g. 'US')",
    },
    contentMode: {
      type: "string" as const,
      enum: ["highlights", "text", "summary", "full"],
      description: "Which content to retrieve: 'highlights' (key snippets, default), 'text' (full page text), 'summary' (AI summary), or 'full' (all three)",
    },
    textMaxCharacters: {
      type: "number" as const,
      description: "When contentMode includes 'text', cap text at this many characters",
    },
    summaryQuery: {
      type: "string" as const,
      description: "When contentMode includes 'summary', a directive guiding what the summary should focus on",
    },
  },
  required: ["query"],
};

interface ExaSearchParams {
  query: string;
  type?: "auto" | "neural" | "fast" | "deep-lite" | "deep" | "deep-reasoning" | "instant";
  numResults?: number;
  category?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  includeText?: string[];
  excludeText?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  userLocation?: string;
  contentMode?: "highlights" | "text" | "summary" | "full";
  textMaxCharacters?: number;
  summaryQuery?: string;
}

interface ExaSearchRequestBody {
  query: string;
  type?: string;
  numResults?: number;
  category?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  includeText?: string[];
  excludeText?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  userLocation?: string;
  contents?: ExaContentsRequest;
}

interface ExaSearchResponse {
  requestId?: string;
  results?: ExaSearchResult[];
  searchType?: string;
  costDollars?: { total?: number } & Record<string, unknown>;
}

export function registerExaSearch(api: OpenClawPluginApi, config: WebSearchConfig) {
  api.registerTool(
    {
      name: "exa_search",
      label: "Exa Search",
      description:
        "Semantic web search via Exa. Supports neural and fast search modes, multi-step research (deep variants), category filtering (news, research paper, github, company, etc.), domain/text include-exclude filters, and date range filtering. Returns structured results with highlights, full text, or AI summary.",
      parameters: ExaSearchSchema,
      async execute(_toolCallId, params) {
        const p = params as ExaSearchParams;
        if (!p.query) return json({ error: "Missing required parameter: query" });
        if (!config.exaApiKey) return json({ error: "Exa API key not configured (set EXA_API_KEY)" });

        try {
          const body: ExaSearchRequestBody = {
            query: p.query,
            type: p.type ?? "auto",
            numResults: Math.max(1, Math.min(p.numResults ?? 5, 100)),
            contents: buildContents(p),
          };

          if (p.category) body.category = p.category;
          if (p.includeDomains && p.includeDomains.length > 0) body.includeDomains = p.includeDomains;
          if (p.excludeDomains && p.excludeDomains.length > 0) body.excludeDomains = p.excludeDomains;
          if (p.includeText && p.includeText.length > 0) body.includeText = p.includeText;
          if (p.excludeText && p.excludeText.length > 0) body.excludeText = p.excludeText;
          if (p.startPublishedDate) body.startPublishedDate = p.startPublishedDate;
          if (p.endPublishedDate) body.endPublishedDate = p.endPublishedDate;
          if (p.userLocation) body.userLocation = p.userLocation;

          const data = (await postJson(EXA_API_URL, body as unknown as Record<string, unknown>, {
            "x-api-key": config.exaApiKey,
            "x-exa-integration": EXA_INTEGRATION_HEADER,
          })) as ExaSearchResponse;

          const results = data.results ?? [];

          const lines: string[] = [];
          lines.push(`## Exa Search Results (${results.length})\n`);

          for (const r of results) {
            const title = (r.title ?? "").trim() || "(untitled)";
            const url = (r.url ?? "").trim();
            if (!url) continue;
            const score = typeof r.score === "number" ? ` (relevance: ${(r.score * 100).toFixed(0)}%)` : "";
            const meta: string[] = [];
            if (r.author) meta.push(r.author);
            if (r.publishedDate) meta.push(r.publishedDate.slice(0, 10));
            const metaStr = meta.length > 0 ? ` — ${meta.join(" • ")}` : "";

            lines.push(`- **${title}**${score}${metaStr}`);
            lines.push(`  ${url}`);
            const snippet = extractSnippet(r);
            if (snippet) {
              lines.push(`  ${snippet}`);
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
    { name: "exa_search" },
  );

  api.logger.info?.("oc-websearch: Registered exa_search tool");
}
