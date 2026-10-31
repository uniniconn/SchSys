#!/usr/bin/env bash
# =============================================================================
# 排班系统 · Linux / WSL 一键启动
#
# 适用场景：在 Linux 服务器，或在已安装发行版的 WSL 中运行本项目。
#   （Windows 本机请直接双击桌面的「启动排班系统」）
#
# 用法：
#   ./scripts/start-linux.sh                 # 前台启动（日志实时输出，Ctrl+C 停止）
#   ./scripts/start-linux.sh --background    # 后台常驻，日志写入 .run/logs/
#   ./scripts/start-linux.sh --port 3100 --no-browser
#   ./scripts/start-linux.sh --force-build
#
# 前置条件：Node.js 20.11+、npm、已执行 npm install（脚本会自动处理）
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"

PORT=3000
HOST=0.0.0.0
OPEN_PATH="/admin/login"
BACKGROUND=0
BROWSER=1
FORCE_BUILD=0

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --open) OPEN_PATH="$2"; shift 2 ;;
    --background|-b) BACKGROUND=1; shift ;;
    --no-browser) BROWSER=0; shift ;;
    --force-build) FORCE_BUILD=1; shift ;;
    *) echo "未知参数：$1"; exit 1 ;;
  esac
done

LOG_DIR="$PROJECT_DIR/.run/logs"
PID_FILE="$PROJECT_DIR/.run/server.pid"
OUT_LOG="$LOG_DIR/server.out.log"
ERR_LOG="$LOG_DIR/server.err.log"
mkdir -p "$LOG_DIR"

step() { printf '\033[36m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32m%s\033[0m\n' "$1"; }
warn() { printf '    \033[33m%s\033[0m\n' "$1"; }
err()  { printf '    \033[31m%s\033[0m\n' "$1"; }

# --------------------------------------------------------------- 依赖检查
step "检查运行环境"
command -v node >/dev/null 2>&1 || { err "未找到 Node.js，请先安装 20.11+"; exit 1; }
NODE_VERSION="$(node --version)"
NODE_MAJOR="$(echo "$NODE_VERSION" | sed 's/^v//' | cut -d. -f1)"
[ "$NODE_MAJOR" -ge 20 ] || { err "Node.js 版本过低（$NODE_VERSION），需要 20.11+"; exit 1; }
ok "Node.js $NODE_VERSION"

command -v npm >/dev/null 2>&1 || { err "未找到 npm"; exit 1; }
ok "npm $(npm --version)"

# --------------------------------------------------------------- 环境变量
step "准备环境变量"
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    warn "已从 .env.example 生成 .env（建议修改 SESSION_SECRET 与初始管理员密码）"
  else
    err "缺少 .env 与 .env.example"; exit 1
  fi
else
  ok ".env 已存在"
fi
set -a; . ./.env; set +a
ok "数据库：${DATABASE_URL:-(未设置)}"

# ------------------------------------------------------------------- 依赖
if [ ! -f node_modules/next/package.json ]; then
  step "安装依赖（首次运行，可能需要几分钟）"
  npm install --no-audit --no-fund
fi

# ------------------------------------------------------------- 数据库结构
step "同步数据库结构"
npx prisma generate
npx prisma migrate deploy
ok "数据库已就绪"

# --------------------------------------------------------------- 生产构建
step "检查生产构建产物"
NEED_BUILD=0
if [ "$FORCE_BUILD" -eq 1 ] || [ ! -f .next/BUILD_ID ] || [ ! -f .next/prerender-manifest.json ]; then
  NEED_BUILD=1
elif [ -n "$(find src prisma/schema.prisma next.config.mjs tailwind.config.ts package.json -newer .next/BUILD_ID -print -quit 2>/dev/null)" ]; then
  NEED_BUILD=1
  warn "检测到源码变更，需要重新构建"
else
  ok "构建产物已是最新"
fi

if [ "$NEED_BUILD" -eq 1 ]; then
  warn "正在构建（约 1~3 分钟）..."
  rm -rf .next
  NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 npx next build
  ok "构建完成"
fi

# ---------------------------------------------------------- 端口与旧进程
step "检查服务状态"
if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "${OLD_PID:-}" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    warn "发现运行中的服务（PID $OLD_PID），先停止它..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$OLD_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  err "端口 $PORT 已被占用，请用 --port 指定其它端口"; exit 1
fi
ok "端口 $PORT 可用"

# ----------------------------------------------------------------- 启动
step "启动服务（生产模式：next start）"
URL="http://127.0.0.1:$PORT"
if [ "$BACKGROUND" -eq 1 ]; then
  : > "$OUT_LOG"; : > "$ERR_LOG"
  NODE_ENV=production nohup node node_modules/next/dist/bin/next start -p "$PORT" -H "$HOST" \
    > "$OUT_LOG" 2> "$ERR_LOG" &
  SERVER_PID=$!
  echo "$SERVER_PID" > "$PID_FILE"
else
  NODE_ENV=production node node_modules/next/dist/bin/next start -p "$PORT" -H "$HOST" &
  SERVER_PID=$!
  echo "$SERVER_PID" > "$PID_FILE"
fi

READY=0
for _ in $(seq 1 120); do
  sleep 1
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then break; fi
  if command -v curl >/dev/null 2>&1; then
    if curl -fsS "$URL/api/health" >/dev/null 2>&1; then READY=1; break; fi
  else
    if node -e "fetch('$URL/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then READY=1; break; fi
  fi
done

if [ "$READY" -ne 1 ]; then
  err "服务未能在限定时间内就绪，最近日志："
  tail -n 20 "$OUT_LOG" 2>/dev/null || true
  tail -n 20 "$ERR_LOG" 2>/dev/null || true
  kill -9 "$SERVER_PID" 2>/dev/null || true
  rm -f "$PID_FILE"
  exit 1
fi

echo
ok "服务已就绪：$URL"
ok "管理员登录：$URL/admin/login   （账号：${INITIAL_ADMIN_USERNAME:-admin}）"
ok "填写端入口：$URL/fill"
ok "健康检查：  $URL/api/health"
[ "$BACKGROUND" -eq 1 ] && ok "运行日志：  $OUT_LOG"

if [ "$BROWSER" -eq 1 ] && [ "$BACKGROUND" -eq 0 ]; then
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL$OPEN_PATH" >/dev/null 2>&1 || true
    ok "已尝试打开浏览器：$URL$OPEN_PATH"
  else
    ok "请手动访问：$URL$OPEN_PATH"
  fi
fi

if [ "$BACKGROUND" -eq 1 ]; then
  echo
  echo "服务已在后台运行（PID $SERVER_PID）。停止：./scripts/stop-linux.sh"
  exit 0
fi

echo
echo "----------------------------------------------------------------"
echo " 服务正在前台运行，按 Ctrl+C 停止服务。"
echo "----------------------------------------------------------------"
trap 'echo; step "正在停止服务..."; kill "$SERVER_PID" 2>/dev/null || true; rm -f "$PID_FILE"; exit 0' INT TERM
wait "$SERVER_PID" || true
rm -f "$PID_FILE"
