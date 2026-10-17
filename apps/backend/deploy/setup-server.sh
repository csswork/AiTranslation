#!/usr/bin/env bash
# 一次性初始化 VPS（Debian 13），可重复执行。用 root 运行：
#
#   sudo bash setup-server.sh "<GitHub Actions 部署公钥>"
#
# 安装 Node.js 22（NodeSource）与 Caddy（官方源），创建运行与部署用户 huaci、
# 目录 /srv/huaci、配置模板 /etc/huaci/backend.env、systemd 服务和 Caddy 配置。
# 不会覆盖已有的 /etc/huaci/backend.env。
set -euo pipefail

DEPLOY_PUBKEY=${1:?用法：sudo bash setup-server.sh "<部署公钥>"}
HERE=$(cd "$(dirname "$0")" && pwd)
[ "$(id -u)" = 0 ] || { echo '需要 root 运行' >&2; exit 1; }

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
apt-get update -q
apt-get install -y -q nodejs caddy

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

# 生产配置：root 所有、huaci 可读（迁移脚本需要读取 DATABASE_URL）
install -d -m 750 -o root -g huaci /etc/huaci
if [ ! -f /etc/huaci/backend.env ]; then
  install -m 640 -o root -g huaci "$HERE/backend.env.example" /etc/huaci/backend.env
  sed -i "s/^AUTH_SECRET=.*/AUTH_SECRET=$(openssl rand -hex 32)/" /etc/huaci/backend.env
fi
# Amazon RDS 的 CA，连接串使用 sslmode=verify-full 时通过 NODE_EXTRA_CA_CERTS 引用
curl -fsSL -o /etc/ssl/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
chmod 644 /etc/ssl/rds-global-bundle.pem

install -m 644 "$HERE/huaci-backend.service" /etc/systemd/system/huaci-backend.service
systemctl daemon-reload
systemctl enable huaci-backend >/dev/null

install -m 644 "$HERE/Caddyfile" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable --now caddy >/dev/null
systemctl reload caddy

echo "完成：node $(node -v)，$(caddy version | cut -d' ' -f1)。下一步编辑 /etc/huaci/backend.env，再由 GitHub Actions 发布。"
