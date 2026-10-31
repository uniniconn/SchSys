#!/usr/bin/env bash
# =============================================================================
# 数据库备份脚本（SQLite / PostgreSQL）
# 用法：
#   ./scripts/backup.sh                       # 使用 .env 中的配置
#   BACKUP_DIR=/data/backups ./scripts/backup.sh
# 建议加入 crontab：
#   0 2 * * * cd /opt/scheduling && ./scripts/backup.sh >> /var/log/sched-backup.log 2>&1
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

PROVIDER="${DATABASE_PROVIDER:-sqlite}"
DATABASE_URL="${DATABASE_URL:-file:./prisma/data/app.db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "[backup] provider=$PROVIDER dir=$BACKUP_DIR"

if [ "$PROVIDER" = "postgresql" ]; then
  # 从 postgresql://user:pass@host:port/db?schema=public 解析连接参数
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

  FILE="$BACKUP_DIR/scheduling-pg-$STAMP.sql.gz"
  echo "[backup] pg_dump -> $FILE"
  pg_dump -h "$PGHOST" -p "${PGPORT:-5432}" -U "$PGUSER" -d "$PGDATABASE" --no-owner --no-privileges \
    | gzip > "$FILE"

  # Docker 部署时可用容器内的 pg_dump：
  # docker compose exec -T db pg_dump -U "$PGUSER" -d "$PGDATABASE" | gzip > "$FILE"
else
  DB_PATH="${DATABASE_URL#file:}"
  DB_PATH="${DB_PATH#./}"
  # 兼容 prisma/ 前缀与容器内绝对路径
  for candidate in "$DB_PATH" "prisma/$DB_PATH" "./$DB_PATH"; do
    if [ -f "$candidate" ]; then DB_PATH="$candidate"; break; fi
  done

  if [ ! -f "$DB_PATH" ]; then
    echo "[backup] ❌ 找不到数据库文件：$DB_PATH" >&2
    exit 1
  fi

  FILE="$BACKUP_DIR/scheduling-sqlite-$STAMP.db"
  echo "[backup] sqlite copy -> $FILE"
  # 使用 sqlite3 的 .backup 保证一致性；没有 sqlite3 时退化为文件复制
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB_PATH" ".backup '$FILE'"
  else
    cp "$DB_PATH" "$FILE"
  fi
  gzip -f "$FILE"
  FILE="$FILE.gz"
fi

echo "[backup] ✅ 完成：$FILE ($(du -h "$FILE" | cut -f1))"

# 清理过期备份
if [ "$RETENTION_DAYS" -gt 0 ]; then
  find "$BACKUP_DIR" -type f \( -name '*.gz' -o -name '*.db' \) -mtime "+$RETENTION_DAYS" -print -delete || true
fi
