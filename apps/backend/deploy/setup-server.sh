#!/usr/bin/env bash
# 一次性初始化 VPS（Debian 13），可重复执行。用 root 运行：
#
#   sudo bash setup-server.sh "<GitHub Actions 部署公钥>"
#
# 安装 Node.js 22（NodeSource）、Caddy（官方源）、PostgreSQL 18（PGDG）与备份工具（age、rclone），
# 创建运行与部署用户 huaci、本机数据库 huaci（Unix socket + peer 认证，没有密码）、目录 /srv/huaci、
# 配置模板 /etc/huaci/backend.env 与 /etc/huaci/backup.env、systemd 服务与定时器、Caddy 配置，
# 没有 swap 时创建 2G swap。不会覆盖已有的 /etc/huaci/*.env。
#
# 防火墙不在这里启用（规则写错会把 SSH 锁在外面）：装好后另外运行 firewall.sh apply / confirm。
#
# 可选环境变量：
#   DB=external   数据库在别处（如 Amazon RDS）：不装 PostgreSQL 服务端，只装 18 版客户端并下载 RDS CA。
#   SWAP_MB=0     不创建 swap；默认 2048。
set -euo pipefail

DEPLOY_PUBKEY=${1:?用法：sudo bash setup-server.sh "<部署公钥>"}
DB_MODE=${DB:-local}
SWAP_MB=${SWAP_MB:-2048}
HERE=$(cd "$(dirname "$0")" && pwd)
[ "$(id -u)" = 0 ] || { echo '需要 root 运行' >&2; exit 1; }
case "$DB_MODE" in local|external) ;; *) echo "DB 只能是 local 或 external：$DB_MODE" >&2; exit 1 ;; esac

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg debian-keyring debian-archive-keyring apt-transport-https

# Node.js 22
if ! node -v 2>/dev/null | grep -q '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/nodesource.gpg
  echo 'deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main' > /etc/apt/sources.list.d/nodesource.list
fi
# Caddy（Debian 自带的版本过旧，不支持 client_ip_headers）
if [ ! -f /etc/apt/sources.list.d/caddy-stable.list ]; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
fi
# PostgreSQL 18（Debian 13 自带 17；pg_dump 不能导出比自己新的服务端，也要与 RDS 的 18 对齐）
if [ ! -f /etc/apt/sources.list.d/pgdg.list ]; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  . /etc/os-release
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list
fi
apt-get update -q
packages=(nodejs caddy postgresql-client-18 age rclone nftables)
[ "$DB_MODE" = local ] && packages+=(postgresql-18)
apt-get install -y -q "${packages[@]}"

# swap：内存只有 4G，还与其他服务共用，避免内存尖峰时进程被直接杀掉
if [ "$SWAP_MB" != 0 ] && [ -z "$(swapon --show --noheadings)" ]; then
  [ -f /swapfile ] || { fallocate -l "${SWAP_MB}M" /swapfile; chmod 600 /swapfile; mkswap /swapfile >/dev/null; }
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/60-huaci-swap.conf
  sysctl -q -p /etc/sysctl.d/60-huaci-swap.conf
fi

# 运行与部署共用 huaci 用户：GitHub Actions 以它登录，只能重启本服务
id huaci >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/huaci --shell /bin/bash huaci
usermod -aG systemd-journal huaci
install -d -m 700 -o huaci -g huaci /home/huaci/.ssh
touch /home/huaci/.ssh/authorized_keys
grep -qxF "$DEPLOY_PUBKEY" /home/huaci/.ssh/authorized_keys || echo "$DEPLOY_PUBKEY" >> /home/huaci/.ssh/authorized_keys
chown huaci:huaci /home/huaci/.ssh/authorized_keys
chmod 600 /home/huaci/.ssh/authorized_keys
echo 'huaci ALL=(root) NOPASSWD: /usr/bin/systemctl restart huaci-backend' > /etc/sudoers.d/huaci-deploy
chmod 440 /etc/sudoers.d/huaci-deploy
visudo -cf /etc/sudoers.d/huaci-deploy >/dev/null

install -d -m 755 -o huaci -g huaci /srv/huaci /srv/huaci/releases
# release.sh 迁移前的本机备份
install -d -m 700 -o huaci -g huaci /srv/huaci/backups

