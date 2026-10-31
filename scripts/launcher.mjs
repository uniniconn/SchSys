#!/usr/bin/env node
/**
 * ============================================================================
 * 排班系统 · 启动器（Node 实现，不依赖 PowerShell 执行策略）
 * ============================================================================
 * 用法：
 *   node scripts/launcher.mjs start                    # 前台启动（日志实时输出，Ctrl+C 停止）
 *   node scripts/launcher.mjs start --background        # 后台启动（写完 PID 立即返回）
 *   node scripts/launcher.mjs stop                     # 停止后台服务
 *   node scripts/launcher.mjs status                   # 查看服务状态
 *   node scripts/launcher.mjs start --port 3100 --no-browser --force-build
 *   node scripts/launcher.mjs start --open /admin/dashboard
 *
 * 流程：检查 Node 环境 -> 准备 .env -> 安装依赖(首次) -> prisma generate + migrate deploy
 *      -> 按需生产构建 -> 启动 next start -> 等待健康检查 -> 打开浏览器
 * ============================================================================
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 解析项目根目录。
 * 1) 优先使用脚本自身所在位置（<项目根>\scripts\launcher.mjs）的上一级；
 * 2) 若脚本被复制到别处（例如桌面上的副本），退回脚本内记录的安装目录；
 * 3) 再退回当前工作目录。
 */
const INSTALLED_PROJECT_DIR = 'D:\\School project';

function isProjectRoot(dir) {
  return Boolean(dir) && existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'scripts', 'launcher.mjs'));
}

function resolveProjectRoot() {
  const candidates = [
    path.resolve(__dirname, '..'),
    INSTALLED_PROJECT_DIR,
    path.resolve(process.cwd()),
  ];
  for (const candidate of candidates) {
    if (isProjectRoot(candidate)) return candidate;
  }
  return path.resolve(__dirname, '..');
}

const ROOT = resolveProjectRoot();
const RUN_DIR = path.join(ROOT, '.run');
const LOG_DIR = path.join(RUN_DIR, 'logs');
const PID_FILE = path.join(RUN_DIR, 'server.pid');
const OUT_LOG = path.join(LOG_DIR, 'server.out.log');
const ERR_LOG = path.join(LOG_DIR, 'server.err.log');
const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const PRISMA_BIN = path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js');

const C = {
  reset: '\u001b[0m',
  cyan: '\u001b[36m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
  gray: '\u001b[90m',
  bold: '\u001b[1m',
};

const step = (message) => { console.log(`${C.cyan}==> ${message}${C.reset}`); launcherLog(`==> ${message}`); };
const ok = (message) => { console.log(`    ${C.green}${message}${C.reset}`); launcherLog(`    [OK] ${message}`); };
const warn = (message) => { console.log(`    ${C.yellow}${message}${C.reset}`); launcherLog(`    [WARN] ${message}`); };
const bad = (message) => { console.log(`    ${C.red}${message}${C.reset}`); launcherLog(`    [ERROR] ${message}`); };

