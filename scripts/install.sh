#!/usr/bin/env bash
# ============================================================
# ATR 面单系统 · 一键安装 / 更新（Ubuntu 22.04 / 24.04）
#
# 首次安装（在服务器上以 root 执行）：
#   bash install.sh
# 以后更新：
#   atr-update                       更新正式站
#   atr-update sandbox               安装 / 更新沙盒站（测试用，端口 3001，数据和正式站分开）
#   atr-update sandbox --copy-data   沙盒站换成正式站数据的副本（沙盒站原来的数据会被覆盖）
#
# 脚本会：安装 Node.js → 下载代码 → 下载 GitHub 上已经构建好的发布包（小内存服务器不用自己构建）
#        → 生成配置和管理员密码 → 注册为系统服务（开机自启、崩溃自动重启）→ 每天自动备份数据
#        → 有域名时自动配置 HTTPS（Caddy）。
# 重复执行只会更新程序，不会覆盖已有的配置和数据。
# ============================================================
set -euo pipefail

# 参数：sandbox = 沙盒站；--reconfigure = 重新填写域名等；--copy-data = 沙盒站复制正式站数据
SITE=prod; RECONF=0; COPY_DATA=0
for a in "$@"; do
  case "$a" in
    sandbox|--sandbox) SITE=sandbox ;;
    --reconfigure) RECONF=1 ;;
    --copy-data) COPY_DATA=1 ;;
  esac
done
if [ "$SITE" = sandbox ]; then SFX="-sandbox"; PORT=3001; SERVICE=atrlabels-sandbox; SITE_NAME="沙盒站"
else SFX=""; PORT=3000; SERVICE=atrlabels; SITE_NAME="正式站"; fi

APP_DIR=/opt/atrlabels$SFX          # 代码（含配置文件 .env.local）
RUN_DIR=/opt/atrlabels$SFX-app      # 发布包：releases/<版本>，current 指向正在运行的版本
DATA_DIR=/var/lib/atrlabels$SFX     # 数据库、面单文件
CONF=/etc/atrlabels$SFX.conf        # 安装时填写的域名、仓库地址、分支
ENV_FILE="$APP_DIR/.env.local"
PROD_CONF=/etc/atrlabels.conf
PROD_ENV=/opt/atrlabels/.env.local
REPO_DEFAULT="https://github.com/imingyucheni/ATRLabels.git"
BRANCH_DEFAULT="claude/lucid-einstein-4qqbsm"

say() { printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m%s\033[0m\n" "$*"; }
ask() { local q="$1" def="${2:-}" v; read -r -p "$q${def:+ [$def]}: " v; echo "${v:-$def}"; }

[ "$(id -u)" = 0 ] || { echo "请用 root 执行（先输入 sudo -i）"; exit 1; }

# ---------- 基本信息（只在第一次问，之后保存在 /etc/atrlabels.conf） ----------
DOMAIN=""; OMS_DOMAIN=""
if [ -f "$CONF" ] && [ "$RECONF" = 0 ]; then
  # shellcheck disable=SC1090
  . "$CONF"
  echo "使用已保存的设置（$CONF）。要重新填写域名 / 仓库地址，请执行：atr-update ${SFX:+sandbox }--reconfigure"
else
  # shellcheck disable=SC1090
  [ -f "$CONF" ] && . "$CONF"
  # 沙盒站第一次安装：仓库地址和分支默认跟正式站一样
  if [ "$SITE" = sandbox ] && [ ! -f "$CONF" ] && [ -f "$PROD_CONF" ]; then
    # shellcheck disable=SC1090
    REPO=$(. "$PROD_CONF"; echo "$REPO"); BRANCH=$(. "$PROD_CONF"; echo "$BRANCH")
  fi
  say "基本信息（$SITE_NAME）"
  echo "域名要先在域名服务商添加 A 记录解析到这台服务器的 IP；还没有域名就直接回车，用 http://IP:$PORT 访问。"
  if [ "$SITE" = sandbox ]; then
    DOMAIN=$(ask "沙盒站域名（例如 sandbox.你的域名.com；没有就回车）" "${DOMAIN:-}")
    OMS_DOMAIN=""
  else
    DOMAIN=$(ask "管理后台域名（例如 admin.你的域名.com）" "${DOMAIN:-}")
    OMS_DOMAIN=$(ask "客户 OMS 域名（客户登录下单用，例如 oms.你的域名.com；没有就回车）" "${OMS_DOMAIN:-}")
  fi
  REPO=$(ask "代码仓库地址（私有仓库请用 https://<GitHub令牌>@github.com/... 的格式）" "${REPO:-$REPO_DEFAULT}")
  BRANCH=$(ask "代码分支" "${BRANCH:-$BRANCH_DEFAULT}")
  umask 077
  printf 'DOMAIN=%q\nOMS_DOMAIN=%q\nREPO=%q\nBRANCH=%q\n' "$DOMAIN" "$OMS_DOMAIN" "$REPO" "$BRANCH" > "$CONF"
  umask 022
fi

# ---------- 系统依赖（已装的跳过） ----------
need=()
for c in git curl python3 sqlite3; do command -v "$c" >/dev/null || need+=("$c"); done
if [ ${#need[@]} -gt 0 ]; then
  say "安装系统依赖"
  apt-get update -y
  apt-get install -y ca-certificates curl git python3 sqlite3 gnupg
fi
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  say "安装 Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# 小内存服务器：内存小于 3G 且没有交换空间时，加 2G 交换空间
if [ "$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)" -lt 3000 ] && ! swapon --show | grep -q .; then
  say "添加 2G 交换空间"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---------- 代码 ----------
say "下载 / 更新代码"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" remote set-url origin "$REPO"
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" --depth 20 "$REPO" "$APP_DIR"
fi
SHA=$(git -C "$APP_DIR" rev-parse HEAD)
echo "代码版本：${SHA:0:7}"
id atr >/dev/null 2>&1 || useradd --system --home "$RUN_DIR" --shell /usr/sbin/nologin atr
mkdir -p "$DATA_DIR/backups" "$RUN_DIR/releases"

# ---------- 配置（第一次生成，之后不覆盖） ----------
if [ ! -f "$ENV_FILE" ]; then
  say "生成配置"
  ADMIN_PW=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-14)
  SESSION=$(openssl rand -hex 32)
  API_ID=""; API_TOKEN=""
  if [ "$SITE" = prod ]; then
    API_ID=$(ask "ShipBest API ID（OMS 后台 → API配置；先不填则用模拟模式试用）" "")
    [ -n "$API_ID" ] && API_TOKEN=$(ask "ShipBest API Token" "")
  fi
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
fi

# 网址设置每次按 /etc/atrlabels.conf 更新（改域名后执行 bash install.sh --reconfigure 即可）
set_env() { # 设置 .env.local 里的某一项（没有就追加）
  if grep -q "^$1=" "$ENV_FILE"; then sed -i "s#^$1=.*#$1=$2#" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}
set_env ADMIN_URL "${DOMAIN:+https://$DOMAIN}"
set_env OMS_URL "${OMS_DOMAIN:+https://$OMS_DOMAIN}"
set_env APP_URL "${OMS_DOMAIN:+https://$OMS_DOMAIN}"
set_env ALLOWED_ORIGINS "$(printf '%s' "$DOMAIN,$OMS_DOMAIN" | sed 's/^,//; s/,$//')"

# 正式站 / 沙盒站互相知道对方的网址（后台侧边栏可以一键切换）
PUBLIC_IP=$(curl -fsS -m 5 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
site_url() { # site_url <配置文件> <端口>
  local d=""
  # shellcheck disable=SC1090
  [ -f "$1" ] && d=$(. "$1"; echo "${DOMAIN:-}")
  if [ -n "$d" ]; then echo "https://$d"; else echo "http://$PUBLIC_IP:$2"; fi
}
PROD_URL=$(site_url "$PROD_CONF" 3000)
SANDBOX_URL=""
if [ "$SITE" = sandbox ] || [ -f /etc/atrlabels-sandbox.conf ]; then SANDBOX_URL=$(site_url /etc/atrlabels-sandbox.conf 3001); fi
if [ "$SITE" = sandbox ]; then
  set_env APP_ENV sandbox
  set_env PRODUCTION_URL "$PROD_URL"
  # 正式站也记下沙盒站网址（重启正式站让它生效）
  if [ -f "$PROD_ENV" ]; then
    if grep -q "^SANDBOX_URL=" "$PROD_ENV"; then sed -i "s#^SANDBOX_URL=.*#SANDBOX_URL=$SANDBOX_URL#" "$PROD_ENV"; else echo "SANDBOX_URL=$SANDBOX_URL" >> "$PROD_ENV"; fi
    systemctl restart atrlabels 2>/dev/null || true
  fi
else
  set_env SANDBOX_URL "$SANDBOX_URL"
fi

# ---------- 程序：优先下载 GitHub 上构建好的发布包 ----------
TOKEN=$(printf '%s' "$REPO" | sed -n 's#^https://\([^@]*\)@github.com/.*#\1#p')
SLUG=$(printf '%s' "$REPO" | sed -E 's#^https://([^@]*@)?github.com/##; s#\.git$##')
TAG="build-${BRANCH//\//-}"
API="https://api.github.com/repos/$SLUG/releases/tags/$TAG"
auth=(); [ -n "$TOKEN" ] && auth=(-H "Authorization: Bearer $TOKEN")

RELEASE_JSON=""
load_release() { # 读取发布信息；失败时说明原因并退出
  local code
  RELEASE_JSON=$(mktemp)
  code=$(curl -sS -o "$RELEASE_JSON" -w '%{http_code}' "${auth[@]}" -H "Accept: application/vnd.github+json" "$API" || echo 000)
  case "$code" in
    200) return 0 ;;
    404) return 1 ;; # 还没构建出来（或令牌看不到这个仓库）
    401) warn "GitHub 令牌无效或已过期（401）。请重新生成令牌后执行：bash install.sh --reconfigure"; exit 1 ;;
    403) warn "GitHub 令牌权限不足（403）。令牌需要这个仓库的 Contents: Read-only 权限。改好后执行：bash install.sh --reconfigure"; exit 1 ;;
    *) warn "连接 GitHub 失败（HTTP $code），稍后重试…"; return 1 ;;
  esac
}
asset_url() { # 发布包里某个文件的下载地址
  python3 -c "import json,sys; a={x['name']:x['url'] for x in json.load(open(sys.argv[2])).get('assets',[])}; print(a.get(sys.argv[1],''))" "$1" "$RELEASE_JSON" 2>/dev/null || true
}
fetch_asset() { curl -fsSL "${auth[@]}" -H "Accept: application/octet-stream" -o "$2" "$1"; }

