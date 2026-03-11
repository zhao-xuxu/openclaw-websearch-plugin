import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { WebSearchConfig } from "../config.js";
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

const TIME_KEYWORDS = /今天|最新|当前|latest|recent|today|current|now|这几天|本周|本月|近期|最近/i;

const GrokSearchSchema = {
  type: "object" as const,
  properties: {
    query: { type: "string" as const, description: "Search query (required)" },
    model: {
      type: "string" as const,
      description: "Grok model to use (default: configured model, typically grok-3-mini)",
    },
    platform: {
      type: "string" as const,
      description: "Focus on specific platform (e.g., Twitter, GitHub, Reddit)",
    },
  },
  required: ["query"],
};

interface GrokSearchParams {
  query: string;
  model?: string;
  platform?: string;
}

export function registerGrokSearch(api: OpenClawPluginApi, config: WebSearchConfig) {
  api.registerTool(
    {
      name: "grok_search",
      label: "Grok Search",
      description:
        "AI-powered web search using Grok model with real-time internet access. Returns comprehensive, citation-rich analysis. Best for complex research questions requiring synthesis from multiple sources. Supports platform-focused search (Twitter, GitHub, Reddit, etc.).",
      parameters: GrokSearchSchema,
      async execute(_toolCallId, params) {
        const p = params as GrokSearchParams;
        if (!p.query) return json({ error: "Missing required parameter: query" });
        if (!config.grokApiKey) return json({ error: "Grok API key not configured" });

        try {
          // Build user message with optional time injection
          let userMessage = p.query;
          if (TIME_KEYWORDS.test(p.query)) {
            const now = new Date().toISOString().replace("T", " ").slice(0, 19);
            userMessage = `[Current date and time: ${now}]\n\n${userMessage}`;
          }
          if (p.platform) {
            userMessage += `\n\nYou should focus on these platform: ${p.platform}`;
          }

          const model = p.model ?? config.grokModel;
          const data = (await postJson(
            `${config.grokApiUrl}/v1/chat/completions`,
            {
              model,
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
          const content = String(message?.content ?? "");

          return {
            content: [{ type: "text" as const, text: content || "(No response from Grok)" }],
            details: {
              content,
              model: data.model,
              usage: data.usage,
            },
          };
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "grok_search" },
  );

  api.logger.info?.("oc-websearch: Registered grok_search tool");
}