/** 把关键步骤写入 .run/logs/launcher.log，便于无窗口/后台启动后排查 */
function launcherLog(line) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(path.join(LOG_DIR, 'launcher.log'), `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  } catch {
    /* 日志失败不影响启动 */
  }
}

function fail(message, hint = '') {
  console.log('');
  bad(`启动失败：${message}`);
  if (hint) console.log(`    ${hint}`);
  console.log('');
  process.exit(1);
}

/* ------------------------------- 参数解析 ------------------------------- */
function parseArgs(argv) {
  const options = {
    command: 'start',
    port: 3000,
    host: '127.0.0.1',
    browser: true,
    forceBuild: false,
    skipInstall: false,
    background: false,
    open: '/admin/login',
  };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith('-')) options.command = rest.shift().toLowerCase();
  while (rest.length > 0) {
    const token = rest.shift();
    switch (token) {
      case '--port': options.port = Number(rest.shift()); break;
      case '--host': options.host = rest.shift(); break;
      case '--open': options.open = rest.shift(); break;
      case '--no-browser': options.browser = false; break;
      case '--browser': options.browser = true; break;
      case '--force-build': options.forceBuild = true; break;
      case '--skip-install': options.skipInstall = true; break;
      case '--background': options.background = true; break;
      case '-b': options.background = true; break;
      default:
        if (token.startsWith('--port=')) options.port = Number(token.slice(7));
        else if (token.startsWith('--host=')) options.host = token.slice(7);
        else if (token.startsWith('--open=')) options.open = token.slice(7);
        break;
    }
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    fail(`端口号无效：${options.port}`);
  }
  return options;
}

/* ------------------------------ .env 读取 ------------------------------ */
function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!existsSync(envPath)) {
    const example = path.join(ROOT, '.env.example');
    if (!existsSync(example)) fail('缺少 .env 与 .env.example，无法确定运行配置。');
    copyFileSync(example, envPath);
    warn('已从 .env.example 生成 .env（建议修改 SESSION_SECRET 与初始管理员密码）');
  }
  const map = {};
  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    map[key] = value;
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return map;
}

/* -------------------------------- 端口 --------------------------------- */
function portInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1500, () => finish(false));
  });
}

async function waitForHealth(port, host, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${host}:${port}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return await response.json();
    } catch {
      /* 还没起来，继续等待 */
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return null;
}

/* ------------------------------ 子进程工具 ------------------------------ */
function runSync(command, args, label, envOverride, { tolerateFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...(envOverride ?? {}) },
  });
  if (result.error) {
    if (tolerateFailure) {
      warn(`${label} 执行异常（已忽略）：${result.error.message}`);
      return false;
    }
    fail(`${label} 执行失败：${result.error.message}`);
  }
  if (result.status !== 0) {
    if (tolerateFailure) {
      warn(`${label} 未成功（退出码 ${result.status}），将继续使用现有 Prisma Client`);
      return false;
    }
    fail(`${label} 失败（退出码 ${result.status}）`);
  }
  return true;
}

/**
 * 生产构建与生产启动必须使用 NODE_ENV=production。
 * .env 里常写着 NODE_ENV=development（本地开发用），若不覆盖会导致构建阶段
 * 预渲染报错（<Html> should not be imported outside of pages/_document）。
 */
function productionEnv(extra = {}) {
  return {
    ...process.env,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    ...extra,
  };
}

function readPid() {
  if (!existsSync(PID_FILE)) return null;
  const value = readFileSync(PID_FILE, 'utf8').trim();
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 停止进程：先 SIGTERM，超时后 SIGKILL */
async function stopProcess(pid, timeoutMs = 5000) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return true;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && processAlive(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (processAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* 忽略 */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return !processAlive(pid);
}

/** 清理 Prisma 生成失败时残留的查询引擎临时文件（*.tmp*） */
function cleanupPrismaEngineTemp() {
  const clientDir = path.join(ROOT, 'node_modules', '.prisma', 'client');
  if (!existsSync(clientDir)) return;
  try {
    for (const entry of readdirSync(clientDir)) {
      if (entry.includes('.tmp') && /^query_engine-/.test(entry)) {
        rmSync(path.join(clientDir, entry), { force: true });
      }
    }
  } catch {
    /* 忽略 */
  }
}

/* ------------------------------ 构建新鲜度 ------------------------------ */
function latestSourceMtime() {
  const targets = [
    path.join(ROOT, 'src'),
    path.join(ROOT, 'prisma', 'schema.prisma'),
    path.join(ROOT, 'next.config.mjs'),
    path.join(ROOT, 'tailwind.config.ts'),
    path.join(ROOT, 'postcss.config.mjs'),
    path.join(ROOT, 'package.json'),
    path.join(ROOT, 'tsconfig.json'),
  ];
  let latest = 0;
  const walk = (target) => {
    if (!existsSync(target)) return;
    const info = statSync(target);
    if (info.isDirectory()) {
      for (const entry of readdirSync(target)) walk(path.join(target, entry));
    } else if (info.mtimeMs > latest) {
      latest = info.mtimeMs;
    }
  };
  for (const target of targets) walk(target);
  return latest;
}

/* -------------------------------- 各命令 -------------------------------- */
function openBrowser(url) {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

async function commandStop() {
  const pid = readPid();
  if (!pid || !processAlive(pid)) {
    if (existsSync(PID_FILE)) rmSync(PID_FILE, { force: true });
    console.log('没有正在运行的排班系统服务。');
    return;
  }
  console.log(`正在停止排班系统服务（PID ${pid}）...`);
  await stopProcess(pid);
  rmSync(PID_FILE, { force: true });
  console.log('服务已停止。');
}

async function commandStatus(options) {
  const pid = readPid();
  const alive = pid ? processAlive(pid) : false;
  const health = await waitForHealth(options.port, options.host, 2000).catch(() => null);
  console.log(`PID 文件：${pid ?? '(无)'}${alive ? '（进程存活）' : '（进程不存在）'}`);
  console.log(`端口 ${options.port}：${(await portInUse(options.port, options.host)) ? '已监听' : '未监听'}`);
  console.log(`健康检查：${health ? JSON.stringify(health) : '不可用'}`);
}

async function commandStart(options) {
  mkdirSync(LOG_DIR, { recursive: true });

  console.log('');
  console.log(`${C.bold}====================== 排班系统 一键启动 ======================${C.reset}`);
  console.log(`项目目录：${ROOT}`);
  console.log(`服务地址：http://${options.host}:${options.port}`);
  console.log('');

  /* 1. 运行环境 */
  step('检查运行环境');
  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split('.')[0]);
  if (major < 20) fail(`Node.js 版本过低（v${nodeVersion}），请升级到 20.11 或更高版本。`);
  ok(`Node.js v${nodeVersion}`);

  /* 2. 环境变量 */
  step('准备环境变量');
  const envMap = loadEnvFile();
  ok(`数据库：${envMap.DATABASE_URL ?? process.env.DATABASE_URL ?? '(未设置)'}`);
  const adminUser = envMap.INITIAL_ADMIN_USERNAME || process.env.INITIAL_ADMIN_USERNAME || 'admin';
  const baseUrl = (envMap.BASE_URL || process.env.BASE_URL || `http://${options.host}:${options.port}`).replace(/\/+$/, '');

  /* 3. 依赖 */
  if (!options.skipInstall) {
    step('检查依赖');
    if (existsSync(path.join(ROOT, 'node_modules', 'next', 'package.json'))) {
      ok('依赖已安装');
    } else {
      warn('首次运行：正在安装依赖（可能需要几分钟）...');
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      runSync(npm, ['install', '--no-audit', '--no-fund'], '依赖安装');
      ok('依赖安装完成');
    }
  }

  /* 4. 先停止上一次由启动器拉起的服务
        （Windows 上正在运行的服务会锁定 Prisma 查询引擎 DLL，导致 prisma generate 失败） */
  step('检查服务状态');
  const previousPid = readPid();
  if (previousPid && processAlive(previousPid)) {
    warn(`发现正在运行的服务（PID ${previousPid}），先停止它...`);
    await stopProcess(previousPid);
  }
  rmSync(PID_FILE, { force: true });
  cleanupPrismaEngineTemp();

  /* 5. 数据库 */
  step('同步数据库结构');
  runSync(process.execPath, [PRISMA_BIN, 'generate'], 'Prisma Client 生成', undefined, { tolerateFailure: true });
  runSync(process.execPath, [PRISMA_BIN, 'migrate', 'deploy'], '数据库迁移');
  ok('数据库已就绪');

  /* 6. 构建 */
  step('检查生产构建产物');
  const buildIdPath = path.join(ROOT, '.next', 'BUILD_ID');
  // 关键产物缺失说明上次构建不完整（例如构建中途失败），必须重新构建
  const requiredArtifacts = [
    '.next/BUILD_ID',
    '.next/prerender-manifest.json',
    '.next/routes-manifest.json',
    '.next/server/app',
    '.next/static',
  ];
  const missingArtifacts = requiredArtifacts.filter((relative) => !existsSync(path.join(ROOT, relative)));
  let needBuild = options.forceBuild || missingArtifacts.length > 0;
  if (missingArtifacts.length > 0) {
    warn(`构建产物不完整（缺少 ${missingArtifacts.join('、')}），需要重新构建`);
  }
  if (!needBuild) {
    const buildTime = statSync(buildIdPath).mtimeMs;
    const sourceTime = latestSourceMtime();
    if (buildTime < sourceTime) {
      needBuild = true;
      warn('检测到源码变更，需要重新构建');
    } else {
      ok(`构建产物已是最新（${new Date(buildTime).toLocaleString()}）`);
    }
  } else if (!options.forceBuild && missingArtifacts.length === 0) {
    warn('首次运行：需要构建生产版本');
  }

  if (needBuild) {
    warn('正在构建（约 1~3 分钟，请稍候）...');
    rmSync(path.join(ROOT, '.next'), { recursive: true, force: true });
    runSync(process.execPath, [NEXT_BIN, 'build'], '生产构建', productionEnv());
    ok('构建完成');
  }

  /* 7. 端口检查 */
  if (await portInUse(options.port, options.host)) {
    fail(
      `端口 ${options.port} 已被其他程序占用。`,
      `请关闭占用程序，或换端口启动：node scripts/launcher.mjs start --port 3100`,
    );
  }
  ok(`端口 ${options.port} 可用`);

  /* 8. 启动服务 */
  step('启动服务（生产模式：next start）');
  const serverArgs = [NEXT_BIN, 'start', '-p', String(options.port), '-H', options.host];
  const serverEnv = productionEnv();
  let child;

  if (options.background) {
    rmSync(OUT_LOG, { force: true });
    rmSync(ERR_LOG, { force: true });
    const out = openSync(OUT_LOG, 'a');
    const err = openSync(ERR_LOG, 'a');
    child = spawn(process.execPath, serverArgs, {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', out, err],
      env: serverEnv,
    });
    child.unref();
  } else {
    child = spawn(process.execPath, serverArgs, { cwd: ROOT, stdio: 'inherit', env: serverEnv });
  }

  writeFileSync(PID_FILE, String(child.pid), 'ascii');

  const health = await waitForHealth(options.port, options.host, options.background ? 120000 : 60000);
  if (!health) {
    bad('服务未能在限定时间内就绪，最近日志：');
    for (const logFile of [OUT_LOG, ERR_LOG]) {
      if (!existsSync(logFile)) continue;
      const lines = readFileSync(logFile, 'utf8').split(/\r?\n/).slice(-25);
      for (const line of lines) if (line.trim()) console.log(`    ${C.gray}${line}${C.reset}`);
    }
    try {
      process.kill(child.pid, 'SIGKILL');
    } catch {
      /* 忽略 */
    }
    rmSync(PID_FILE, { force: true });
    fail('服务启动失败。');
  }

  const url = `http://${options.host}:${options.port}`;
  const openUrl = `${baseUrl.startsWith('http') && !options.background ? baseUrl : url}${options.open}`;
  console.log('');
  ok(`服务已就绪：${url}`);
  ok(`管理员登录：${url}/admin/login   （账号：${adminUser}）`);
  ok(`填写端入口：${url}/fill          （使用任务专属链接 + 填写密码）`);
  ok(`健康检查：  ${url}/api/health`);
  if (options.background) ok(`运行日志：  ${OUT_LOG}`);
  console.log('');

  if (options.browser) {
    openBrowser(`${url}${options.open}`);
    ok(`已打开浏览器：${url}${options.open}`);
  } else {
    ok(`浏览器未自动打开，请手动访问：${url}${options.open}`);
  }
  void openUrl;

  if (options.background) {
    console.log(`${C.gray}服务已在后台运行。停止：node scripts/launcher.mjs stop（或双击 停止排班系统.cmd）${C.reset}`);
    console.log('');
    return;
  }

  console.log(`${C.gray}----------------------------------------------------------------${C.reset}`);
  console.log(' 服务正在运行。按 Ctrl+C 停止服务。');
  console.log(`${C.gray}----------------------------------------------------------------${C.reset}`);
  console.log('');

  const shutdown = () => {
    console.log('');
    step('正在停止服务...');
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {
      /* 忽略 */
    }
    rmSync(PID_FILE, { force: true });
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  child.on('exit', (code) => {
    rmSync(PID_FILE, { force: true });
    console.log(`\n服务进程已退出（退出码 ${code ?? 0}）。`);
    process.exit(code ?? 0);
  });
}

/* --------------------------------- 入口 --------------------------------- */
const options = parseArgs(process.argv.slice(2));

switch (options.command) {
  case 'start':
    await commandStart(options);
    break;
  case 'stop':
    await commandStop();
    break;
  case 'status':
    await commandStatus(options);
    break;
  case 'restart':
    await commandStop();
    await commandStart(options);
    break;
  default:
    console.log('用法：node scripts/launcher.mjs <start|stop|status|restart> [选项]');
    console.log('选项：--port 3000 --host 127.0.0.1 --no-browser --force-build --skip-install --background --open /admin/login');
    process.exit(1);
}
