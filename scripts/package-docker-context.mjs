#!/usr/bin/env node
/**
 * ============================================================================
 * 生成 Docker 构建上下文压缩包（可在任意装有 Docker 的机器上直接构建）
 * ============================================================================
 * 用法：
 *   node scripts/package-docker-context.mjs
 *
 * 输出：
 *   dist/docker-context/                                  构建上下文目录
 *   dist/scheduling-system-docker-context-<版本>.tar.gz    可直接分发的压缩包
 *   dist/scheduling-system-docker-context-<版本>.manifest.json  文件清单与校验和
 *
 * 说明：只打包 docker build 所需的文件（不含 node_modules / .next / .env / 数据库），
 *      因此在解压目录执行 `docker build -t scheduling-system .` 即可。
 * ============================================================================
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'docker-context');

/** 需要打包的顶层文件/目录（相对项目根） */
const INCLUDE = [
  'Dockerfile',
  '.dockerignore',
  'package.json',
  'package-lock.json',
  'next.config.mjs',
  'next-env.d.ts',
  'tsconfig.json',
  'tailwind.config.ts',
  'postcss.config.mjs',
  '.env.example',
  'README.md',
  'src',
  'public',
  'docker',
  'scripts/switch-provider.mjs',
  'scripts/launcher.mjs',
  'scripts/start-linux.sh',
  'scripts/stop-linux.sh',
  'prisma/schema.prisma',
  'prisma/migrations',
  'prisma/migrations-sqlite',
  'prisma/migrations-postgresql',
  'prisma/seed.mjs',
];

/** 明确排除的路径片段（即使出现在上面目录内） */
const EXCLUDE_SEGMENTS = new Set(['node_modules', '.next', '.run', 'dist', '.git', '.tools', 'data', '.e2e-artifacts', '.npm-cache']);

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version ?? '0.0.0';

function copyRecursive(source, target, relative = '') {
  const info = statSync(source);
  if (info.isDirectory()) {
    mkdirSync(target, { recursive: true });
    for (const entry of readdirSync(source)) {
      if (EXCLUDE_SEGMENTS.has(entry)) continue;
      copyRecursive(path.join(source, entry), path.join(target, entry), path.join(relative, entry));
    }
    return;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target);
}

function listFiles(dir, base = dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...listFiles(full, base));
    else files.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return files.sort();
}

console.log(`[1/4] 准备构建上下文：${STAGE}`);
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

let copied = 0;
for (const relative of INCLUDE) {
  const source = path.join(ROOT, relative);
  if (!existsSync(source)) {
    console.log(`  - 跳过（不存在）：${relative}`);
    continue;
  }
  copyRecursive(source, path.join(STAGE, relative));
  copied += 1;
}
console.log(`  已复制 ${copied} 项`);

// 上下文里放一份简短的构建说明
writeFileSync(
  path.join(STAGE, 'BUILD.md'),
  [
    '# Docker build context',
    '',
    '本目录由 `node scripts/package-docker-context.mjs` 生成，包含构建排班系统镜像所需的全部文件。',
    '',
    '## 构建（SQLite 版本，本地/单机）',
    '```bash',
    'docker build -t scheduling-system:latest .',
    '```',
    '',
    '## 构建（PostgreSQL 版本，云服务器）',
    '```bash',
    'docker build --build-arg DATABASE_PROVIDER=postgresql -t scheduling-system:pg .',
    '```',
    '',
    '## 运行',
    '```bash',
    'docker run -d --name scheduling -p 3000:3000 \\',
    '  -e SESSION_SECRET="请替换为随机长字符串" \\',
    '  -e INITIAL_ADMIN_USERNAME=admin \\',
    '  -e INITIAL_ADMIN_PASSWORD="Admin@12345" \\',
    '  -e BASE_URL="http://localhost:3000" \\',
    '  -v scheduling-data:/app/prisma/data \\',
    '  scheduling-system:latest',
    '```',
    '',
    '也可以直接使用项目根目录的 `docker-compose.yml`：`docker compose up -d --build`。',
    '',
  ].join('\n'),
  'utf8',
);

console.log('[2/4] 生成压缩包');
const archiveName = `scheduling-system-docker-context-${version}.tar.gz`;
const archivePath = path.join(DIST, archiveName);
rmSync(archivePath, { force: true });
const tar = spawnSync('tar', ['-czf', archivePath, '-C', STAGE, '.'], { encoding: 'utf8' });
if (tar.error || tar.status !== 0) {
  console.error('打包失败：', tar.error?.message ?? tar.stderr);
  process.exit(1);
}

console.log('[3/4] 生成清单与校验和');
const files = listFiles(STAGE);
const archiveBuffer = readFileSync(archivePath);
const sha256 = createHash('sha256').update(archiveBuffer).digest('hex');
const manifest = {
  name: 'scheduling-system docker build context',
  version,
  createdAt: new Date().toISOString(),
  archive: archiveName,
  archiveBytes: archiveBuffer.length,
  sha256,
  buildArgs: { DATABASE_PROVIDER: 'sqlite | postgresql' },
  files: files.map((file) => ({
    path: file,
    bytes: statSync(path.join(STAGE, file)).size,
  })),
};
const manifestPath = path.join(DIST, `scheduling-system-docker-context-${version}.manifest.json`);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
writeFileSync(`${archivePath}.sha256`, `${sha256}  ${archiveName}\n`, 'utf8');

console.log('[4/4] 完成');
console.log(`  上下文目录：${STAGE}`);
console.log(`  压缩包：    ${archivePath}（${(archiveBuffer.length / 1024 / 1024).toFixed(2)} MB）`);
console.log(`  SHA256：    ${sha256}`);
console.log(`  清单：      ${manifestPath}`);
console.log('');
console.log('在装有 Docker 的机器上：');
console.log(`  tar -xzf ${archiveName} -C ./scheduling-context`);
console.log('  cd scheduling-context && docker build -t scheduling-system:latest .');
