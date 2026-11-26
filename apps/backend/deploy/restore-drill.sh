#!/usr/bin/env bash
# 每周恢复演练，由 huaci-restore-drill.timer 以 root 运行（安装为 /usr/local/sbin/huaci-restore-drill）。
#
# 从 R2 取最新的 15 分钟备份与最新的每日备份，用服务器上的演练钥匙解密，
# 分别恢复到临时库，和线上库对比摘要后删除临时库。成功时请求 HC_DRILL_URL，失败时请求 <地址>/fail。
# 用法：huaci-restore-drill [来源…]，默认 r2:latest r2:latest-daily；可只演练某一份，如 huaci-restore-drill r2:latest。
# 检查：都能解密、完整恢复且有用户；最新一份的迁移版本与线上一致、用户数不多于线上；最新备份不超过 1 小时。
set -euo pipefail

BACKUP_ENV=/etc/huaci/backup.env
SUMMARY_SQL=/usr/local/share/huaci/db-summary.sql
[ "$(id -u)" = 0 ] || { echo '需要 root 运行' >&2; exit 1; }
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) ;; *=*) export "${line%%=*}=${line#*=}" ;; esac
done < "$BACKUP_ENV"

ping_hc() {
  [ -n "${HC_DRILL_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "${2:-}" "$HC_DRILL_URL$1" || true
}
report=
fail() { echo "$1" >&2; ping_hc /fail "$1"; exit 1; }
trap 'ping_hc /fail "huaci-restore-drill 在第 $LINENO 行失败"' ERR
trap 'runuser -u postgres -- dropdb --if-exists --force huaci_drill >/dev/null 2>&1 || true' EXIT

value() { sed -n "s/^$1=//p" <<<"$2"; }
live=$(runuser -u huaci -- psql -XAt -F= -d huaci < "$SUMMARY_SQL")

# R2 最新备份的时间（对象名 huaci-YYYYMMDDTHHMMSSZ.dump.age）
newest=$(rclone lsf -R --files-only "r2:$R2_BUCKET/db/15m/" | grep '\.dump\.age$' | sort | tail -n 1)
stamp=$(sed -E 's#.*huaci-([0-9]{8})T([0-9]{2})([0-9]{2})([0-9]{2})Z.*#\1 \2:\3:\4#' <<<"$newest")
age_min=$(( ($(date -u +%s) - $(date -u -d "$stamp" +%s)) / 60 ))
[ "$age_min" -le 60 ] || fail "R2 最新备份已过去 ${age_min} 分钟：$newest"

sources=("$@")
[ "${#sources[@]}" -gt 0 ] || sources=(r2:latest r2:latest-daily)
for source in "${sources[@]}"; do
  out=$(/usr/local/sbin/huaci-restore --target huaci_drill "$source" 2>&1)
  echo "$out"
  drill=$(sed -n '/^已恢复到库/,$p' <<<"$out" | tail -n +2)
  users=$(value users "$drill")
  [ "${users:-0}" -gt 0 ] 2>/dev/null || fail "$source 恢复后没有用户表或没有用户（空库备份？）"
  # 每日备份可能早于最近一次发布或删号，只对最新的 15 分钟备份做严格对比
  if [ "$source" = r2:latest ]; then
    [ "$(value last_migration "$drill")" = "$(value last_migration "$live")" ] \
      || fail "$source 迁移版本 $(value last_migration "$drill") 与线上 $(value last_migration "$live") 不一致"
    [ "$users" -le "$(value users "$live")" ] || fail "$source 用户数 $users 多于线上 $(value users "$live")"
  fi
  report="$report $source:users=$users"
  runuser -u postgres -- dropdb --force huaci_drill
done

echo "恢复演练通过：$report；R2 最新备份 ${age_min} 分钟前"
ping_hc '' "ok$report r2_age=${age_min}m"
