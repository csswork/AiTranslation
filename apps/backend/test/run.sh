#!/usr/bin/env bash
# VPS 后端测试：需要已安装依赖（npm ci）和可连接的 PostgreSQL。
# 默认使用 postgres://localhost:5432/huaci_test，可用 TEST_DATABASE_URL 覆盖；测试会清空该库。
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -d node_modules ]; then
  echo '  缺少依赖：先在 apps/backend 运行 npm ci' >&2
  exit 1
fi
node --test --test-concurrency=1 test/*.test.mjs
