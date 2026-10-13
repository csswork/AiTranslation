#!/usr/bin/env bash
# 跑全部测试。纯 node，无依赖。
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
for f in test/*.mjs; do
  name=$(basename "$f" .mjs)
  printf '  %-10s ' "$name"
  if out=$(node "$f" 2>&1); then
    echo "$out" | tail -1
  else
    echo "失败"
    echo "$out" | tail -12 | sed 's/^/      /'
    fail=1
  fi
done

echo
echo -n '  语法检查   '
for js in $(find src -name '*.js'); do
  node --check "$js" || fail=1
done
[ $fail -eq 0 ] && echo '全部通过' || echo '有失败项'
exit $fail