MODE=""
REL="$RUN_DIR/releases/$SHA"
if [ -f "$REL/server.js" ]; then
  MODE=prebuilt
else
  say "下载构建好的发布包"
  [ -z "$TOKEN" ] && warn "提示：仓库地址里没有 GitHub 令牌，私有仓库会下载失败。"
  for i in $(seq 1 40); do
    if load_release; then
      vurl=$(asset_url VERSION)
      ver=""
      [ -n "$vurl" ] && ver=$(curl -fsSL "${auth[@]}" -H 'Accept: application/octet-stream' "$vurl" 2>/dev/null | tr -d '[:space:]' || true)
      if [ "$ver" = "$SHA" ]; then
        purl=$(asset_url atrlabels.tgz)
        tmp=$(mktemp -d)
        echo "下载中（约 30MB）…"
        if [ -n "$purl" ] && fetch_asset "$purl" "$tmp/app.tgz"; then
          rm -rf "$REL.tmp" && mkdir -p "$REL.tmp" && tar -xzf "$tmp/app.tgz" -C "$REL.tmp" && rm -rf "$REL" && mv "$REL.tmp" "$REL"
          rm -rf "$tmp"
          MODE=prebuilt
          break
        fi
        rm -rf "$tmp"
        warn "下载失败，重试…"
      elif [ "$i" = 1 ]; then
        echo "发布包版本：${ver:0:7}（需要 ${SHA:0:7}）"
      fi
    elif [ "$i" = 1 ]; then
      echo "还没有找到发布包（404）。"
    fi
    [ "$i" = 1 ] && echo "GitHub 可能正在构建这个版本（一般 1–3 分钟），每 15 秒检查一次…"
    sleep 15
  done
