# OpenClaw Web Search Plugin

为 OpenClaw 提供联网搜索能力的插件。通过飞书 / Telegram 向 Agent 发消息，即可触发搜索、抓取网页、映射站点结构。

> **致谢** 本项目的搜索提示词和工具设计参考了 [UltimateSearchSkill](https://github.com/ckckck/UltimateSearchSkill.git)，感谢原作者的开源贡献。

---

## 1. 工具一览

| 工具 | 用途 | 后端 |
|------|------|------|
| `grok_search` | AI 深度搜索，返回带引用的完整分析 | Grok |
| `tavily_search` | 结构化搜索，返回标题 / URL / 摘要 / 相关度 | Tavily |
| `ws_fetch` | 抓取网页正文，支持多 URL 批量 | Tavily Extract → FireCrawl |
| `ws_map` | 发现站点 URL 结构 | Tavily Map |
| `dual_search` | 并行调用 Grok + Tavily，合并两个引擎的结果 | Grok + Tavily |

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

# Grok（推荐用中转站，也可用本地 grok2api）
GROK_API_URL=https://your-relay.com
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
2. 将 Grok SSO Cookie 添加到 **ssoBasic** 池（不是 default）
3. 在 `data/grok2api/config.toml` 中配置代理和 FlareSolverr 地址

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
| 插件没加载 | `plugins.allow` 缺少 `web-search` | 添加到 allow 数组 |
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
