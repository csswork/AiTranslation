#!/usr/bin/env bash
# 入站防火墙（nftables），以 root 运行；setup-server.sh 安装为 /usr/local/sbin/huaci-firewall。
#
#   huaci-firewall apply     生成并加载规则，5 分钟后自动撤销（防止把 SSH 锁在外面）
#   huaci-firewall confirm   另开 SSH 确认能登录后运行：取消自动撤销，开机自动加载
#   huaci-firewall off       撤下规则并取消开机加载
#   huaci-firewall status    查看当前规则
#
# 放行：已建立的连接、本机、ICMP、当前 sshd 端口；TCP 80/443 只放行 Cloudflare 地址段
# （从 /etc/caddy/Caddyfile 的 trusted_proxies 读取，与 Caddy 用同一份）；
# /etc/huaci/firewall.env 里的 EXTRA_TCP / EXTRA_UDP（空格分隔的端口，给同机其他服务）。其余入站全部丢弃。
set -euo pipefail

TEMPLATE=/etc/huaci/firewall.nft
ACTIVE=/etc/huaci/firewall.active.nft
CONF=/etc/huaci/firewall.env
CADDYFILE=/etc/caddy/Caddyfile
[ "$(id -u)" = 0 ] || { echo '需要 root 运行' >&2; exit 1; }

render() {
  local ssh_port cidrs v4 v6 tcp='' udp=''
  ssh_port=$(sshd -T 2>/dev/null | awk '$1 == "port" { print $2; exit }')
  [[ "$ssh_port" =~ ^[0-9]+$ ]] || { echo '读不到 sshd 端口' >&2; exit 1; }
  cidrs=$(sed -n 's/^[[:space:]]*trusted_proxies static //p' "$CADDYFILE")
  v4=$(tr ' ' '\n' <<<"$cidrs" | grep -E '^[0-9.]+/[0-9]+$' | paste -sd, -)
  v6=$(tr ' ' '\n' <<<"$cidrs" | grep ':' | paste -sd, -)
  [ -n "$v4" ] && [ -n "$v6" ] || { echo "$CADDYFILE 里读不到 Cloudflare 地址段" >&2; exit 1; }
  local EXTRA_TCP='' EXTRA_UDP=''
  if [ -f "$CONF" ]; then
    EXTRA_TCP=$(sed -n 's/^EXTRA_TCP=//p' "$CONF"); EXTRA_UDP=$(sed -n 's/^EXTRA_UDP=//p' "$CONF")
  fi
  for p in $EXTRA_TCP $EXTRA_UDP; do [[ "$p" =~ ^[0-9]+$ ]] || { echo "端口无效：$p" >&2; exit 1; }; done
  [ -z "$EXTRA_TCP" ] || tcp="tcp dport { $(tr -s ' ' <<<"$EXTRA_TCP" | sed 's/^ //; s/ $//; s/ /, /g') } accept"
  [ -z "$EXTRA_UDP" ] || udp="udp dport { $(tr -s ' ' <<<"$EXTRA_UDP" | sed 's/^ //; s/ $//; s/ /, /g') } accept"
  sed -e "s#@SSH_PORT@#$ssh_port#" -e "s#@CF_V4@#$v4#" -e "s#@CF_V6@#$v6#" \
      -e "s#@EXTRA_TCP@#$tcp#" -e "s#@EXTRA_UDP@#$udp#" "$TEMPLATE" > "$ACTIVE.tmp"
  nft -c -f "$ACTIVE.tmp"
  mv "$ACTIVE.tmp" "$ACTIVE"
  echo "SSH 端口 $ssh_port；额外 TCP：${EXTRA_TCP:-无}；额外 UDP：${EXTRA_UDP:-无}"
}

case "${1:-}" in
  apply)
    render
    systemctl stop huaci-firewall-rollback.timer 2>/dev/null || true
    systemctl reset-failed huaci-firewall-rollback.timer huaci-firewall-rollback.service 2>/dev/null || true
    nft -f "$ACTIVE"
    systemd-run --quiet --unit=huaci-firewall-rollback --on-active=300 /usr/sbin/nft delete table inet huaci
    echo '规则已加载，5 分钟后自动撤销。另开一个 SSH 会话确认能登录，再运行：huaci-firewall confirm' ;;
  confirm)
    nft list table inet huaci >/dev/null 2>&1 || { echo '规则没有加载（可能已自动撤销），先运行 apply' >&2; exit 1; }
    systemctl stop huaci-firewall-rollback.timer 2>/dev/null || true
    systemctl enable huaci-firewall.service >/dev/null
    echo '已确认：取消自动撤销，开机自动加载' ;;
  off)
    systemctl stop huaci-firewall-rollback.timer 2>/dev/null || true
    systemctl disable huaci-firewall.service >/dev/null 2>&1 || true
    nft delete table inet huaci 2>/dev/null || true
    echo '已撤下规则' ;;
  status)
    nft list table inet huaci 2>/dev/null || echo '未加载' ;;
  *)
    sed -n '2,12p' "$0"; exit 1 ;;
esac
