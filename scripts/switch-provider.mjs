#!/usr/bin/env node
/**
 * 一键切换 Prisma datasource provider（SQLite <-> PostgreSQL）。
 *
 * 用法：
 *   node scripts/switch-provider.mjs postgresql
 *   node scripts/switch-provider.mjs sqlite
 *
 * 作用：
 *   1. 把 prisma/schema.prisma 的 datasource provider 改成目标类型
 *      （Prisma 不允许 provider 使用 env()，所以只能切换文件内容）。
 *   2. 切换迁移目录：两种数据库的迁移 SQL 互不通用，因此分开长期保存：
 *        prisma/migrations-sqlite        本地默认
 *        prisma/migrations-postgresql    云服务器
 *      prisma/migrations 始终是“当前生效”的那一份（Prisma 默认读取的位置）。
 *
 * 切换后请同步修改 .env 中的 DATABASE_URL，并重新生成客户端：
 *   npx prisma generate && npx prisma migrate deploy
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = (process.argv[2] || '').toLowerCase();

if (!['sqlite', 'postgresql'].includes(target)) {
  console.error('用法: node scripts/switch-provider.mjs <sqlite|postgresql>');
  process.exit(1);
}

const prismaDir = path.join(root, 'prisma');
const schemaPath = path.join(prismaDir, 'schema.prisma');
const activeDir = path.join(prismaDir, 'migrations');
const dirFor = (provider) => path.join(prismaDir, provider === 'sqlite' ? 'migrations-sqlite' : 'migrations-postgresql');

/* ---------------------- 0. 判断当前 provider ---------------------- */
const schema = readFileSync(schemaPath, 'utf8');
const current = schema.match(/datasource\s+db\s*\{[\s\S]*?provider\s*=\s*"([^"]+)"/)?.[1] ?? null;
if (!current) {
  console.error('未能定位 datasource provider，请手动检查 prisma/schema.prisma');
  process.exit(1);
}

/* --------- 1. 把当前生效的迁移归档回它自己的长期目录 --------- */
if (current !== target && existsSync(activeDir)) {
  const archive = dirFor(current);
  mkdirSync(archive, { recursive: true });
  for (const entry of readdirSync(activeDir)) {
    cpSync(path.join(activeDir, entry), path.join(archive, entry), { recursive: true });
  }
  console.log(`ℹ️  已将当前 ${current} 迁移归档到 ${path.relative(root, archive)}`);
}

/* ---------------------- 2. 修改 schema 的 provider ---------------------- */
const block = `datasource db {\n  provider = "${target}"\n  url      = env("DATABASE_URL")\n}`;
writeFileSync(schemaPath, schema.replace(/datasource\s+db\s*\{[\s\S]*?\}/, block), 'utf8');

/* ------------------- 3. 载入目标 provider 的迁移 ------------------- */
const sourceDir = dirFor(target);
if (!existsSync(sourceDir)) mkdirSync(sourceDir, { recursive: true });

rmSync(activeDir, { recursive: true, force: true });
mkdirSync(activeDir, { recursive: true });
cpSync(sourceDir, activeDir, { recursive: true });

const entries = readdirSync(activeDir);
if (!entries.includes('migration_lock.toml')) {
  writeFileSync(
    path.join(activeDir, 'migration_lock.toml'),
    `# 请勿手动编辑：该文件记录本迁移目录对应的数据库类型\nprovider = "${target}"\n`,
    'utf8',
  );
}

console.log(`✅ datasource provider 已切换为 ${target}`);
console.log(`   prisma/migrations 已同步为 ${path.relative(root, sourceDir)} 的内容`);
console.log(
  target === 'postgresql'
    ? '   请确认 .env 中 DATABASE_URL 为 PostgreSQL 连接串，然后执行：npm run setup'
    : '   请确认 .env 中 DATABASE_URL 为 file:... 形式，然后执行：npm run setup',
);
