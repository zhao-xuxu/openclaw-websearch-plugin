import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { WebSearchConfig } from "../config.js";
import type { TavilyKeyPool } from "../tavily-key-pool.js";
import { json, postJson } from "../utils.js";

const GROK_SYSTEM_PROMPT = `# Core Instruction

1. User needs may be vague. Think divergently, infer intent from multiple angles, and leverage full conversation context to progressively clarify their true needs.
2. **Breadth-First Search**—Approach problems from multiple dimensions. Brainstorm 5+ perspectives and execute parallel searches for each. Consult as many high-quality sources as possible before responding.
3. **Depth-First Search**—After broad exploration, select ≥2 most relevant perspectives for deep investigation into specialized knowledge.
4. **Evidence-Based Reasoning & Traceable Sources**—Every claim must be followed by a citation. More credible sources strengthen arguments. If no references exist, remain silent.
5. Before responding, ensure full execution of Steps 1–4.

# Search Instruction

1. Think carefully before responding—anticipate the user's true intent to ensure precision.
2. Verify every claim rigorously to avoid misinformation.
3. Follow problem logic—dig deeper until clues are exhaustively clear. Use multiple parallel tool calls per query and ensure answers are well-sourced.
4. Search in English first (prioritizing English resources for volume/quality), but switch to Chinese if context demands.
5. Prioritize authoritative sources: Wikipedia, academic databases, books, reputable media/journalism.
6. Favor sharing in-depth, specialized knowledge over generic or common-sense content.

# Output Style

1. Lead with the **most probable solution** before detailed analysis.
2. **Define every technical term** in plain language.
3. **Respect facts and search results—use statistical rigor to discern truth**.
4. **Every sentence must cite sources**. More references = stronger credibility.
5. **Strictly format outputs in polished Markdown**.`;

const DualSearchSchema = {
  type: "object" as const,
  properties: {
    query: { type: "string" as const, description: "Search query (required)" },
    tavilyDepth: {
      type: "string" as const,
      enum: ["basic", "advanced"],
      description: "Tavily search depth (default: basic)",
    },
  },
  required: ["query"],
};

interface DualSearchParams {
  query: string;
  tavilyDepth?: "basic" | "advanced";
}

async function grokSearch(query: string, config: WebSearchConfig): Promise<Record<string, unknown>> {
  if (!config.grokApiKey) return { error: "Grok API key not configured" };

  try {
    const TIME_KEYWORDS = /今天|最新|当前|latest|recent|today|current|now|这几天|本周|本月|近期|最近/i;
    let userMessage = query;
    if (TIME_KEYWORDS.test(query)) {
      const now = new Date().toISOString().replace("T", " ").slice(0, 19);
      userMessage = `[Current date and time: ${now}]\n\n${userMessage}`;
    }

    const data = (await postJson(
      `${config.grokApiUrl}/v1/chat/completions`,
      {
        model: config.grokModel,
        stream: false,
        messages: [
          { role: "system", content: GROK_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
      },
      { Authorization: `Bearer ${config.grokApiKey}` },
    )) as Record<string, unknown>;

    const choices = data.choices as Array<Record<string, unknown>> | undefined;
    const message = choices?.[0]?.message as Record<string, unknown> | undefined;
    return { content: String(message?.content ?? ""), model: data.model, usage: data.usage };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function tavilySearch(
  query: string,
  depth: string,
  keyPool: TavilyKeyPool,
): Promise<Record<string, unknown>> {
  if (!keyPool.available) return { error: "No Tavily API keys configured" };

  try {
    return (await keyPool.tryWithRotation(async (apiKey) => {
      return await postJson("https://api.tavily.com/search", {
        api_key: apiKey,
        query,
        search_depth: depth,
        max_results: 5,
        topic: "general",
        include_answer: true,
        include_raw_content: false,
      });
    })) as Record<string, unknown>;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export function registerDualSearch(api: OpenClawPluginApi, config: WebSearchConfig, keyPool: TavilyKeyPool) {
  api.registerTool(
    {
      name: "dual_search",
      label: "Dual Search",
      description:
        "Parallel dual-engine search combining Grok AI search and Tavily structured search. Returns aggregated results from both engines. Use when you need comprehensive coverage from multiple search perspectives.",
      parameters: DualSearchSchema,
      async execute(_toolCallId, params) {
        const p = params as DualSearchParams;
        if (!p.query) return json({ error: "Missing required parameter: query" });

        try {
          const [grokResult, tavilyResult] = await Promise.allSettled([
            grokSearch(p.query, config),
            tavilySearch(p.query, p.tavilyDepth ?? "basic", keyPool),
          ]);

          const result = {
            grok: grokResult.status === "fulfilled" ? grokResult.value : { error: String(grokResult.reason) },
            tavily: tavilyResult.status === "fulfilled" ? tavilyResult.value : { error: String(tavilyResult.reason) },
          };

          // Format combined output
          const lines: string[] = [];

          lines.push("# Dual Search Results\n");

          // Grok section
          lines.push("## Grok AI Search\n");
          const grok = result.grok as Record<string, unknown>;
          if (grok.error) {
            lines.push(`Error: ${grok.error}\n`);
          } else {
            lines.push(String(grok.content ?? "(no content)"));
            lines.push("");
          }

          // Tavily section
          lines.push("\n## Tavily Structured Search\n");
          const tavily = result.tavily as Record<string, unknown>;
          if (tavily.error) {
            lines.push(`Error: ${tavily.error}\n`);
          } else {
            if (tavily.answer) {
              lines.push(`**Answer:** ${tavily.answer}\n`);
            }
            const results = (tavily.results as Array<Record<string, unknown>>) ?? [];
            for (const r of results) {
              const title = String(r.title ?? "").trim();
              const url = String(r.url ?? "").trim();
              const content = String(r.content ?? "").trim();
              if (!title || !url) continue;
              lines.push(`- **${title}**`);
              lines.push(`  ${url}`);
              if (content) {
                lines.push(`  ${content.slice(0, 200)}${content.length > 200 ? "..." : ""}`);
              }
              lines.push("");
            }
          }

          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
            details: result,
          };
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "dual_search" },
  );

  api.logger.info?.("oc-websearch: Registered dual_search tool");
}
