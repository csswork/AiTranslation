#!/usr/bin/env bash
# 打包成可上传到 Chrome 网上应用店的 zip。
# manifest.json 必须位于 zip 根目录，开发用文件不能打进去。
set -euo pipefail

cd "$(dirname "$0")"
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
OUT="../ai-translation-${VERSION}.zip"

rm -f "$OUT"
zip -r -q "$OUT" . \
  -x '.git/*' '.git' '.gitignore' '.DS_Store' '*/.DS_Store' \
     '.harness/*' 'package.sh' 'README.md' 'PRIVACY.md' '*.zip' \
     'docs/*' 'docs' '.claude/*' '.claude'

echo "已打包: $(cd .. && pwd)/$(basename "$OUT")"
unzip -l "$OUT" | tail -1
echo
echo "根目录内容（manifest.json 必须在其中）："
unzip -l "$OUT" | awk 'NR>3 && $4 !~ /\// {print "  " $4}' | grep -v '^  $' || true
