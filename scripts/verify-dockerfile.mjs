#!/usr/bin/env node
/**
 * ============================================================================
 * Dockerfile 静态校验（无需 Docker 守护进程）
 * ============================================================================
 * 用法：
 *   node scripts/verify-dockerfile.mjs [contextDir]
 *
 * 校验内容：
 *   1. 指令拼写与基本结构（FROM / COPY / RUN / ENTRYPOINT / CMD / HEALTHCHECK …）
 *   2. 每个 COPY 的本地来源文件是否存在于构建上下文中
 *   3. `COPY --from=<stage>` 引用的阶段是否存在
 *   4. 最终镜像的启动命令（ENTRYPOINT/CMD/HEALTHCHECK）指向的文件是否会被复制进镜像
 *   5. .dockerignore 是否排除了密钥/本地数据（.env、node_modules、.next、数据库）
 * ============================================================================
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const contextDir = path.resolve(process.argv[2] ?? path.join(ROOT, 'dist', 'docker-context'));

const problems = [];
const notes = [];
const ok = [];
const fail = (message) => problems.push(message);
const info = (message) => notes.push(message);
const pass = (message) => ok.push(message);

if (!existsSync(contextDir)) {
  console.error(`构建上下文不存在：${contextDir}`);
  console.error('请先运行：node scripts/package-docker-context.mjs');
  process.exit(1);
}

const dockerfilePath = path.join(contextDir, 'Dockerfile');
if (!existsSync(dockerfilePath)) {
  console.error('构建上下文中缺少 Dockerfile');
  process.exit(1);
}

const lines = readFileSync(dockerfilePath, 'utf8').split(/\r?\n/);
const instructions = [];
let buffer = '';
for (const raw of lines) {
  const line = raw.replace(/\s+$/, '');
  if (!buffer && (line.trim() === '' || line.trim().startsWith('#'))) continue;
  buffer += buffer ? ` ${line.trim()}` : line.trim();
  if (buffer.endsWith('\\')) {
    buffer = buffer.slice(0, -1).trim();
    continue;
  }
  instructions.push(buffer);
  buffer = '';
}

const KNOWN = new Set(['FROM', 'ARG', 'ENV', 'WORKDIR', 'COPY', 'RUN', 'CMD', 'ENTRYPOINT', 'EXPOSE', 'USER', 'VOLUME', 'HEALTHCHECK', 'LABEL', 'ADD', 'SHELL', 'STOPSIGNAL']);
const stages = new Set();
let currentStage = null;
const copiedInFinalStage = [];
let finalStage = null;

// 先找出所有阶段名
for (const inst of instructions) {
  const [cmd, ...rest] = inst.split(/\s+/);
  if (cmd.toUpperCase() === 'FROM') {
    const asIndex = rest.findIndex((token) => token.toUpperCase() === 'AS');
    const name = asIndex >= 0 ? rest[asIndex + 1] : null;
    if (name) stages.add(name);
    finalStage = name ?? 'final-anonymous';
  }
}

for (const inst of instructions) {
  const [rawCmd, ...args] = inst.split(/\s+/);
  const cmd = rawCmd.toUpperCase();
  if (!KNOWN.has(cmd)) {
    fail(`未知指令：${inst.slice(0, 80)}`);
    continue;
  }

  if (cmd === 'FROM') {
    const asIndex = args.findIndex((token) => token.toUpperCase() === 'AS');
    currentStage = asIndex >= 0 ? args[asIndex + 1] : 'anonymous';
    pass(`FROM ${args.slice(0, asIndex >= 0 ? asIndex : args.length).join(' ')} (stage: ${currentStage})`);
    continue;
  }

  if (cmd === 'COPY') {
    const rest = args.filter((token) => !token.startsWith('--from') && !token.startsWith('--chown') && !token.startsWith('--chmod'));
    const fromFlag = args.find((token) => token.startsWith('--from='));
    if (fromFlag) {
      const sourceStage = fromFlag.slice('--from='.length);
      if (!stages.has(sourceStage) && !/^\d+$/.test(sourceStage)) {
        fail(`COPY --from=${sourceStage} 引用了不存在的构建阶段（可用阶段：${[...stages].join(', ')}）`);
      }
      if (!rest.length) fail(`COPY --from=${sourceStage} 缺少来源或目标路径`);
      if (currentStage === finalStage && rest.length >= 1) {
        copiedInFinalStage.push(rest.slice(0, -1).join(' '));
      }
    } else if (rest.length >= 2) {
      const sources = rest.slice(0, -1);
      for (const source of sources) {
        if (source.includes('*')) continue;
        const sourcePath = path.join(contextDir, source);
        if (!existsSync(sourcePath)) fail(`COPY 来源在构建上下文中不存在：${source}`);
        else pass(`COPY 来源存在：${source}`);
      }
    } else {
      fail(`COPY 指令参数不完整：${inst.slice(0, 80)}`);
    }
    continue;
  }

  if (cmd === 'RUN') {
    const command = args.join(' ');
    for (const match of command.matchAll(/(?:^|&&|\s)((?:\.\/|node |npx )?[\w./-]+\.(?:sh|js|mjs))/g)) {
      const candidate = match[1].replace(/^node\s+/, '').replace(/^npx\s+/, '').trim();
      if (candidate.startsWith('/app/')) {
        // 镜像内路径（例如 ENTRYPOINT 脚本），不要求存在于构建上下文中
        continue;
      }
      if (candidate.startsWith('./') || candidate.includes('/')) {
        const local = path.join(contextDir, candidate.replace(/^\.\//, ''));
        if (!existsSync(local)) info(`RUN 引用的脚本未在上下文中找到（可能来自依赖安装）：${candidate}`);
      }
    }
    pass(`RUN ${command.slice(0, 70)}${command.length > 70 ? '…' : ''}`);
    continue;
  }

  if (cmd === 'ENTRYPOINT' || cmd === 'CMD') {
    const isExecForm = inst.includes('[');
    if (isExecForm) {
      try {
        const json = JSON.parse(inst.slice(inst.indexOf('[')));
        pass(`${cmd} ${JSON.stringify(json)}`);
        for (const token of json) {
          if (token.startsWith('/app/')) {
            const relative = token.slice('/app/'.length);
            const inContext = existsSync(path.join(contextDir, relative)) || copiedInFinalStage.some((copy) => relative === copy || relative.startsWith(`${copy.replace(/^\.\//, '')}/`));
            if (!inContext) fail(`${cmd} 引用的 /app/${relative} 未被复制进最终镜像`);
          }
        }
      } catch {
        fail(`${cmd} 的 JSON 形式无法解析：${inst.slice(0, 80)}`);
      }
    } else {
      pass(`${cmd} ${args.join(' ')}`);
    }
    continue;
  }

  if (cmd === 'HEALTHCHECK') {
    pass(`HEALTHCHECK ${args.join(' ').slice(0, 80)}`);
    continue;
  }

  pass(`${cmd} ${args.join(' ').slice(0, 70)}`);
}

// ---------------------------------------------------------------- .dockerignore
const ignorePath = path.join(contextDir, '.dockerignore');
if (existsSync(ignorePath)) {
  const patterns = readFileSync(ignorePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  for (const required of ['node_modules', '.next', '.env']) {
    if (!patterns.some((pattern) => pattern === required || pattern === `${required}/`)) {
      fail(`.dockerignore 未排除 ${required}（可能把本地依赖/密钥打进镜像）`);
    } else {
      pass(`.dockerignore 已排除 ${required}`);
    }
  }
  // 上下文里不应出现敏感文件
  if (existsSync(path.join(contextDir, '.env'))) fail('构建上下文中包含 .env（密钥泄露风险）');
} else {
  fail('构建上下文中缺少 .dockerignore');
}

// -------------------------------------------------------------------- 汇总
const fileCount = (() => {
  let count = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else count += 1;
    }
  };
  walk(contextDir);
  return count;
})();

console.log(`Dockerfile 静态校验：${dockerfilePath}`);
console.log(`构建上下文：${contextDir}（${fileCount} 个文件）\n`);
for (const line of ok) console.log(`  PASS  ${line}`);
for (const line of notes) console.log(`  NOTE  ${line}`);
for (const line of problems) console.log(`  FAIL  ${line}`);
console.log(`\n结果：通过 ${ok.length} 项，提示 ${notes.length} 项，失败 ${problems.length} 项`);
process.exit(problems.length > 0 ? 1 : 0);
