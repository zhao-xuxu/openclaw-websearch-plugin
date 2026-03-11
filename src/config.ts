import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface WebSearchConfig {
  grokApiUrl: string;
  grokApiKey: string;
  grokModel: string;
  tavilyApiKeys: string[];
  firecrawlApiUrl: string;
  firecrawlApiKey: string;
}

const DEFAULTS: WebSearchConfig = {
  grokApiUrl: "http://127.0.0.1:8000",
  grokApiKey: "",
  grokModel: "grok-3-mini",
  tavilyApiKeys: [],
  firecrawlApiUrl: "https://api.firecrawl.dev/v2",
  firecrawlApiKey: "",
};

/** Parse comma-separated string into array, filtering empty values. */
function parseKeyList(val: string | undefined): string[] {
  if (!val) return [];
  return val.split(",").map((k) => k.trim()).filter(Boolean);
}

/** Load .env file from plugin directory into a key-value map. */
function loadDotEnv(pluginDir: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    const content = readFileSync(join(pluginDir, "web-search.env"), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && val) result[key] = val;
    }
  } catch {
    // .env file not found — that's fine
  }
  return result;
}

/**
 * Resolve config with priority: .env file > pluginConfig JSON > default.
 *
 * Place a .env file in ~/.openclaw/extensions/web-search/.env:
 *
 *   TAVILY_API_KEY=tvly-key1,tvly-key2
 *   GROK_API_KEY=your-key
 *   FIRECRAWL_API_KEY=fc-xxx
 */
export function resolveConfig(pluginConfig?: Record<string, unknown>): WebSearchConfig {
  const cfg = pluginConfig ?? {};
  const pluginDir = dirname(fileURLToPath(import.meta.url)).replace(/[/\\]src$/, "");
  const dotenv = loadDotEnv(pluginDir);

  // Helper: dotenv > pluginConfig > default
  const get = (envKey: string, cfgKey: string, fallback: string) =>
    String(dotenv[envKey] || cfg[cfgKey] || fallback);

  const tavilyKeys = parseKeyList(dotenv.TAVILY_API_KEY);
  const tavilyKeysFromCfg = Array.isArray(cfg.tavilyApiKeys) ? cfg.tavilyApiKeys.map(String).filter(Boolean) : [];

  return {
    grokApiUrl: get("GROK_API_URL", "grokApiUrl", DEFAULTS.grokApiUrl).replace(/\/$/, ""),
    grokApiKey: get("GROK_API_KEY", "grokApiKey", DEFAULTS.grokApiKey),
    grokModel: get("GROK_MODEL", "grokModel", DEFAULTS.grokModel),
    tavilyApiKeys: tavilyKeys.length > 0 ? tavilyKeys : tavilyKeysFromCfg,
    firecrawlApiUrl: get("FIRECRAWL_API_URL", "firecrawlApiUrl", DEFAULTS.firecrawlApiUrl).replace(/\/$/, ""),
    firecrawlApiKey: get("FIRECRAWL_API_KEY", "firecrawlApiKey", DEFAULTS.firecrawlApiKey),
  };
}
