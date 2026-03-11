import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/core";
import { resolveConfig } from "./src/config.js";
import { TavilyKeyPool } from "./src/tavily-key-pool.js";
import { registerGrokSearch } from "./src/tools/grok-search.js";
import { registerTavilySearch } from "./src/tools/tavily-search.js";
import { registerWebFetch } from "./src/tools/web-fetch.js";
import { registerWebMap } from "./src/tools/web-map.js";
import { registerDualSearch } from "./src/tools/dual-search.js";

const plugin = {
  id: "oc-websearch",
  name: "OC WebSearch",
  description: "Powerful web search plugin with Grok AI + Tavily dual-engine search",
  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api.pluginConfig);
    const keyPool = new TavilyKeyPool(config.tavilyApiKeys);

    api.logger.info?.(`oc-websearch: Initializing with ${config.tavilyApiKeys.length} Tavily key(s), grok=${config.grokApiUrl}`);

    registerGrokSearch(api, config);
    registerTavilySearch(api, config, keyPool);
    registerWebFetch(api, config, keyPool);
    registerWebMap(api, config, keyPool);
    registerDualSearch(api, config, keyPool);

    api.logger.info?.("oc-websearch: All 5 tools registered successfully");
  },
};

export default plugin;
