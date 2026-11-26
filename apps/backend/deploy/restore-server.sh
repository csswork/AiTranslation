#!/usr/bin/env bash
# 整机重建：在一台全新的 Debian 13 上，从 R2 的备份恢复配置、代码与数据库。以 root 运行：
#
#   sudo bash restore-server.sh --identity <age 私钥> --backup-env <backup.env>
#
# 准备：把仓库的 apps/backend/deploy/ 整个目录拷到新机；运维者离线保管的 age 私钥与 backup.env
# （对象存储密钥，从密码管理器取出）各写成一个 600 文件，用完删除。
#
# 步骤：装 age、rclone → 取最新的配置包并解密 → 用包里的部署公钥运行 setup-server.sh →
# 覆盖 /etc/huaci、/etc/caddy 与部署公钥 → 恢复包里的代码版本并安装依赖 →
# 恢复最新数据库并启动后端 → 启用备份与演练定时器。
# 之后仍需手动：huaci-firewall apply / confirm；Cloudflare 把 app、admin 的 A 记录改到本机；
# GitHub 的 DEPLOY_HOST、DEPLOY_PORT、DEPLOY_KNOWN_HOSTS 改成本机。详见 docs/backend/disaster-recovery.md。
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
identity= backup_env=
while [ $# -gt 0 ]; do
  case "$1" in
    --identity) identity=${2:?}; shift 2 ;;
    --backup-env) backup_env=${2:?}; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 1 ;;
  esac
done
[ "$(id -u)" = 0 ] || { echo '需要 root 运行' >&2; exit 1; }
[ -f "$identity" ] || { echo '缺少 --identity <age 私钥文件>' >&2; exit 1; }
[ -f "$backup_env" ] || { echo '缺少 --backup-env <backup.env 文件>' >&2; exit 1; }

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) ;; *=*) export "${line%%=*}=${line#*=}" ;; esac
done < "$backup_env"
remote="r2:${R2_BUCKET:?backup.env 未填写 R2_BUCKET}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q age rclone ca-certificates

work=$(mktemp -d /var/tmp/huaci-rebuild.XXXXXX)
trap 'rm -rf "$work"' EXIT

latest=$(rclone lsf --files-only "$remote/config/" | grep '\.tar\.gz\.age$' | sort | tail -n 1)
[ -n "$latest" ] || { echo "$remote/config/ 里没有配置包" >&2; exit 1; }
echo "配置包：$remote/config/$latest"
rclone copyto "$remote/config/$latest" "$work/config.tar.gz.age"
age -d -i "$identity" -o "$work/config.tar.gz" "$work/config.tar.gz.age"
mkdir "$work/root"
tar -C "$work/root" -xzf "$work/config.tar.gz"

pubkey=$(grep -m1 . "$work/root/home/huaci/.ssh/authorized_keys" 2>/dev/null || true)
[ -n "$pubkey" ] || { echo '配置包里没有部署公钥' >&2; exit 1; }
bash "$HERE/setup-server.sh" "$pubkey"

# 覆盖 setup 生成的模板：保留原来的 AUTH_SECRET、各项密钥、演练钥匙与 Caddy 证书
cp -a "$work/root/etc/huaci/." /etc/huaci/
cp -a "$work/root/etc/caddy/." /etc/caddy/
install -m 600 -o root -g root "$backup_env" /etc/huaci/backup.env
chown root:huaci /etc/huaci /etc/huaci/backend.env
chmod 750 /etc/huaci; chmod 640 /etc/huaci/backend.env
install -m 600 -o huaci -g huaci "$work/root/home/huaci/.ssh/authorized_keys" /home/huaci/.ssh/authorized_keys
systemctl reload caddy

release_dir=$(find "$work/root/srv/huaci/releases" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sed -n 1p)
if [ -n "$release_dir" ]; then
  sha=$(basename "$release_dir")
  rm -rf "/srv/huaci/releases/$sha"
  cp -a "$release_dir" /srv/huaci/releases/
  chown -R huaci:huaci "/srv/huaci/releases/$sha"
  (cd "/srv/huaci/releases/$sha" && runuser -u huaci -- npm ci --omit=dev --no-audit --no-fund)
  ln -sfn "/srv/huaci/releases/$sha" /srv/huaci/current
  echo "代码版本：$sha"
else
  echo '配置包里没有代码，恢复数据库后由 GitHub Actions 发布一次再启动' >&2
fi

/usr/local/sbin/huaci-restore --target huaci --force --identity "$identity" r2:latest
if [ -n "$release_dir" ]; then
  systemctl start huaci-backend
  for _ in $(seq 1 30); do curl -fsS -o /dev/null http://127.0.0.1:8787/healthz && break; sleep 1; done
  curl -fsS -o /dev/null http://127.0.0.1:8787/healthz && echo '后端已启动，/healthz 正常' \
    || echo '后端 /healthz 不通：数据库可能比配置包里的代码新，由 GitHub Actions 发布最新版本' >&2
fi
systemctl enable --now huaci-backup.timer huaci-restore-drill.timer

cat <<'DONE'
重建完成。还需要手动：
  1. huaci-firewall apply，另开 SSH 确认能登录后 huaci-firewall confirm
  2. Cloudflare：app、admin 的 A 记录改到本机 IP
  3. GitHub Secrets：DEPLOY_HOST、DEPLOY_PORT、DEPLOY_KNOWN_HOSTS 改成本机
  4. 删除本机上的 age 私钥与 backup.env 临时文件
DONE
