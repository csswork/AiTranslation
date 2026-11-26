#!/usr/bin/env bash
# 恢复数据库（本机 PostgreSQL），以 root 运行；setup-server.sh 安装为 /usr/local/sbin/huaci-restore。
#
#   huaci-restore [--identity <age 私钥>] [--target <库名>] [--force] <来源>
#   huaci-restore --list [前缀]          列出 R2 上的备份，如 --list db/15m/2026-11-26/
#
# 来源：
#   r2:latest | r2:latest-daily  R2 最新的 15 分钟备份 / 最新的每日备份
#   r2:<对象路径>                 如 r2:db/daily/huaci-2026-11-26.dump.age
#   <本地文件>                    .dump（pg_dump custom 格式）或 .dump.age
#
# --target   默认 huaci_restore（临时库，不影响线上）。恢复到线上库 huaci 必须加 --force：
#            停止后端与备份定时器 → 删库重建 → 恢复 → 重新启动并检查 /healthz。
# --identity 解密用的 age 私钥；默认用服务器上的演练钥匙 /etc/huaci/backup-drill.key。
#            整机重建时它还不在，传入运维者离线保管的私钥文件（用完删除）。
#
# 恢复时去掉原库的属主与授权（--no-owner --no-privileges），对象都归 huaci 角色，
# 因此 Amazon RDS 的导出也能直接恢复。完成后打印 db-summary.sql 的摘要用于核对。
set -euo pipefail

BACKUP_ENV=/etc/huaci/backup.env
SUMMARY_SQL=/usr/local/share/huaci/db-summary.sql
identity=/etc/huaci/backup-drill.key
target=huaci_restore
force=0
source=
list=

while [ $# -gt 0 ]; do
  case "$1" in
    --identity) identity=${2:?}; shift 2 ;;
    --target) target=${2:?}; shift 2 ;;
    --force) force=1; shift ;;
    --list) list=1; prefix=${2:-db/}; break ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    -*) echo "未知参数：$1" >&2; exit 1 ;;
    *) source=$1; shift ;;
  esac
done
[ "$(id -u)" = 0 ] || { echo '需要 root 运行' >&2; exit 1; }
[ -n "$source" ] || [ -n "$list" ] || { echo '缺少来源，见 --help' >&2; exit 1; }
[[ "$target" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "库名无效：$target" >&2; exit 1; }
if [ "$target" = huaci ] && [ "$force" != 1 ]; then
  echo '恢复到线上库 huaci 会覆盖现有数据，确认后加 --force' >&2; exit 1
fi

if [ -f "$BACKUP_ENV" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) ;; *=*) export "${line%%=*}=${line#*=}" ;; esac
  done < "$BACKUP_ENV"
fi

remote() { echo "r2:${R2_BUCKET:?backup.env 未填写 R2_BUCKET}"; }

if [ -n "$list" ]; then
  # 打印完整对象路径，可直接作为 r2:<路径> 来源
  rclone lsf -R --files-only "$(remote)/$prefix" | sort | sed "s#^#${prefix%/}/#"
  exit 0
fi

work=$(mktemp -d /var/tmp/huaci-restore.XXXXXX)
trap 'rm -rf "$work"' EXIT

case "$source" in
  r2:latest|r2:latest-daily)
    remote=$(remote)
    dir=$([ "$source" = r2:latest ] && echo db/15m || echo db/daily)
    latest=$(rclone lsf -R --files-only "$remote/$dir/" | grep '\.dump\.age$' | sort | tail -n 1)
    [ -n "$latest" ] || { echo "$remote/$dir/ 里没有备份" >&2; exit 1; }
    echo "来源：$remote/$dir/$latest"
    rclone copyto "$remote/$dir/$latest" "$work/backup.dump.age"
    file="$work/backup.dump.age" ;;
  r2:*)
    remote=$(remote)
    rclone copyto "$remote/${source#*:}" "$work/backup.dump.age"
    file="$work/backup.dump.age" ;;
  *)
    [ -f "$source" ] || { echo "找不到文件：$source" >&2; exit 1; }
    file=$source ;;
esac

if [[ "$file" == *.age ]]; then
  [ -f "$identity" ] || { echo "找不到解密私钥：$identity" >&2; exit 1; }
  age -d -i "$identity" -o "$work/backup.dump" "$file"
  file="$work/backup.dump"
fi
pg_restore --list "$file" >/dev/null

paused=()
if [ "$target" = huaci ]; then
  for unit in huaci-backup.timer huaci-backend.service; do
    if systemctl is-active --quiet "$unit"; then systemctl stop "$unit"; paused+=("$unit"); fi
  done
fi

runuser -u postgres -- dropdb --if-exists --force "$target"
runuser -u postgres -- createdb -O huaci "$target"
# 由 root 打开文件再交给 huaci 的 pg_restore，huaci 不需要能读备份所在目录
runuser -u huaci -- pg_restore --no-owner --no-privileges --exit-on-error --dbname="$target" < "$file"
# 由 postgres 执行：huaci 对系统表没有 ANALYZE 权限，会刷一屏警告
runuser -u postgres -- psql -Xq -d "$target" -c 'ANALYZE'

echo "已恢复到库 $target，摘要："
runuser -u huaci -- psql -XAt -F= -d "$target" < "$SUMMARY_SQL"

if [ "${#paused[@]}" -gt 0 ]; then
  systemctl start "${paused[@]}"
  if [[ " ${paused[*]} " == *" huaci-backend.service "* ]]; then
    for _ in $(seq 1 30); do
      curl -fsS -o /dev/null http://127.0.0.1:8787/healthz && { echo '后端已重新启动，/healthz 正常'; exit 0; }
      sleep 1
    done
    echo '后端重新启动后 /healthz 不通，查看 journalctl -u huaci-backend' >&2; exit 1
  fi
fi
