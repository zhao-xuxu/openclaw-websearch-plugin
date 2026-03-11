#!/bin/bash
# 同步插件到 WSL 并重启 Gateway
# 用法: wsl -- bash /mnt/d/openclaw/openclaw-websearch-plugin/sync.sh

PLUGIN_SRC="/mnt/d/openclaw/openclaw-websearch-plugin"
PLUGIN_DST="$HOME/.openclaw/extensions/oc-websearch"

mkdir -p "$PLUGIN_DST"
cp -r "$PLUGIN_SRC"/*.ts "$PLUGIN_SRC"/*.json "$PLUGIN_SRC"/src "$PLUGIN_DST/"

# 仅在目标没有 env 文件时复制模板
if [ ! -f "$PLUGIN_DST/web-search.env" ]; then
  cp "$PLUGIN_SRC/web-search.env" "$PLUGIN_DST/web-search.env"
  echo "Copied web-search.env template — please fill in your API keys."
fi

echo "Files synced to $PLUGIN_DST"
source ~/.nvm/nvm.sh 2>/dev/null
openclaw gateway restart