fi

if [ "$MODE" != prebuilt ]; then
  if [ "$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)" -lt 3500 ]; then
    warn "没有下载到构建好的发布包。这台服务器内存较小，不适合在本机构建，已停止。请截图发给技术支持。"
    exit 1
  fi
  warn "没有下载到构建好的发布包，改为在本机构建（需要几分钟）。"
  cd "$APP_DIR"
  npm ci --no-audit --no-fund
  set -a; . "$ENV_FILE"; set +a
  NEXT_TELEMETRY_DISABLED=1 npx next build
  MODE=local
fi

# ---------- 沙盒站：复制正式站数据 ----------
if [ "$SITE" = sandbox ] && [ "$COPY_DATA" = 1 ]; then
  if [ -f /var/lib/atrlabels/atrlabels.db ]; then
    say "把正式站数据复制到沙盒站（沙盒站原来的数据会被覆盖）"
    systemctl stop "$SERVICE" 2>/dev/null || true
    rm -f "$DATA_DIR"/atrlabels.db "$DATA_DIR"/atrlabels.db-wal "$DATA_DIR"/atrlabels.db-shm
    sqlite3 /var/lib/atrlabels/atrlabels.db ".backup '$DATA_DIR/atrlabels.db'"
    for d in labels topup samples assets; do
      if [ -d "/var/lib/atrlabels/$d" ]; then rm -rf "${DATA_DIR:?}/$d"; cp -a "/var/lib/atrlabels/$d" "$DATA_DIR/$d"; fi
    done
    echo "已复制。沙盒站永远不会真实出单（设置里是“正式”也按沙盒处理）。"
  else
    warn "没有找到正式站数据，跳过复制。"
  fi
fi

