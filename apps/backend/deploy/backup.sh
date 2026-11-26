#!/usr/bin/env bash
# 数据库与配置备份，由 huaci-backup.timer 每 15 分钟以 root 运行（setup-server.sh 安装为 /usr/local/sbin/huaci-backup）。
# 也可以手动运行：sudo huaci-backup
#
# 每次：pg_dump（custom 格式）→ 校验能被 pg_restore 读取 → age 加密 → 上传 R2 db/15m/。
# 每个 UTC 日的第一次：同一份再存为 db/daily/；同时（以及发布新版本后）把配置与当前代码打包存到 config/。
# 每个 UTC 月的第一次：再存为 db/monthly/。
# 脚本只上传、不删除；保留期限由 bucket 的锁定与生命周期规则决定（见 docs/backend/disaster-recovery.md）。
set -euo pipefail

ENV_FILE=/etc/huaci/backend.env
BACKUP_ENV=/etc/huaci/backup.env
DRILL_KEY=/etc/huaci/backup-drill.key

[ "$(id -u)" = 0 ] || { echo '需要 root 运行' >&2; exit 1; }
# 按 KEY=value 文本读取，不执行文件内容；rclone 直接读取导出的 RCLONE_CONFIG_* 变量
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) ;; *=*) export "${line%%=*}=${line#*=}" ;; esac
done < "$BACKUP_ENV"

ping_hc() { # $1 = '' | /fail
  [ -n "${HC_BACKUP_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "${2:-}" "$HC_BACKUP_URL$1" || true
}
trap 'ping_hc /fail "huaci-backup 在第 $LINENO 行失败"' ERR

: "${AGE_RECIPIENTS:?backup.env 未填写 AGE_RECIPIENTS（运维者离线保管的 age 公钥）}"
: "${R2_BUCKET:?backup.env 未填写 R2_BUCKET}"
recipients=()
for r in $AGE_RECIPIENTS; do recipients+=(-r "$r"); done
[ -f "$DRILL_KEY" ] && recipients+=(-r "$(age-keygen -y "$DRILL_KEY")")

DATABASE_URL=$(sed -n 's/^DATABASE_URL=//p' "$ENV_FILE")
CA=$(sed -n 's/^NODE_EXTRA_CA_CERTS=//p' "$ENV_FILE")
[ -n "$DATABASE_URL" ] || { echo "$ENV_FILE 未填写 DATABASE_URL" >&2; exit 1; }

work=$(mktemp -d /var/tmp/huaci-backup.XXXXXX)
trap 'rm -rf "$work"' EXIT
chmod 711 "$work"

now=$(date -u +%Y%m%dT%H%M%SZ)
day=$(date -u +%F)
month=$(date -u +%Y-%m)
dump="$work/huaci-$now.dump"

# 以 huaci 身份导出：本机库走 peer 认证；RDS 时连接串里带密码与 CA
touch "$dump"; chown huaci "$dump"
runuser -u huaci -- env ${CA:+PGSSLROOTCERT="$CA"} pg_dump --format=custom --compress=9 --file="$dump" --dbname="$DATABASE_URL"
pg_restore --list "$dump" >/dev/null
age "${recipients[@]}" -o "$dump.age" "$dump"
rm -f "$dump"

r2="r2:$R2_BUCKET"
exists() { # $1 = 远端目录, $2 = 文件名
  rclone lsf --files-only --include "$2" "$1" 2>/dev/null | grep -qxF "$2"
}

rclone copyto "$dump.age" "$r2/db/15m/$day/huaci-$now.dump.age"
uploaded="15m"

if ! exists "$r2/db/daily/" "huaci-$day.dump.age"; then
  rclone copyto "$dump.age" "$r2/db/daily/huaci-$day.dump.age"
  uploaded="$uploaded daily"
  config_due=1
fi

# 配置、部署公钥与当前代码（不含依赖），整机重建时与数据库一起恢复。
# 每天一份；发布了新版本时也立即补一份，避免重建时代码比数据库的迁移版本旧。
release=$(readlink -f /srv/huaci/current 2>/dev/null || true)
state=/var/lib/huaci-backup/config-release
mkdir -p "$(dirname "$state")"
[ "$(cat "$state" 2>/dev/null)" = "$release" ] || config_due=1
if [ "${config_due:-0}" = 1 ]; then
  paths=(etc/huaci etc/caddy)
  [ -f /home/huaci/.ssh/authorized_keys ] && paths+=(home/huaci/.ssh/authorized_keys)
  [ -n "$release" ] && [ -d "$release" ] && paths+=("${release#/}")
  tar -C / --exclude=node_modules -czf "$work/config.tar.gz" "${paths[@]}"
  age "${recipients[@]}" -o "$work/config.tar.gz.age" "$work/config.tar.gz"
  rclone copyto "$work/config.tar.gz.age" "$r2/config/huaci-config-$now.tar.gz.age"
  echo "$release" > "$state"
  uploaded="$uploaded config"
fi

if ! exists "$r2/db/monthly/" "huaci-$month.dump.age"; then
  rclone copyto "$dump.age" "$r2/db/monthly/huaci-$month.dump.age"
  uploaded="$uploaded monthly"
fi

size=$(stat -c %s "$dump.age")
echo "已备份 huaci-$now（${size} 字节）：$uploaded"
ping_hc '' "huaci-$now ${size}B $uploaded"
