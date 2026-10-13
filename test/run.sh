#!/usr/bin/env bash
# 根目录入口：按应用运行测试；其中一组失败时继续报告另一组。
set -uo pipefail
REPOSITORY_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0
echo 'Chrome extension'
bash "$REPOSITORY_ROOT/apps/extension/test/run.sh" || fail=1
echo 'Vercel website'
bash "$REPOSITORY_ROOT/apps/web/test/run.sh" || fail=1
exit "$fail"