# ---------- 系统服务 ----------
say "注册系统服务"
if [ "$MODE" = prebuilt ]; then
  ln -sfn "$REL" "$RUN_DIR/current"
  # 只保留最近 3 个版本
  { ls -1dt "$RUN_DIR"/releases/*/ 2>/dev/null | grep -v "/$SHA/\?$" | tail -n +3 | xargs -r rm -rf; } || true
  WORKDIR="$RUN_DIR/current"
  EXEC="/usr/bin/node $RUN_DIR/current/server.js"
else
  WORKDIR="$APP_DIR"
  EXEC="/usr/bin/npx next start -p $PORT"
fi
chown -R atr:atr "$RUN_DIR" "$DATA_DIR"
[ "$MODE" = local ] && chown -R atr:atr "$APP_DIR"
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=ATR Labels ($SITE_NAME)
After=network.target

[Service]
User=atr
WorkingDirectory=$WORKDIR
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOSTNAME=0.0.0.0
Environment=NEXT_TELEMETRY_DISABLED=1
# 报表按美西日期统计，和页面显示的时间一致
Environment=TZ=America/Los_Angeles
ExecStart=$EXEC
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"

# 更新命令：atr-update
cat > /usr/local/bin/atr-update <<'EOF'
#!/usr/bin/env bash
# 更新 ATR 面单系统到最新版本（不会动配置和数据）
#   atr-update            更新正式站
#   atr-update sandbox    安装 / 更新沙盒站（加 --copy-data 用正式站数据的副本）
set -euo pipefail
[ "$(id -u)" = 0 ] || exec sudo "$0" "$@"
SFX=""; for a in "$@"; do case "$a" in sandbox|--sandbox) SFX="-sandbox" ;; esac; done
CONF=/etc/atrlabels$SFX.conf; [ -f "$CONF" ] || CONF=/etc/atrlabels.conf
. "$CONF"
# 先把安装脚本更新到这个分支的最新版本
DIR=/opt/atrlabels$SFX; [ -d "$DIR/.git" ] || DIR=/opt/atrlabels
git config --global --add safe.directory "$DIR" 2>/dev/null || true
git -C "$DIR" fetch -q origin "$BRANCH"
git -C "$DIR" reset -q --hard "origin/$BRANCH"
exec bash "$DIR/scripts/install.sh" "$@"
EOF
chmod +x /usr/local/bin/atr-update

say "每天凌晨 3 点备份数据（保留 30 天）"
cat > /etc/cron.d/atrlabels$SFX-backup <<EOF
0 3 * * * root sqlite3 $DATA_DIR/atrlabels.db ".backup '$DATA_DIR/backups/atrlabels-\$(date +\%F).db'" && tar -czf $DATA_DIR/backups/files-\$(date +\%F).tgz -C $DATA_DIR labels topup samples assets 2>/dev/null; find $DATA_DIR/backups -mtime +30 -delete
EOF

# Caddy 同时配置正式站和沙盒站的域名
caddy_sites() {
  local c port d od x
  for c in /etc/atrlabels.conf /etc/atrlabels-sandbox.conf; do
    [ -f "$c" ] || continue
    port=3000; [ "$c" = /etc/atrlabels-sandbox.conf ] && port=3001
    # shellcheck disable=SC1090
    d=$(. "$c"; echo "${DOMAIN:-}"); od=$(. "$c"; echo "${OMS_DOMAIN:-}")
    for x in $d $od; do printf '%s {\n  encode gzip\n  reverse_proxy 127.0.0.1:%s\n}\n\n' "$x" "$port"; done
  done
}
if [ -n "$(caddy_sites)" ]; then
  say "配置 HTTPS（Caddy）"
  if ! command -v caddy >/dev/null; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https gnupg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy
  fi
  caddy_sites > /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy
fi
IP_URL="http://$PUBLIC_IP:$PORT"
URL="${DOMAIN:+https://$DOMAIN}"; URL="${URL:-$IP_URL}"
if [ -n "$OMS_DOMAIN" ]; then OMS="https://$OMS_DOMAIN/portal/login"; else OMS="$URL/portal/login"; fi

# 等服务启动（刚重启时连不上是正常的，不显示报错）
echo "==> 等待服务启动…"
ok=0
for i in $(seq 1 30); do
  if curl -fs -o /dev/null -m 3 "http://127.0.0.1:$PORT/login" 2>/dev/null; then ok=1; break; fi
  sleep 2
done
ADMIN_PW=$(grep '^ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)

if [ "$ok" = 1 ]; then
  cat <<EOF

==============================================================
  $SITE_NAME 安装完成（版本 ${SHA:0:7}）
  管理后台：   $URL
  客户 OMS：   $OMS   （发给客户的登录地址）
  管理员密码： $ADMIN_PW
  配置文件：   $ENV_FILE（修改后执行 systemctl restart $SERVICE）
  数据目录：   $DATA_DIR（每天自动备份到 $DATA_DIR/backups）
  查看日志：   journalctl -u $SERVICE -f
  更新系统：   atr-update${SFX:+ sandbox}
==============================================================
EOF
  if [ "$SITE" = sandbox ]; then echo "提示：沙盒站永远不会真实出单；在后台“设置 → ShipBest 连接”选“沙盒”并填好 API，就能用真实报价测试。"; fi
  if [ -z "$DOMAIN" ]; then echo "提示：没有配置域名，请在云服务器防火墙放行 TCP $PORT 端口。"; else echo "提示：请在云服务器防火墙放行 TCP 80 和 443 端口（HTTPS 证书需要）。"; fi
else
  warn "服务没有正常启动，下面是最近的日志，请截图发给技术支持："
  journalctl -u "$SERVICE" -n 30 --no-pager || true
  exit 1
fi
