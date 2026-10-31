#!/usr/bin/env bash
# =============================================================================
# 数据库恢复脚本
# 用法：
#   ./scripts/restore.sh backups/scheduling-sqlite-20260101-020000.db.gz
#   ./scripts/restore.sh backups/scheduling-pg-20260101-020000.sql.gz
# 注意：会覆盖当前数据库，请先确认已停止应用或已做好当前备份。
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "用法: ./scripts/restore.sh <备份文件路径>" >&2
  ls -1t ./backups 2>/dev/null | head -10 || true
  exit 1
fi

PROVIDER="${DATABASE_PROVIDER:-sqlite}"
DATABASE_URL="${DATABASE_URL:-file:./prisma/data/app.db}"

read -r -p "即将用 $FILE 覆盖当前数据库（$PROVIDER），输入 YES 继续：" CONFIRM
if [ "$CONFIRM" != "YES" ]; then
  echo "已取消"
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ "$PROVIDER" = "postgresql" ]; then
  CLEAN_URL="${DATABASE_URL%%\?*}"
  PROTO_REMOVED="${CLEAN_URL#*://}"
  CREDENTIALS="${PROTO_REMOVED%@*}"
  HOSTPART="${PROTO_REMOVED#*@}"
  PGUSER="${CREDENTIALS%%:*}"
  PGPASSWORD="${CREDENTIALS#*:}"
  PGHOST="${HOSTPART%%:*}"
  REST="${HOSTPART#*:}"
  PGPORT="${REST%%/*}"
  PGDATABASE="${REST#*/}"
  export PGPASSWORD

  case "$FILE" in
    *.gz) gunzip -c "$FILE" > "$WORK/restore.sql" ;;
    *) cp "$FILE" "$WORK/restore.sql" ;;
  esac

  echo "[restore] 正在恢复到 PostgreSQL $PGDATABASE ..."
  psql -h "$PGHOST" -p "${PGPORT:-5432}" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -f "$WORK/restore.sql"
  echo "[restore] ✅ 完成"
else
  DB_PATH="${DATABASE_URL#file:}"
  DB_PATH="${DB_PATH#./}"
  mkdir -p "$(dirname "$DB_PATH")"

  case "$FILE" in
    *.gz) gunzip -c "$FILE" > "$WORK/restore.db" ;;
    *) cp "$FILE" "$WORK/restore.db" ;;
  esac

  echo "[restore] 正在恢复到 SQLite $DB_PATH ..."
  cp "$DB_PATH" "$DB_PATH.before-restore" 2>/dev/null || true
  cp "$WORK/restore.db" "$DB_PATH"
  echo "[restore] ✅ 完成（原文件已备份为 $DB_PATH.before-restore）"
fi
