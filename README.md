# OpenClaw Web Search Plugin

为 OpenClaw 提供联网搜索能力的插件。通过飞书 / Telegram / WeCom 向 Agent 发消息，即可触发搜索、抓取网页、映射站点结构。

> **推荐安装方式** 将 [INSTALL-PROMPT.md](INSTALL-PROMPT.md) 的内容发送给 **Claude Code（CC）**，AI 会一步步引导你完成全部配置，无需手动操作。

> **致谢** 本项目的搜索提示词和工具设计参考了 [UltimateSearchSkill](https://github.com/ckckck/UltimateSearchSkill.git)，感谢原作者的开源贡献。

### 为什么需要这个插件？

没装插件之前，OpenClaw Agent 搜索网络只有两条路：

| 方式 | 问题 |
|------|------|
| 内置 `web_search`（group:web） | 慢，会触发 reasoning 思考链，简单问题也要 60-90 秒 |
| 浏览器工具（group:ui） | 更慢，用 Chromium 爬页面，容易超时断连 |

装了这个插件后，Agent 有了**专用搜索工具**，行为变得克制、精准：

| 场景 | 耗时（实测） |
|------|-------------|
| 普通对话（不搜索） | 5-10 秒 |
| 搜索类问题（tavily_search） | 15-25 秒 |
| 深度搜索（grok_search） | 25-40 秒 |
| 修复前（内置 web_search + reasoning） | 60-90 秒 |

**Tips**：配合 `reasoning: false` 使用效果更好，否则模型会在调用工具前先"思考"很久，抵消速度优势。

### Skill vs Tool：为什么要重构？

在 OpenClaw 中，**Skill** 和 **Tool** 是两种不同的扩展机制：

| | Skill | Plugin Tool |
|--|-------|-------------|
| 原理 | 一个 SKILL.md 文件，告诉 Agent 如何通过 Bash 调用外部脚本 | 通过 `api.registerTool()` 注册为原生工具，出现在 Agent 的工具列表中 |
| 调用方式 | Agent 读取 SKILL.md 指令 → 用 Bash 工具执行 `.sh` 脚本 | Agent 直接按名称调用（如 `grok_search`），参数有 JSON Schema 校验 |
| 依赖 | 需要 bash、curl、jq 等系统命令 | 只需 Node.js，在 OpenClaw 进程内运行 |
| 输入输出 | 命令行参数传入，stdout 文本输出，需要手动解析 | 结构化 JSON 参数传入，结构化结果返回 |

[UltimateSearchSkill](https://github.com/ckckck/UltimateSearchSkill.git) 采用 Skill 方案：5 个 Shell 脚本 + SKILL.md 指令 + 3 个 Docker 容器（grok2api + FlareSolverr + TavilyProxyManager）。

本项目将其重构为 **Plugin Tool**，保留全部 5 个工具的功能，具体改进：

- **Skill → Plugin Tool**：从 Shell 脚本改为 `api.registerTool()` 原生工具。Agent 直接调用，不再需要通过 Bash 执行脚本，参数校验和错误处理更可靠
- **去掉 TavilyProxyManager 容器**：原版通过单独的 Docker 容器（TavilyProxyManager）做 Tavily 多 Key 代理和负载均衡；本项目将 Key 轮转逻辑内置于插件代码中（遇到 429/401 自动切换下一个 Key），不再需要额外容器
- **支持 Grok 中转站**：原版只能通过本地 grok2api Docker 访问 Grok；本项目额外支持任意 OpenAI 兼容的中转站，使用中转站时不需要任何 Docker 容器
- **零外部依赖**：不需要 `npm install`、不需要编译、不需要 curl/jq，复制文件后 OpenClaw 直接加载 TypeScript
- **AI 引导安装**：提供 `INSTALL-PROMPT.md` 安装提示词，发送给 Claude Code 即可自动完成安装配置

---

## 1. 工具一览

| 工具 | 用途 | 特点 |
|------|------|------|
| `tavily_search` | 快速结构化搜索 | 返回干净摘要，不需要解析 HTML，速度快 |
| `grok_search` | AI 深度搜索 | 带推理的搜索，适合复杂问题，返回带引用的分析 |
| `dual_search` | 双引擎并行搜索 | 同时调用 Grok + Tavily，合并结果 |
| `ws_fetch` | 抓取网页内容 | 比浏览器轻量，直接拿内容，支持多 URL 批量 |
| `ws_map` | 网站结构探索 | 发现站点 URL 结构，了解站点全貌 |

---

## 2. 快速安装

### 2.1 前置条件

- OpenClaw 已运行（Node.js >= 22）
- 至少一个消息渠道可用（飞书 / Telegram）

### 2.2 部署插件

```bash
# 复制到 extensions 目录
mkdir -p ~/.openclaw/extensions/oc-websearch
cp -r <插件源码路径>/* ~/.openclaw/extensions/oc-websearch/
```

### 2.3 填写 API Keys

编辑 `~/.openclaw/extensions/oc-websearch/web-search.env`：

```env
# --- 必填 ---

# Tavily（逗号分隔多 key，免费 1000 次/月）
# 申请：https://tavily.com
TAVILY_API_KEY=tvly-key-1,tvly-key-2

# Grok（推荐中转站: https://ai.huan666.de ，每天签到可领余额，速度快）
GROK_API_URL=https://ai.huan666.de
GROK_API_KEY=sk-your-key
GROK_MODEL=grok-4.1-fast

# --- 选填 ---

# FireCrawl（ws_fetch 的备用抓取引擎）
# 申请：https://firecrawl.dev
# FIRECRAWL_API_KEY=fc-your-key
```

### 2.4 启用插件

在 `~/.openclaw/openclaw.json` 中加入：

```jsonc
{
  "plugins": {
    "allow": ["oc-websearch"],           // 允许加载
    "entries": {
      "oc-websearch": { "enabled": true }
    }
  },
  "tools": {
    "alsoAllow": ["group:plugins"]     // 让 Agent 能调用插件工具
  }
}
```

### 2.5 重启生效

```bash
openclaw gateway stop && openclaw gateway start
```

看到以下日志即安装成功：

```
[plugins] oc-websearch: All 5 tools registered successfully
```

---

## 3. Grok 后端：两种方案

### 方案 A：中转站（推荐）

直接填中转站地址和 Key 即可，零维护。

```env
GROK_API_URL=https://your-relay.com
GROK_API_KEY=sk-xxx
GROK_MODEL=grok-4.1-fast
```

### 方案 B：本地 grok2api Docker（免费）

适合不想付费、愿意折腾的用户。

```bash
cd ~/web-search-docker
cp <插件源码>/docker/docker-compose.yml .
docker compose up -d
```

启动后需要：

1. 访问 `http://127.0.0.1:8000/admin` 进入管理面板
2. 获取 Grok SSO Cookie：
   - 浏览器登录 [grok.com](https://grok.com)
   - 按 F12 打开开发者工具 → Application → Cookies → `https://grok.com`
   - 复制名为 `sso` 或 `sso-rw` 的 Cookie 值（以 `eyJ` 开头的 JWT 字符串）
3. 在管理面板将 SSO Cookie 添加到 **ssoBasic** 池（注意：必须是 ssoBasic，不是 default，否则 API 找不到 Token）
4. 在 `data/grok2api/config.toml` 中配置代理和 FlareSolverr 地址

```env
GROK_API_URL=http://127.0.0.1:8000
GROK_API_KEY=your-admin-password
GROK_MODEL=grok-3-mini
```

**对比：**

|  | 中转站 | 本地 Docker |
|--|--------|------------|
| 费用 | ~$0.001/次 | 免费 |
| 模型 | grok-4.1-fast 等全系列 | grok-3-mini |
| 稳定性 | 高 | 依赖 CF bypass，偶尔失效 |
| 维护量 | 无 | Docker + Token + CF 刷新 |

---

## 4. 设计细节

### 配置优先级

```
web-search.env  >  openclaw.json pluginConfig  >  代码默认值
```

### Tavily 多 Key 轮转

使用粘性策略：一直用当前 Key，遇到 429（额度耗尽）或 401（失效）后自动切到下一个。多个免费 Key 可叠加额度。

### ws_fetch 降级链

```
Tavily Extract（批量，首选）→ FireCrawl Scrape（逐 URL，备选）→ 报错
```

不配置 FireCrawl Key 则只有第一级。

### 使用建议

- **配合 `reasoning: false`**：建议在 Agent 配置中关闭 reasoning，否则模型会在调用搜索工具前先进行长时间思考，抵消搜索速度优势
- **grok_search 质量取决于中转站**：如果使用第三方中转站，搜索质量和稳定性取决于中转站的服务水平
- **SOUL.md 配合**：建议在 Agent 的 SOUL.md 中加入"不要滥用搜索"的提示，让模型只在真正需要时才调用搜索工具

---

## 5. 移植到其他机器

1. 复制 `web-search-plugin/` 整个目录
2. 放入目标机器的 `~/.openclaw/extensions/oc-websearch/`
3. 编辑 `web-search.env` 填入 API Keys
4. 在 `openclaw.json` 中添加 allow 和 alsoAllow
5. 重启 Gateway

无需 `npm install`，无外部依赖。

---

## 6. 故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| 插件没加载 | `plugins.allow` 缺少 `oc-websearch` | 添加到 allow 数组 |
| Agent 不调用搜索工具 | 工具未暴露给 Agent | `tools.alsoAllow` 加 `group:plugins` |
| Grok 报错 | 中转站：余额不足或 Key 错误 | 检查余额和 Key |
| | Docker：Token 不在 ssoBasic 池 | 重新添加到 ssoBasic |
| | Docker：CF 过期 (403) | 重启容器触发刷新 |
| Tavily 401/429 | Key 无效或额度耗尽 | 会自动轮转；全部耗尽则需加 Key |
| 飞书回复中断 | LLM API 限流 | 等限流窗口过后重试 |

---

## 7. 文件结构

```
web-search-plugin/
├── index.ts                  # 入口，注册 5 个工具
├── openclaw.plugin.json      # 插件清单
├── package.json
├── web-search.env            # API Keys（勿提交 Git）
├── sync.sh                   # 开发用：同步到 WSL 并重启
├── src/
│   ├── config.ts             # 配置解析
│   ├── tavily-key-pool.ts    # Tavily Key 轮转
│   ├── utils.ts              # HTTP 封装
│   └── tools/
│       ├── grok-search.ts
│       ├── tavily-search.ts
│       ├── web-fetch.ts
│       ├── web-map.ts
│       └── dual-search.ts
└── docker/
    └── docker-compose.yml    # grok2api 本地部署（可选）
```
