#!/usr/bin/env bash
# =============================================================================
# 排班系统 · Linux / WSL 停止服务
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
PID_FILE=".run/server.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "没有正在运行的排班系统服务。"
  exit 0
fi

PID="$(cat "$PID_FILE" 2>/dev/null || true)"
if [ -z "${PID:-}" ] || ! kill -0 "$PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "服务进程不存在，已清理 PID 文件。"
  exit 0
fi

echo "正在停止服务（PID $PID）..."
kill "$PID" 2>/dev/null || true
for _ in $(seq 1 20); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.25
done
kill -9 "$PID" 2>/dev/null || true
rm -f "$PID_FILE"
echo "服务已停止。"
