# =============================================================================
# 排班系统 Docker 镜像（多阶段构建）
#  - 默认使用 SQLite（本地一键启动，无需外部数据库）
#  - 云服务器切到 PostgreSQL 时：构建参数 DATABASE_PROVIDER=postgresql
# 示例：
#   docker build -t scheduling-system .
#   docker build --build-arg DATABASE_PROVIDER=postgresql -t scheduling-system:pg .
# =============================================================================

ARG NODE_IMAGE=node:22-alpine

# ------------------------------ 依赖安装阶段 ------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# Prisma 在 alpine 上需要 openssl；时区与中文显示相关
RUN apk add --no-cache openssl libc6-compat tzdata
COPY package.json package-lock.json* ./
# prisma 的 postinstall 不需要：显式关闭生命周期脚本，随后手动 generate
RUN npm ci --ignore-scripts --no-audit --no-fund || npm install --ignore-scripts --no-audit --no-fund

# ------------------------------ 编译构建阶段 ------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ARG DATABASE_PROVIDER=sqlite
RUN apk add --no-cache openssl libc6-compat tzdata
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 切换 Prisma provider（sqlite / postgresql）
RUN if [ "$DATABASE_PROVIDER" = "postgresql" ]; then node scripts/switch-provider.mjs postgresql; else node scripts/switch-provider.mjs sqlite; fi
# 构建时不需要真实数据库连接，仅为 Prisma Client 生成类型
ENV DATABASE_URL="file:./data/app.db"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

# ------------------------------ 运行阶段 ------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ARG DATABASE_PROVIDER=sqlite
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache openssl libc6-compat tzdata \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# 应用产物与运行时依赖（Next.js 全量构建产物，直接使用 next start 启动）
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs

# Prisma：schema、迁移、CLI（启动时执行迁移）
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/docker/entrypoint.sh ./docker/entrypoint.sh

# 去掉仅构建期需要的依赖，减小镜像体积
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund || true

RUN mkdir -p /app/data /app/prisma/data /app/backups && chown -R nextjs:nodejs /app/data /app/prisma/data /app/backups .next \
  && chmod +x /app/docker/entrypoint.sh

USER nextjs
EXPOSE 3000
VOLUME ["/app/prisma/data", "/app/backups"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["./node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
