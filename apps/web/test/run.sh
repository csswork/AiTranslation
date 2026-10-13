#!/usr/bin/env bash
# 网站测试独立运行，不需要扩展、后端或外部 API。
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
for f in test/*.mjs; do
  name=$(basename "$f" .mjs)
  printf '  %-10s ' "$name"
  if out=$(node "$f" 2>&1); then
    echo "$out" | tail -1
  else
    echo '失败'
    echo "$out" | tail -12 | sed 's/^/      /'
    fail=1
  fi
done
node i18n/build.mjs --coverage || fail=1
for js in public/*.js i18n/*.js i18n/*.mjs; do
  node --check "$js" || fail=1
done
exit "$fail"
