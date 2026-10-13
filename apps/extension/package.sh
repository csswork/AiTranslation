#!/usr/bin/env bash
# 扩展运行文件白名单；仓库 LICENSE 在打包时拷入临时目录。
set -euo pipefail

EXTENSION_ROOT="$(cd "$(dirname "$0")" && pwd)"
REPOSITORY_ROOT="$(cd "$EXTENSION_ROOT/../.." && pwd)"
cd "$EXTENSION_ROOT"
node scripts/sync-extension-i18n.mjs
node scripts/build-extension-i18n.mjs --check

VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
mkdir -p "$REPOSITORY_ROOT/dist/extension"
OUT="$REPOSITORY_ROOT/dist/extension/ai-translation-${VERSION}.zip"
STAGING=$(mktemp -d "${TMPDIR:-/tmp}/aitr-package.XXXXXX")
trap 'rm -rf "$STAGING"' EXIT

cp manifest.json "$STAGING/"
cp "$REPOSITORY_ROOT/LICENSE" "$STAGING/"
cp -R icons src _locales "$STAGING/"
rm -f "$OUT"
(cd "$STAGING" && zip -r -q "$OUT" manifest.json LICENSE icons src _locales -x '*.DS_Store')

# 隐藏文件和开发目录必须在所有层级排除，包含误放入 src/ 的文件。
if unzip -Z1 "$OUT" | grep -E '(^|/)\.|(^|/)(tools|store-assets|scripts|i18n|test|docs|public|backend|node_modules)/'; then
  rm -f "$OUT"
  echo '中止：安装包包含隐藏文件或开发目录，已删除产物。' >&2
  exit 1
fi

echo "已打包: $OUT"
unzip -l "$OUT" | tail -1
