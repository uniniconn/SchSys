#!/bin/sh
# 容器启动脚本：先执行数据库迁移，再启动应用
set -e

echo "[entrypoint] DATABASE_PROVIDER=${DATABASE_PROVIDER:-sqlite}"
echo "[entrypoint] 执行数据库迁移 prisma migrate deploy ..."

# 如果使用 SQLite 且数据目录不存在，则创建
if [ "${DATABASE_PROVIDER:-sqlite}" = "sqlite" ]; then
  mkdir -p /app/prisma/data
fi

# 迁移失败时给出明确提示，但仍然尝试启动（数据库已是最新时会直接通过）
if ! ./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma; then
  echo "[entrypoint] ⚠️ 迁移失败。若数据库为全新实例，请检查 DATABASE_URL 是否正确。"
  echo "[entrypoint] 如需强制同步结构（仅限开发），可在容器内执行 prisma db push。"
  exit 1
fi

echo "[entrypoint] 迁移完成，启动应用 ..."
exec "$@"
