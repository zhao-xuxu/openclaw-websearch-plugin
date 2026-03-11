# AI 安装指令

你是一个安装助手。请按照以下步骤为用户安装 OpenClaw Web Search Plugin（插件 id: `oc-websearch`）。

## 判断安装模式

先询问用户：**你是带 Keys 整包复制，还是全新安装？**

- **带 Keys 复制**（用户自己的电脑之间迁移，env 文件里已有 Keys）→ 跳到「快速安装」
- **全新安装**（新设备，需要配置 Keys）→ 跳到「完整安装」

---

## 快速安装（带 Keys 复制）

适用于：用户已有完整的插件目录（含 `web-search.env` 和 Keys），直接复制到新设备。

### 1. 复制插件目录

```bash
mkdir -p ~/.openclaw/extensions/oc-websearch
cp -r <源路径>/* ~/.openclaw/extensions/oc-websearch/
```

### 2. 修改 openclaw.json

读取 `~/.openclaw/openclaw.json`，做增量修改（不要覆盖已有配置）：

- `plugins.allow` 数组追加 `"oc-websearch"`
- `plugins.entries` 添加 `"oc-websearch": { "enabled": true }`
- `tools.alsoAllow` 数组确保包含 `"group:plugins"`

```jsonc
{
  "plugins": {
    "allow": ["..已有的..", "oc-websearch"],
    "entries": {
      "...已有的...": {},
      "oc-websearch": { "enabled": true }
    }
  },
  "tools": {
    "alsoAllow": ["group:plugins"]
  }
}
```

### 3. 重启并验证

```bash
openclaw gateway stop && sleep 2 && openclaw gateway start
```

查看日志确认成功：
```bash
# Linux / WSL
journalctl --user -u openclaw-gateway -n 30 --no-pager | grep oc-websearch

# macOS
tail -30 ~/.openclaw/logs/gateway.log | grep oc-websearch
```

看到 `oc-websearch: All 5 tools registered successfully` 即完成。

---

## 完整安装（全新设备）

### 前置检查

1. 确认 OpenClaw 已安装（执行 `openclaw status` 验证）
2. 确认 Node.js >= 22（执行 `node -v`）
3. 如果 `~/.openclaw/` 不存在，先运行 `openclaw init`

### 第一步：部署插件文件

```bash
mkdir -p ~/.openclaw/extensions/oc-websearch
cp -r <插件源码路径>/* ~/.openclaw/extensions/oc-websearch/
```

需要的文件结构：
```
oc-websearch/
├── index.ts
├── openclaw.plugin.json
├── package.json
├── web-search.env
├── src/
│   ├── config.ts
│   ├── tavily-key-pool.ts
│   ├── utils.ts
│   └── tools/
│       ├── grok-search.ts
│       ├── tavily-search.ts
│       ├── web-fetch.ts
│       ├── web-map.ts
│       └── dual-search.ts
```

不需要 `npm install`，不需要编译，OpenClaw 直接加载 TypeScript。

### 第二步：配置 API Keys

编辑 `~/.openclaw/extensions/oc-websearch/web-search.env`，向用户询问以下信息：

**Tavily API Key**（必填，搜索引擎）
- 免费申请：https://tavily.com ，每个 Key 1000 次/月
- 支持多个 Key 逗号分隔，可叠加额度

**Grok API**（必填，AI 深度搜索）
- 需要一个 OpenAI 兼容的 Grok API 服务（中转站）
- 向用户询问：API 地址、API Key、模型名
- 模型名不确定就默认 `grok-4.1-fast`

**FireCrawl API Key**（选填，网页抓取备用）
- 申请：https://firecrawl.dev
- 不填也能用，大部分场景够用

env 文件模板：
```env
# Tavily（必填）
TAVILY_API_KEY=tvly-key-1,tvly-key-2

# Grok（必填）
GROK_API_URL=https://your-relay.com
GROK_API_KEY=sk-your-key
GROK_MODEL=grok-4.1-fast

# FireCrawl（选填）
# FIRECRAWL_API_KEY=fc-your-key
```

### 第三步：修改 openclaw.json

与快速安装的第 2 步相同 — 增量修改 `plugins.allow`、`plugins.entries`、`tools.alsoAllow`。

### 第四步：重启并验证

与快速安装的第 3 步相同。

### 第五步：功能测试

让用户通过飞书或 Telegram 发送：

> 帮我搜索一下今天有什么 AI 新闻

Agent 调用了 `tavily_search` 或 `grok_search` 并返回结果，说明安装成功。

---

## 常见问题

| 现象 | 原因 | 解决 |
|------|------|------|
| 日志无 oc-websearch 输出 | 未加入 allow | `plugins.allow` 追加 `"oc-websearch"` |
| Agent 不调用搜索工具 | 工具未暴露 | `tools.alsoAllow` 加 `"group:plugins"` |
| `Grok API key not configured` | Key 为空 | 检查 `web-search.env` 中的 Key |
| `No Tavily API keys configured` | Key 为空 | 同上 |
| `HTTP 401` | Key 无效 | 重新检查 Key 是否正确 |
| `duplicate plugin id` | 插件 id 冲突 | 检查 extensions 下无同名插件 |

## 重要提醒

- **不要**把 `web-search.env` 提交到 Git（含 API Keys）
- **不要**在 `plugins.installs` 中添加 oc-websearch，本地插件不需要
- **不要**执行 `npm install`，无外部依赖
- 配置优先级：`web-search.env` > `openclaw.json pluginConfig` > 代码默认值
