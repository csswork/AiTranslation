#!/usr/bin/env bash
# 在 VPS 上以 huaci 用户运行，由 GitHub Actions 调用：
#
#   bash /srv/huaci/releases/<sha>/deploy/release.sh
#
# 版本已解压到 releases/<sha>：安装依赖、执行数据库迁移、切换 current、重启并检查健康。
# 迁移后不自动回滚代码（旧代码可能不兼容新表结构），失败时打印日志并以非零状态退出。
set -euo pipefail

RELEASE=$(cd "$(dirname "$0")/.." && pwd)
ROOT=/srv/huaci
ENV_FILE=/etc/huaci/backend.env
cd "$RELEASE"

grep -q '^DATABASE_URL=..*' "$ENV_FILE" || { echo "$ENV_FILE 未填写 DATABASE_URL" >&2; exit 1; }

npm ci --omit=dev --no-audit --no-fund
# Node 只在启动时读取 NODE_EXTRA_CA_CERTS，--env-file 设置得太晚，需提前导出（RDS 证书校验要用）
NODE_EXTRA_CA_CERTS=$(sed -n 's/^NODE_EXTRA_CA_CERTS=//p' "$ENV_FILE")
export NODE_EXTRA_CA_CERTS
NODE_ENV=production node --env-file="$ENV_FILE" src/db/migrate.js

ln -sfn "$RELEASE" "$ROOT/current.next"
mv -Tf "$ROOT/current.next" "$ROOT/current"
sudo /usr/bin/systemctl restart huaci-backend

for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null http://127.0.0.1:8787/healthz; then
    echo "已上线：$(basename "$RELEASE")"
    # 保留最近 5 个版本
    ls -1dt "$ROOT"/releases/*/ | tail -n +6 | xargs -r rm -rf
    exit 0
  fi
  sleep 1
done

echo '健康检查失败，最近日志：' >&2
journalctl -u huaci-backend -n 50 --no-pager >&2 || true
exit 1
