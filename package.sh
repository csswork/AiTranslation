#!/usr/bin/env bash
# 打包成可上传到 Chrome 网上应用店的 zip。
# manifest.json 必须位于 zip 根目录，开发用文件不能打进去。
#
# 用白名单：只打扩展运行需要的东西。以前是「整个目录减去已知的开发文件」，
# 目录里冒出新文件（比如 vercel env pull 生成的 .env.local）就会被带进去——
# 商店里的包任何人都能下载解开，带进去就等于公开。
set -euo pipefail

cd "$(dirname "$0")"
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
OUT="../ai-translation-${VERSION}.zip"
# 白名单。tools/ 是本地拍摄商店素材用的工具链（含 node_modules、Chrome 临时配置），
# store-assets/ 是截图视频本身，两者都不属于扩展运行时，别加进来。
INCLUDE=(manifest.json LICENSE icons src)
EXCLUDE_DIRS='tools|store-assets'

rm -f "$OUT"
zip -r -q "$OUT" "${INCLUDE[@]}" -x '*.DS_Store'

# 最后一道闸：任何点开头的文件（.env*、.git 之类）都不该出现在包里
if unzip -Z1 "$OUT" | grep -E '(^|/)\.' ; then
  rm -f "$OUT"
  echo "中止：上面这些隐藏文件不应进包，已删除 $OUT" >&2
  exit 1
fi

# 第二道闸：开发用的目录万一被写进 INCLUDE，这里直接拦下来
if unzip -Z1 "$OUT" | grep -E "^(${EXCLUDE_DIRS})/" ; then
  rm -f "$OUT"
  echo "中止：上面这些目录不属于扩展运行时，已删除 $OUT" >&2
  exit 1
fi

echo "已打包: $(cd .. && pwd)/$(basename "$OUT")"
unzip -l "$OUT" | tail -1
echo
echo "根目录内容（manifest.json 必须在其中）："
unzip -l "$OUT" | awk 'NR>3 && $4 !~ /\// {print "  " $4}' | grep -v '^  $' || true
