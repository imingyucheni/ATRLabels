#!/usr/bin/env bash
# ============================================================
# ATR 面单系统 · 一键安装（Ubuntu 22.04 / 24.04，全新服务器）
#
# 用法（在服务器上以 root 执行）：
#   curl -fsSL <本脚本地址> -o install.sh   # 或把仓库里的 scripts/install.sh 上传到服务器
#   bash install.sh
#
# 脚本会：安装 Node.js 22、Caddy（自动 HTTPS）→ 下载代码 → 构建 → 生成配置和管理员密码
#        → 注册为系统服务（开机自启、崩溃自动重启）→ 每天自动备份数据。
# 重复执行会更新代码并重启，不会覆盖已有的配置和数据。
# ============================================================
set -euo pipefail

APP_DIR=/opt/atrlabels
DATA_DIR=/var/lib/atrlabels
REPO_DEFAULT="https://github.com/imingyucheni/ATRLabels.git"
BRANCH_DEFAULT="claude/lucid-einstein-4qqbsm"

say() { printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }
ask() { local q="$1" def="${2:-}" v; read -r -p "$q${def:+ [$def]}: " v; echo "${v:-$def}"; }

[ "$(id -u)" = 0 ] || { echo "请用 root 执行（sudo -i 后再运行）"; exit 1; }

say "基本信息"
DOMAIN=$(ask "系统要使用的域名（先把域名 A 记录解析到这台服务器 IP；没有域名直接回车，用 http://IP:3000 访问）" "")
REPO=$(ask "代码仓库地址（私有仓库请用 https://<GitHub令牌>@github.com/... 的格式）" "$REPO_DEFAULT")
BRANCH=$(ask "代码分支" "$BRANCH_DEFAULT")

say "安装系统依赖"
apt-get update -y
apt-get install -y ca-certificates curl git build-essential python3 sqlite3 debian-keyring debian-archive-keyring apt-transport-https gnupg
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

# 小内存服务器构建时容易内存不足：内存小于 3G 且没有交换空间时，自动加 2G 交换空间
if [ "$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)" -lt 3000 ] && ! swapon --show | grep -q .; then
  say "添加 2G 交换空间"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "下载 / 更新代码"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH" && git -C "$APP_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
else
  git clone --branch "$BRANCH" --depth 20 "$REPO" "$APP_DIR"
fi
id atr >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin atr
mkdir -p "$DATA_DIR" "$DATA_DIR/backups"

say "生成配置"
ENV_FILE="$APP_DIR/.env.local"
if [ ! -f "$ENV_FILE" ]; then
  ADMIN_PW=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-14)
  SESSION=$(openssl rand -hex 32)
  API_ID=$(ask "ShipBest API ID（OMS 后台 → API配置；先不填则用模拟模式试用）" "")
  API_TOKEN=""
  [ -n "$API_ID" ] && API_TOKEN=$(ask "ShipBest API Token" "")
  MOCK=1; [ -n "$API_ID" ] && [ -n "$API_TOKEN" ] && MOCK=0
  cat > "$ENV_FILE" <<EOF
SHIPBEST_BASE_URL=https://oms.shipbest.com
SHIPBEST_API_ID=$API_ID
SHIPBEST_ACCESS_TOKEN=$API_TOKEN
SHIPBEST_MOCK=$MOCK
ADMIN_PASSWORD=$ADMIN_PW
SESSION_SECRET=$SESSION
DATA_DIR=$DATA_DIR
APP_URL=${DOMAIN:+https://$DOMAIN}
ALLOWED_ORIGINS=${DOMAIN}
# 客户忘记密码发邮件（可选）
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
EOF
  chmod 600 "$ENV_FILE"
  NEW_INSTALL=1
else
  ADMIN_PW="（沿用 $ENV_FILE 里的 ADMIN_PASSWORD）"
  NEW_INSTALL=0
fi

say "安装依赖并构建（需要几分钟）"
cd "$APP_DIR"
npm ci --no-audit --no-fund
set -a; . "$ENV_FILE"; set +a
npx next build
chown -R atr:atr "$APP_DIR" "$DATA_DIR"

say "注册系统服务"
cat > /etc/systemd/system/atrlabels.service <<EOF
[Unit]
Description=ATR Labels
After=network.target

[Service]
User=atr
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production
# 报表按美西日期统计，和页面显示的时间一致
Environment=TZ=America/Los_Angeles
Environment=PORT=3000
ExecStart=/usr/bin/npx next start -p 3000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now atrlabels
systemctl restart atrlabels

say "每天凌晨 3 点备份数据（保留 30 天）"
cat > /etc/cron.d/atrlabels-backup <<EOF
0 3 * * * root sqlite3 $DATA_DIR/atrlabels.db ".backup '$DATA_DIR/backups/atrlabels-\$(date +\%F).db'" && tar -czf $DATA_DIR/backups/files-\$(date +\%F).tgz -C $DATA_DIR labels topup samples assets 2>/dev/null; find $DATA_DIR/backups -mtime +30 -delete
EOF

if [ -n "$DOMAIN" ]; then
  say "配置 HTTPS（Caddy）"
  if ! command -v caddy >/dev/null; then
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy
  fi
  cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:3000
}
EOF
  systemctl reload caddy || systemctl restart caddy
  URL="https://$DOMAIN"
else
  URL="http://$(curl -fsS ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}'):3000"
  echo "提示：没有配置域名，请在云服务器安全组 / 防火墙放行 3000 端口。"
fi

sleep 3
systemctl --no-pager --lines=5 status atrlabels || true
cat <<EOF

==============================================================
  安装完成
  后台地址：   $URL
  客户端地址： $URL/portal
  管理员密码： $ADMIN_PW
  配置文件：   $ENV_FILE（修改后执行 systemctl restart atrlabels）
  数据目录：   $DATA_DIR（每天自动备份到 $DATA_DIR/backups）
  查看日志：   journalctl -u atrlabels -f
  更新系统：   再次运行 bash install.sh
==============================================================
EOF
[ "$NEW_INSTALL" = 1 ] && echo "请立即记下管理员密码。"