# 本机数据库：角色与库都叫 huaci，同名系统用户经 Unix socket peer 认证，不设密码、不监听公网
if [ "$DB_MODE" = local ]; then
  install -m 644 "$HERE/postgresql.conf" /etc/postgresql/18/main/conf.d/huaci.conf
  systemctl enable postgresql >/dev/null
  systemctl restart postgresql
  runuser -u postgres -- psql -Xqtc "SELECT 1 FROM pg_roles WHERE rolname = 'huaci'" | grep -q 1 \
    || runuser -u postgres -- createuser huaci
  runuser -u postgres -- psql -Xqtc "SELECT 1 FROM pg_database WHERE datname = 'huaci'" | grep -q 1 \
    || runuser -u postgres -- createdb -O huaci huaci
fi

# 生产配置：root 所有、huaci 可读（迁移脚本需要读取 DATABASE_URL）
install -d -m 750 -o root -g huaci /etc/huaci
if [ ! -f /etc/huaci/backend.env ]; then
  install -m 640 -o root -g huaci "$HERE/backend.env.example" /etc/huaci/backend.env
  sed -i "s/^AUTH_SECRET=.*/AUTH_SECRET=$(openssl rand -hex 32)/" /etc/huaci/backend.env
  if [ "$DB_MODE" = local ]; then
    sed -i 's#^DATABASE_URL=.*#DATABASE_URL=postgres://huaci@/huaci?host=/var/run/postgresql#' /etc/huaci/backend.env
    sed -i 's#^NODE_EXTRA_CA_CERTS=.*#NODE_EXTRA_CA_CERTS=#' /etc/huaci/backend.env
  fi
fi
# 备份配置只给 root：里面有对象存储密钥
[ -f /etc/huaci/backup.env ] || install -m 600 -o root -g root "$HERE/backup.env.example" /etc/huaci/backup.env
[ -f /etc/huaci/firewall.env ] || install -m 644 -o root -g root "$HERE/firewall.env.example" /etc/huaci/firewall.env
# 自动恢复演练用的服务器端解密钥匙（只解密，不上传）；离线钥匙由运维者保管，见 docs/backend/disaster-recovery.md
if [ ! -f /etc/huaci/backup-drill.key ]; then
  (umask 077; age-keygen -o /etc/huaci/backup-drill.key 2>/dev/null)
fi
# Amazon RDS 的 CA，连接串使用 sslmode=verify-full 时通过 NODE_EXTRA_CA_CERTS 引用
if [ "$DB_MODE" = external ]; then
  curl -fsSL -o /etc/ssl/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
  chmod 644 /etc/ssl/rds-global-bundle.pem
fi

# 运维脚本装到固定位置，不依赖某个发布目录还在
for script in backup.sh restore.sh restore-drill.sh firewall.sh; do
  install -m 755 "$HERE/$script" "/usr/local/sbin/huaci-${script%.sh}"
done
install -m 644 "$HERE/firewall.nft" /etc/huaci/firewall.nft
install -d -m 755 /usr/local/share/huaci
install -m 644 "$HERE/db-summary.sql" /usr/local/share/huaci/db-summary.sql

for unit in huaci-backend.service huaci-backup.service huaci-backup.timer huaci-restore-drill.service huaci-restore-drill.timer huaci-firewall.service; do
  install -m 644 "$HERE/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable huaci-backend >/dev/null

install -d -m 755 /etc/caddy/tls.d
install -m 644 "$HERE/Caddyfile" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable --now caddy >/dev/null
systemctl reload caddy

cat <<EOF
完成：node $(node -v)，$(caddy version | cut -d' ' -f1)，$(pg_dump --version)。
下一步：
  1. 编辑 /etc/huaci/backend.env（模板见 backend.env.example），由 GitHub Actions 发布。
  2. 编辑 /etc/huaci/backup.env，运行 huaci-backup 一次，确认后：
       systemctl enable --now huaci-backup.timer huaci-restore-drill.timer
  3. 在 /etc/huaci/firewall.env 写同机其他服务要开放的端口，运行 huaci-firewall apply，
     另开一个 SSH 确认还能登录，再 huaci-firewall confirm。
EOF
