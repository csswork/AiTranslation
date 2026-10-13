#!/usr/bin/env bash
# 根目录入口：按应用运行测试；其中一组失败时继续运行其余各组。
set -uo pipefail
REPOSITORY_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0
echo 'Chrome extension'
bash "$REPOSITORY_ROOT/apps/extension/test/run.sh" || fail=1
echo 'Vercel website'
bash "$REPOSITORY_ROOT/apps/web/test/run.sh" || fail=1
echo 'VPS backend'
# 后端有自己的 npm 依赖和 PostgreSQL 测试库；未安装依赖时明确跳过，不影响另外两组。
if [ -d "$REPOSITORY_ROOT/apps/backend/node_modules" ]; then
  bash "$REPOSITORY_ROOT/apps/backend/test/run.sh" || fail=1
else
  echo '  跳过：未安装后端依赖（cd apps/backend && npm ci）'
fi
exit "$fail"
