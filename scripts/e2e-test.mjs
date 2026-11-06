// =============================================================================
// 端到端验证脚本（不依赖测试框架）：
//   node --experimental-strip-types scripts/e2e-test.mjs
// 覆盖：
//   1. 健康检查 / 仅管理员登录入口 / 无普通用户注册登录入口
//   2. 通过真实 Server Action 创建排班任务（校验后台表单链路）
//   3. 管理员登录（错误密码被拒、正确密码下发 HttpOnly 会话 Cookie）
//   4. 填写端：密码校验 -> 读取任务 -> 提交校验（漏填/缺理由被拒）-> 成功提交 -> 同姓名修改覆盖
//   5. 名单上传（XLSX 解析）-> 未填写名单导出 -> 理由汇总导出
//   6. 截止确认锁定 -> 锁定后提交被拒 -> 解锁（均记入日志）
//   7. 自动匹配（全部满足 -> 日历/姓名排班表导出；需求过高 -> 缺口报告）
//   8. 算法可复现性（同一种子结果一致）+ 绝不安排“无法排班”+ 公平规则 + 同日单班约束
// =============================================================================

import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const prisma = new PrismaClient();
const ARTIFACTS = path.join(process.cwd(), '.e2e-artifacts');

let passed = 0;
const failures = [];
const createdTaskIds = [];

function ok(name, extra = '') {
  passed += 1;
  console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ''}`);
}

function assert(name, condition, detail = '') {
  if (condition) {
    ok(name, detail);
    return;
  }
  failures.push(`${name}: ${detail || '断言失败'}`);
  console.log(`  FAIL  ${name} — ${detail}`);
}

/* ------------------------------ Cookie 容器 ------------------------------ */
const jar = new Map();

function storeCookies(response) {
  for (const cookie of response.headers.getSetCookie?.() ?? []) {
    const [pair] = cookie.split(';');
    const index = pair.indexOf('=');
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (value === '' || /Max-Age=0/i.test(cookie)) jar.delete(name);
    else jar.set(name, value);
  }
}

function cookieHeader() {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function request(pathname, options = {}) {
  const headers = new Headers(options.headers ?? {});
  const cookies = cookieHeader();
  if (cookies) headers.set('cookie', cookies);
  if (!headers.has('origin')) headers.set('origin', BASE);
  const response = await fetch(`${BASE}${pathname}`, { ...options, headers, redirect: 'manual' });
  storeCookies(response);
  return response;
}

async function getText(pathname) {
  const response = await request(pathname);
  return { status: response.status, text: await response.text(), headers: response.headers };
}

async function readJson(response) {
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: response.status, json, text };
}

async function getJson(pathname) {
  return readJson(await request(pathname));
}

async function postJson(pathname, body) {
  return readJson(
    await request(pathname, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

/* --------------------- Server Action 表单解析与提交 ---------------------- */

/** 解析页面中的 Server Action 表单（依据服务端写入的 data-action 标记定位） */
export function parseActionForms(html) {
  const forms = [];
  for (const chunk of html.split('<form').slice(1)) {
    const idMatch = chunk.match(/\$ACTION_(\d+):0" value="\{&quot;id&quot;:&quot;([0-9a-f]+)/);
    if (!idMatch) continue;
    const actionId = idMatch[2];
    const refName = `$ACTION_REF_${idMatch[1]}`;
    const actionKey = chunk.match(/\$ACTION_KEY" value="([^"]+)"/)?.[1] ?? '';
    const argsRaw = (chunk.match(new RegExp(`\\$ACTION_${idMatch[1]}:1" value="([^"]*)"`))?.[1] ?? '[{}]').replace(
      /&quot;/g,
      '"',
    );
    let args = [{}];
    try {
      args = JSON.parse(argsRaw);
    } catch {
      /* 保持默认 */
    }
    forms.push({
      actionId,
      actionKey,
      args,
      refName,
      actionName: chunk.match(/name="data-action" value="([^"]+)"/)?.[1] ?? '',
      fieldNames: [...new Set([...chunk.matchAll(/name="([^"$][^"]*)"/g)].map((match) => match[1]))],
    });
  }
  return forms;
}

function findActionByName(forms, actionName) {
  const found = forms.find((form) => form.actionName === actionName);
  if (!found) {
    console.log(
      '    [debug] 可用表单：',
      forms.map((form) => `${form.actionName || '(无标记)'}[${form.fieldNames.join(',')}]`).join(' | '),
    );
    throw new Error(`未找到标记为 ${actionName} 的表单`);
  }
  return found;
}

async function submitAction(pagePath, actionForm, fields = {}) {
  const form = new FormData();
  // 与浏览器一致的“绑定动作”提交格式（useActionState + createServerReference）
  const refName = actionForm.refName ?? '$ACTION_REF_1';
  const index = refName.replace('$ACTION_REF_', '');
  form.set(refName, '');
  form.set(`$ACTION_${index}:0`, JSON.stringify({ id: actionForm.actionId, bound: '$@1' }));
  form.set(`$ACTION_${index}:1`, JSON.stringify(actionForm.args ?? [{}]));
  if (actionForm.actionKey) form.set('$ACTION_KEY', actionForm.actionKey);
  for (const [key, value] of Object.entries(fields)) {
    if (value instanceof File) form.set(key, value);
    else if (Array.isArray(value)) value.forEach((item) => form.append(key, item));
    else form.set(key, String(value));
  }

  const response = await request(pagePath, {
    method: 'POST',
    body: form,
    headers: { accept: 'text/x-component' },
  });
  const body = await response.text();
  return { status: response.status, body };
}

/* --------------------------------- 主流程 --------------------------------- */

async function main() {
  mkdirSync(ARTIFACTS, { recursive: true });
  console.log(`\n=== 排班系统端到端验证 ===\n目标: ${BASE}\n`);

  // 清理上次异常中断遗留的测试任务，保证可重复运行
  const stale = await prisma.task.deleteMany({
    where: { OR: [{ name: { startsWith: 'E2E ' } }, { name: { startsWith: 'PROBE ' } }] },
  });
  if (stale.count > 0) console.log(`（已清理上次遗留测试任务 ${stale.count} 个）\n`);

  /* 1. 健康检查与入口 */
  console.log('[1] 健康检查与入口检查');
  const health = await getJson('/api/health');
  assert('健康检查返回 200', health.status === 200, `status=${health.status}`);
  assert('数据库连接正常', health.json?.database === 'up', JSON.stringify(health.json));

  const home = await request('/');
  assert('根路径重定向到管理员登录', [307, 308, 302].includes(home.status), `status=${home.status}`);

  const loginPage = await getText('/admin/login');
  assert('管理员登录页可访问', loginPage.status === 200);
  assert('登录页含“管理员登录”', loginPage.text.includes('管理员登录'));
  assert(
    '登录页无注册入口',
    !/href="[^"]*register|name="(register|signup|confirmPassword)"|<a[^>]*>\s*注册/i.test(loginPage.text),
  );

  const fillIndex = await getText('/fill');
  assert('填写入口说明页可访问', fillIndex.status === 200 && fillIndex.text.includes('排班意愿填写入口'));

  const adminGuard = await request('/admin/dashboard');
  assert('未登录访问后台被重定向', [307, 308, 302].includes(adminGuard.status), `status=${adminGuard.status}`);

  /* 2. 管理员登录 */
  console.log('\n[2] 管理员登录与会话');
  const wrong = await postJson('/api/admin/auth/login', { username: 'admin', password: 'definitely-wrong' });
  assert('错误密码被拒绝或被限流', wrong.status === 401 || wrong.status === 429, `status=${wrong.status}`);

  const correctPassword = process.env.INITIAL_ADMIN_PASSWORD || 'Admin@12345';
  let good = await postJson('/api/admin/auth/login', {
    username: process.env.INITIAL_ADMIN_USERNAME || 'admin',
    password: correctPassword,
  });
  if (good.status === 429) {
    const waitSeconds = Math.min(Number(good.json?.error?.match(/(\d+)\s*秒/)?.[1] ?? 10) + 2, 320);
    console.log(`      [提示] 登录接口已触发限流（安全特性），等待 ${waitSeconds}s 后重试…`);
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    good = await postJson('/api/admin/auth/login', {
      username: process.env.INITIAL_ADMIN_USERNAME || 'admin',
      password: correctPassword,
    });
  }
  assert('正确密码登录成功', good.status === 200 && good.json?.ok === true, JSON.stringify(good.json));
  if (good.status !== 200) throw new Error('管理员登录失败，无法继续端到端验证（请重启服务后重跑）');
  assert('会话 Cookie 名为 sched_admin', jar.has('sched_admin'));

  const dashboard = await getText('/admin/dashboard');
  assert('登录后可访问任务列表', dashboard.status === 200 && dashboard.text.includes('排班任务'));

  /* 3. 创建任务 */
  console.log('\n[3] 通过后台表单创建排班任务（真实 Server Action）');
  const stamp = Date.now();
  const taskName = `E2E 排班任务 ${stamp}`;
  const dates = ['2026-06-01', '2026-06-02'];

  const newForms = parseActionForms((await getText('/admin/tasks/new')).text);
  assert('解析到新建任务表单的 Server Action', newForms.length >= 1, `forms=${newForms.length}`);
  const createForm = newForms[0];

  const baseRule = {
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    eveOfWorkday: false,
    excludeHolidays: false,
    includeDates: [],
    excludeDates: [],
  };
  const createDraft = {
    name: taskName,
    description: '端到端验证创建的任务',
    dateStart: dates[0],
    dateEnd: dates[1],
    fillDeadline: '2027-05-30T18:00',
    fillPassword: 'e2e-pass-1234',
    allowSameDayMultiple: false,
    areaCoverage: 'exclusive',
    maxAreasPerPerson: 1,
    weekend: [0, 6],
    calendar: { useApi: false },
    shifts: [
      {
        name: '白班',
        startTime: '08:00',
        endTime: '16:00',
        dateRule: baseRule,
        areas: [{ name: '默认区域', groupName: '默认组', defaultHeadcount: 1 }],
      },
      {
        name: '夜班',
        startTime: '16:00',
        endTime: '23:59',
        dateRule: baseRule,
        areas: [{ name: '默认区域', groupName: '默认组', defaultHeadcount: 1 }],
      },
    ],
    overrides: [],
  };

  const createResult = await submitAction('/admin/tasks/new', createForm, { draft: JSON.stringify(createDraft) });
  assert('创建任务请求被接受', [200, 303].includes(createResult.status), `status=${createResult.status}`);

  const createdTask = await prisma.task.findFirst({
    where: { name: taskName },
    include: { shifts: true, requirements: true },
  });
  assert('数据库中已创建任务', Boolean(createdTask), taskName);
  if (!createdTask) throw new Error('任务未创建，后续验证无法继续');
  createdTaskIds.push(createdTask.id);
  assert(
    '班次与每日需求已保存',
    createdTask.shifts.length === 2 && createdTask.requirements.length === 4,
    `shifts=${createdTask.shifts.length} requirements=${createdTask.requirements.length}`,
  );
  assert('填写密码以哈希存储', createdTask.fillPasswordHash.startsWith('scrypt$'));
  assert('填写链接使用 UUID', /^[0-9a-f-]{36}$/.test(createdTask.publicToken), createdTask.publicToken);
  assert('任务初始状态为草稿', createdTask.status === 'draft', createdTask.status);

  /* 4. 发布任务 */
  console.log('\n[4] 发布任务（生成链接与密码）');
  let detailForms = parseActionForms((await getText(`/admin/tasks/${createdTask.id}`)).text);
  assert('任务详情页解析到多个 Server Action 表单', detailForms.length >= 5, `forms=${detailForms.length}`);
  const publishResult = await submitAction(`/admin/tasks/${createdTask.id}`, findActionByName(detailForms, 'publish'), {
    taskId: createdTask.id,
    fillPassword: 'e2e-pass-1234',
  });
  assert('发布请求被接受', publishResult.status === 200, `status=${publishResult.status}`);
  const afterPublish = await prisma.task.findUnique({ where: { id: createdTask.id } });
  assert('任务状态变为已发布', afterPublish.status === 'published', afterPublish.status);
  const detailHtml = (await getText(`/admin/tasks/${createdTask.id}`)).text;
  assert('详情页展示填写链接与密码区', detailHtml.includes('/fill/') && detailHtml.includes('重置填写密码'));

  /* 5. 填写端 */
  console.log('\n[5] 填写端（密码 -> 读取 -> 校验 -> 提交 -> 修改）');
  const token = afterPublish.publicToken;
  const gate = await getText(`/fill/${token}`);
  assert('填写链接可打开', gate.status === 200 && gate.text.includes(taskName));

  const badToken = await getText('/fill/00000000-0000-0000-0000-000000000000');
  assert('无效链接给出提示', badToken.status === 200 && badToken.text.includes('链接无效'));

  const wrongPassword = await postJson(`/api/fill/${token}/auth`, { password: 'nope' });
  assert('填写密码错误被拒绝', wrongPassword.status === 401, `status=${wrongPassword.status}`);

  const authorized = await postJson(`/api/fill/${token}/auth`, { password: 'e2e-pass-1234' });
  assert('填写密码正确可进入', authorized.status === 200 && authorized.json?.ok === true, JSON.stringify(authorized.json));
  assert('填写通行凭证 Cookie 已下发', jar.has('sched_fill'));

  const taskData = await getJson(`/api/fill/${token}/task`);
  const cells = taskData.json?.task?.cells ?? [];
  assert('可读取任务与需求单元格（4 个）', taskData.status === 200 && cells.length === 4, `cells=${cells.length}`);
  assert('未上传名单时 hasRoster=false', taskData.json?.task?.hasRoster === false);

  const incomplete = await postJson(`/api/fill/${token}/submit`, {
    name: '甲',
    selections: cells.slice(0, 3).map((cell) => ({ date: cell.date, shiftId: cell.shiftId, choice: 'preferred' })),
  });
  assert('未完成全部三选一被拒绝', incomplete.status === 422, `status=${incomplete.status} ${incomplete.json?.error ?? ''}`);

  const missingReason = await postJson(`/api/fill/${token}/submit`, {
    name: '甲',
    selections: cells.map((cell, index) => ({
      date: cell.date,
      shiftId: cell.shiftId,
      choice: index === 0 ? 'unavailable' : 'preferred',
      reason: '',
    })),
  });
  assert(
    '选择“无法排班”未填理由被拒绝',
    missingReason.status === 422 && /理由/.test(missingReason.json?.error ?? ''),
    missingReason.json?.error ?? '',
  );

  const isFirstShift = (cell) => cells.filter((item) => item.date === cell.date)[0]?.shiftId === cell.shiftId;
  const personA = {
    name: '甲',
    selections: cells.map((cell) => ({
      date: cell.date,
      shiftId: cell.shiftId,
      choice: isFirstShift(cell) && cell.date === dates[0] ? 'unavailable' : 'preferred',
      reason: isFirstShift(cell) && cell.date === dates[0] ? '当天已有其他安排' : '',
    })),
  };
  const personB = {
    name: '乙',
    selections: cells.map((cell) => ({
      date: cell.date,
      shiftId: cell.shiftId,
      choice: isFirstShift(cell) ? 'backup' : 'preferred',
      reason: '',
    })),
  };
  const personC = {
    name: '丙',
    selections: cells.map((cell) => ({
      date: cell.date,
      shiftId: cell.shiftId,
      choice: isFirstShift(cell) ? 'preferred' : 'backup',
      reason: '',
    })),
  };

  const submittedA = await postJson(`/api/fill/${token}/submit`, personA);
  assert('完整填写后提交成功', submittedA.status === 200 && submittedA.json?.ok === true, JSON.stringify(submittedA.json));
  assert(
    '提交统计正确',
    submittedA.json?.total === 4 && submittedA.json?.unavailable === 1,
    `total=${submittedA.json?.total} unavailable=${submittedA.json?.unavailable}`,
  );

  const submittedB = await postJson(`/api/fill/${token}/submit`, personB);
  assert('第二个人也能提交', submittedB.status === 200 && submittedB.json?.ok === true);

  const resubmit = await postJson(`/api/fill/${token}/submit`, personA);
  assert('同一姓名可再次提交覆盖', resubmit.status === 200);
  const submissionCount = await prisma.submission.count({ where: { taskId: createdTask.id } });
  assert('同一姓名未产生重复记录', submissionCount === 2, `count=${submissionCount}`);

  const existing = await getJson(`/api/fill/${token}/task?name=${encodeURIComponent('甲')}`);
  assert(
    '可按姓名回填已提交内容',
    existing.json?.existing?.selections?.length === 4,
    `selections=${existing.json?.existing?.selections?.length}`,
  );

  /* 6. 名单上传与导出 */
  console.log('\n[6] 名单上传（XLSX）与导出');
  const { buildXlsx } = await import('../src/lib/xlsx.ts');
  const rosterRows = [
    ['姓名', '工号', '部门'],
    ['甲', 'A001', '内科'],
    ['乙', 'A002', '外科'],
    ['丙', 'A003', '儿科'],
    ['丁', 'A004', '检验科'],
  ];
  const xlsxBuffer = await buildXlsx([{ name: '名单', rows: rosterRows, headerRow: true }]);
  writeFileSync(path.join(ARTIFACTS, 'roster.xlsx'), xlsxBuffer);

  detailForms = parseActionForms((await getText(`/admin/tasks/${createdTask.id}`)).text);
  const rosterResult = await submitAction(`/admin/tasks/${createdTask.id}`, findActionByName(detailForms, 'upload-roster'), {
    taskId: createdTask.id,
    mode: 'replace',
    file: new File([xlsxBuffer], 'roster.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  });
  assert('名单上传请求被接受', rosterResult.status === 200, `status=${rosterResult.status}`);

  const rosterCount = await prisma.rosterEntry.count({ where: { taskId: createdTask.id } });
  assert('XLSX 名单解析并入库（4 人）', rosterCount === 4, `count=${rosterCount}`);
  const onRosterMarked = await prisma.submission.count({ where: { taskId: createdTask.id, onRoster: true } });
  assert('已提交人员被标记为名单内', onRosterMarked === 2, `onRoster=${onRosterMarked}`);

  const unfilledResponse = await request(`/api/admin/tasks/${createdTask.id}/roster/unfilled?format=csv`);
  const unfilledCsv = await unfilledResponse.text();
  assert('未填写名单导出成功且包含“丁”', unfilledResponse.status === 200 && unfilledCsv.includes('丁'));
  assert('未填写名单不含已填写人员', !unfilledCsv.includes('甲'));
  writeFileSync(path.join(ARTIFACTS, 'unfilled.csv'), unfilledCsv);

  const templateXlsx = await request(`/api/admin/tasks/${createdTask.id}/roster/template?format=xlsx`);
  assert(
    '名单模板（XLSX）可下载',
    templateXlsx.status === 200 && String(templateXlsx.headers.get('content-type')).includes('spreadsheetml'),
  );
  writeFileSync(path.join(ARTIFACTS, 'roster-template.xlsx'), Buffer.from(await templateXlsx.arrayBuffer()));

  const reasonsResponse = await request(`/api/admin/tasks/${createdTask.id}/reasons?format=csv`);
  const reasonsCsv = await reasonsResponse.text();
  assert('“无法排班”理由导出成功', reasonsResponse.status === 200 && reasonsCsv.includes('当天已有其他安排'));
  writeFileSync(path.join(ARTIFACTS, 'reasons.csv'), reasonsCsv);

  const detailWithRoster = (await getText(`/admin/tasks/${createdTask.id}`)).text;
  assert('详情页标出未填写人员', detailWithRoster.includes('未填写人员'));
  assert('详情页展示名单外提交标记', detailWithRoster.includes('名单外提交'));

  /* 7. 截止确认、锁定与解锁 */
  console.log('\n[7] 截止确认 / 锁定 / 解锁');
  detailForms = parseActionForms((await getText(`/admin/tasks/${createdTask.id}`)).text);
  const confirmResult = await submitAction(`/admin/tasks/${createdTask.id}`, findActionByName(detailForms, 'confirm'), {
    taskId: createdTask.id,
  });
  assert('截止确认请求被接受', confirmResult.status === 200, `status=${confirmResult.status}`);
  const confirmedTask = await prisma.task.findUnique({ where: { id: createdTask.id } });
  assert('任务状态变为已截止确认', confirmedTask.status === 'confirmed', confirmedTask.status);
  const lockedCount = await prisma.submission.count({ where: { taskId: createdTask.id, status: 'locked' } });
  assert('提交记录被锁定', lockedCount === 2, `locked=${lockedCount}`);

  const lockedSubmit = await postJson(`/api/fill/${token}/submit`, personC);
  assert('锁定后提交被拒绝', lockedSubmit.status === 403, `status=${lockedSubmit.status}`);

  detailForms = parseActionForms((await getText(`/admin/tasks/${createdTask.id}`)).text);
  await submitAction(`/admin/tasks/${createdTask.id}`, findActionByName(detailForms, 'unlock'), { taskId: createdTask.id });
  const unlockedTask = await prisma.task.findUnique({ where: { id: createdTask.id } });
  assert('解锁后回到已发布状态', unlockedTask.status === 'published', unlockedTask.status);
  const auditCount = await prisma.auditLog.count({
    where: { taskId: createdTask.id, action: { in: ['task.confirm', 'task.unlock'] } },
  });
  assert('确认与解锁均写入操作日志', auditCount >= 2, `logs=${auditCount}`);

  /* 8. 自动匹配 */
  console.log('\n[8] 自动匹配排班（全部满足场景）');
  const thirdSubmit = await postJson(`/api/fill/${token}/submit`, personC);
  assert('第三个人（丙）提交成功', thirdSubmit.status === 200 && thirdSubmit.json?.ok === true, JSON.stringify(thirdSubmit.json));
  detailForms = parseActionForms((await getText(`/admin/tasks/${createdTask.id}`)).text);
  await submitAction(`/admin/tasks/${createdTask.id}`, findActionByName(detailForms, 'confirm'), { taskId: createdTask.id });
  const readyTask = await prisma.task.findUnique({ where: { id: createdTask.id } });
  assert('确认后状态为 confirmed（可匹配）', readyTask.status === 'confirmed', readyTask.status);

  detailForms = parseActionForms((await getText(`/admin/tasks/${createdTask.id}`)).text);
  const matchResult = await submitAction(`/admin/tasks/${createdTask.id}`, findActionByName(detailForms, 'match'), {
    taskId: createdTask.id,
    seed: '20260601',
  });
  assert('匹配请求被接受', matchResult.status === 200, `status=${matchResult.status}`);

  const matchedTask = await prisma.task.findUnique({ where: { id: createdTask.id }, include: { assignments: true } });
  assert('匹配可行（matchFeasible=true）', matchedTask.matchFeasible === true, `summary=${matchedTask.matchSummary}`);
  assert('生成 4 条排班结果', matchedTask.assignments.length === 4, `assignments=${matchedTask.assignments.length}`);
  assert('随机种子被记录', matchedTask.matchSeed === 20260601, `seed=${matchedTask.matchSeed}`);

  const unavailableKeys = new Set(
    (
      await prisma.selection.findMany({
        where: { taskId: createdTask.id, choice: 'unavailable' },
        select: { submissionId: true, date: true, shiftId: true },
      })
    ).map((row) => `${row.submissionId}|${row.date}|${row.shiftId}`),
  );
  const violation = matchedTask.assignments.find((assignment) =>
    unavailableKeys.has(`${assignment.submissionId}|${assignment.date}|${assignment.shiftId}`),
  );
  assert('绝不安排“无法排班”的班次', !violation, violation ? JSON.stringify(violation) : '无违规');

  const sameDayCount = new Map();
  for (const assignment of matchedTask.assignments) {
    const key = `${assignment.submissionId}|${assignment.date}`;
    sameDayCount.set(key, (sameDayCount.get(key) ?? 0) + 1);
  }
  assert('默认同一人同一天最多一个班次', [...sameDayCount.values()].every((count) => count === 1));

  const calendarResponse = await request(`/api/admin/tasks/${createdTask.id}/result?format=csv&sheet=calendar`);
  const calendarCsv = await calendarResponse.text();
  assert('日历排班表导出成功', calendarResponse.status === 200 && calendarCsv.includes('安排人员'));
  writeFileSync(path.join(ARTIFACTS, 'result-calendar.csv'), calendarCsv);

  const allXlsx = await request(`/api/admin/tasks/${createdTask.id}/result?format=xlsx&sheet=all`);
  assert(
    '姓名排班表/全部结果 XLSX 导出成功',
    allXlsx.status === 200 && String(allXlsx.headers.get('content-type')).includes('spreadsheetml'),
  );
  writeFileSync(path.join(ARTIFACTS, 'result-all.xlsx'), Buffer.from(await allXlsx.arrayBuffer()));

  const resultPage = await getText(`/admin/tasks/${createdTask.id}/result`);
  assert(
    '结果页包含日历排班表与姓名排班表',
    resultPage.status === 200 && resultPage.text.includes('日历排班表') && resultPage.text.includes('姓名排班表'),
  );

  /* 9. 算法单元验证 */
  console.log('\n[9] 匹配算法：可复现性与公平规则');
  const { matchSchedule } = await import('../src/lib/matching.ts');
  const makeSubmissions = () => [
    {
      id: 's1',
      name: 'A',
      submittedAt: new Date('2026-05-01T01:00:00Z'),
      historyCount: 1,
      choices: new Map([['2026-06-01|a', { choice: 'preferred' }]]),
    },
    {
      id: 's2',
      name: 'B',
      submittedAt: new Date('2026-05-01T02:00:00Z'),
      historyCount: 0,
      choices: new Map([['2026-06-01|a', { choice: 'preferred' }]]),
    },
    {
      id: 's3',
      name: 'C',
      submittedAt: new Date('2026-05-01T03:00:00Z'),
      historyCount: 5,
      choices: new Map([['2026-06-01|a', { choice: 'unavailable', reason: 'x' }]]),
    },
  ];
  const baseInput = {
    shifts: [{ id: 'a', name: '白班', startTime: '08:00', endTime: '16:00' }],
    requirements: [{ date: '2026-06-01', shiftId: 'a', areaId: 'ar-a', areaName: 'A 区', groupName: 'G', headcount: 2 }],
    allowSameDayMultiple: false,
    seed: 4242,
  };
  const runA = matchSchedule({ ...baseInput, submissions: makeSubmissions() });
  const runB = matchSchedule({ ...baseInput, submissions: makeSubmissions() });
  assert(
    '同一种子结果完全一致（可复现）',
    JSON.stringify(runA.assignments) === JSON.stringify(runB.assignments),
    runA.assignments.map((item) => item.name).join(','),
  );
  assert(
    '公平规则：历史排班少者优先，且不安排“无法排班”的人',
    !runA.assignments.some((item) => item.name === 'C') && runA.assignments.some((item) => item.name === 'B'),
    runA.assignments.map((item) => `${item.name}(${item.historyCount})`).join(','),
  );

  const overlapInput = {
    areaCoverage: 'exclusive',
    maxAreasPerPerson: 1,
    shifts: [
      { id: 'a', name: '白班', startTime: '08:00', endTime: '16:00' },
      { id: 'b', name: '夜班', startTime: '16:00', endTime: '23:59' },
    ],
    requirements: [
      { date: '2026-06-01', shiftId: 'a', areaId: 'ar-a', areaName: 'A 区', groupName: 'G', headcount: 1 },
      { date: '2026-06-01', shiftId: 'b', areaId: 'ar-b', areaName: 'B 区', groupName: 'G', headcount: 1 },
    ],
    submissions: [
      {
        id: 'x1',
        name: 'X',
        submittedAt: new Date('2026-05-01T01:00:00Z'),
        historyCount: 0,
        choices: new Map([
          ['2026-06-01|a', { choice: 'preferred' }],
          ['2026-06-01|b', { choice: 'preferred' }],
        ]),
      },
    ],
    seed: 7,
  };
  const strict = matchSchedule({ ...overlapInput, allowSameDayMultiple: false });
  assert('未开启同日多班时产生缺口', !strict.feasible && strict.gaps.length === 1, `gaps=${strict.gaps.length}`);
  const permissive = matchSchedule({ ...overlapInput, allowSameDayMultiple: true });
  assert(
    '开启同日多班且时间不重叠时可同日两班',
    permissive.feasible && permissive.assignments.length === 2,
    JSON.stringify(permissive.assignments.map((item) => item.shiftName)),
  );
  const overlapSame = matchSchedule({
    ...overlapInput,
    allowSameDayMultiple: true,
    shifts: [
      { id: 'a', name: '白班', startTime: '08:00', endTime: '16:00' },
      { id: 'b', name: '重叠班', startTime: '12:00', endTime: '20:00' },
    ],
  });
  assert('时间重叠时即使开启同日多班也不行', !overlapSame.feasible, `gaps=${overlapSame.gaps.length}`);

  /* 10. 缺口报告场景 */
  console.log('\n[10] 缺口报告场景（需求大于可用意愿）');
  const gapTaskName = `E2E 缺口任务 ${stamp}`;
  const gapForms = parseActionForms((await getText('/admin/tasks/new')).text);
  const gapDraft = {
    name: gapTaskName,
    description: '缺口场景',
    dateStart: '2026-07-01',
    dateEnd: '2026-07-01',
    fillPassword: 'gap-pass-1234',
    allowSameDayMultiple: false,
    areaCoverage: 'exclusive',
    maxAreasPerPerson: 1,
    weekend: [0, 6],
    calendar: { useApi: false },
    shifts: [
      {
        name: '全天班',
        startTime: '08:00',
        endTime: '20:00',
        dateRule: {
              weekdays: [0, 1, 2, 3, 4, 5, 6],
              eveOfWorkday: false,
              excludeHolidays: false,
              includeDates: [],
              excludeDates: [],
            },
        areas: [{ name: '默认区域', groupName: '默认组', defaultHeadcount: 3 }],
      },
    ],
    overrides: [],
  };
  await submitAction('/admin/tasks/new', gapForms[0], { draft: JSON.stringify(gapDraft) });

  const gapTask = await prisma.task.findFirst({ where: { name: gapTaskName } });
  assert('缺口任务已创建', Boolean(gapTask));
  if (gapTask) {
    createdTaskIds.push(gapTask.id);
    let formSet = parseActionForms((await getText(`/admin/tasks/${gapTask.id}`)).text);
    await submitAction(`/admin/tasks/${gapTask.id}`, findActionByName(formSet, 'publish'), {
      taskId: gapTask.id,
      fillPassword: 'gap-pass-1234',
    });
    const gapPublished = await prisma.task.findUnique({ where: { id: gapTask.id } });
    assert('缺口任务已发布', gapPublished.status === 'published', gapPublished.status);

    await postJson(`/api/fill/${gapPublished.publicToken}/auth`, { password: 'gap-pass-1234' });
    const gapTaskData = await getJson(`/api/fill/${gapPublished.publicToken}/task`);
    await postJson(`/api/fill/${gapPublished.publicToken}/submit`, {
      name: '独苗',
      selections: gapTaskData.json.task.cells.map((cell) => ({
        date: cell.date,
        shiftId: cell.shiftId,
        choice: 'preferred',
      })),
    });

    formSet = parseActionForms((await getText(`/admin/tasks/${gapTask.id}`)).text);
    await submitAction(`/admin/tasks/${gapTask.id}`, findActionByName(formSet, 'confirm'), { taskId: gapTask.id });
    formSet = parseActionForms((await getText(`/admin/tasks/${gapTask.id}`)).text);
    await submitAction(`/admin/tasks/${gapTask.id}`, findActionByName(formSet, 'match'), { taskId: gapTask.id, seed: '777' });

    const gapAfter = await prisma.task.findUnique({ where: { id: gapTask.id }, include: { assignments: true } });
    assert('存在缺口时 matchFeasible=false', gapAfter.matchFeasible === false, `summary=${gapAfter.matchSummary}`);
    assert('存在缺口时不输出最终排班结果', gapAfter.assignments.length === 0, `assignments=${gapAfter.assignments.length}`);

    const gapCsvResponse = await request(`/api/admin/tasks/${gapTask.id}/result?format=csv&sheet=gaps`);
    const gapCsv = await gapCsvResponse.text();
    assert(
      '缺口报告可导出且含需求/已满足/缺口人数',
      gapCsvResponse.status === 200 && gapCsv.includes('缺口人数') && gapCsv.includes('已满足人数'),
    );
    assert('缺口报告给出可能原因', /可能原因/.test(gapCsv) && /无法排班|少于需求|无任何用户/.test(gapCsv));
    writeFileSync(path.join(ARTIFACTS, 'gap-report.csv'), gapCsv);

    const gapResultPage = await getText(`/admin/tasks/${gapTask.id}/result`);
    assert('结果页展示缺口报告', gapResultPage.status === 200 && gapResultPage.text.includes('缺口报告'));
  }

  /* 11. 回归：只有 1 个班次时也能创建（字段位置错位 bug） */
  console.log('\n[11] 回归测试：单班次任务');
  const singleFormHtml = (await getText('/admin/tasks/new')).text;
  assert('新建任务页可解析到表单', parseActionForms(singleFormHtml).length >= 1);

  const singleTaskName = `E2E 单班次任务 ${stamp}`;
  const singleDraft = {
    name: singleTaskName,
    description: '只有 1 个班次的任务（回归用例）',
    dateStart: '2026-09-01',
    dateEnd: '2026-09-02',
    fillDeadline: '2027-05-30T18:00',
    fillPassword: 'single-pass-1234',
    allowSameDayMultiple: false,
    areaCoverage: 'exclusive',
    maxAreasPerPerson: 1,
    weekend: [0, 6],
    calendar: { useApi: false },
    shifts: [
      {
        name: '全天班',
        startTime: '08:00',
        endTime: '20:00',
        dateRule: {
              weekdays: [0, 1, 2, 3, 4, 5, 6],
              eveOfWorkday: false,
              excludeHolidays: false,
              includeDates: [],
              excludeDates: [],
            },
        areas: [{ name: '默认区域', groupName: '默认组', defaultHeadcount: 1 }],
      },
    ],
    overrides: [],
  };
  const singleCreate = await submitAction('/admin/tasks/new', parseActionForms(singleFormHtml)[0], {
    draft: JSON.stringify(singleDraft),
  });
  assert('单班次：创建请求被接受', [200, 303].includes(singleCreate.status), `status=${singleCreate.status}`);

  const singleTask = await prisma.task.findFirst({
    where: { name: singleTaskName },
    include: { shifts: true, requirements: true },
  });
  assert('单班次：任务已创建', Boolean(singleTask), singleTaskName);
  if (singleTask) {
    createdTaskIds.push(singleTask.id);
    assert('单班次：班次被正确保存（不会丢失）', singleTask.shifts.length === 1, `shifts=${singleTask.shifts.length}`);
    assert('单班次：班次名称正确', singleTask.shifts[0]?.name === '全天班', singleTask.shifts[0]?.name ?? '(无)');
    assert('单班次：需求单元格为 2 个', singleTask.requirements.length === 2, `requirements=${singleTask.requirements.length}`);

    let singleForms = parseActionForms((await getText(`/admin/tasks/${singleTask.id}`)).text);
    await submitAction(`/admin/tasks/${singleTask.id}`, findActionByName(singleForms, 'publish'), {
      taskId: singleTask.id,
      fillPassword: 'single-pass-1234',
    });
    const singlePublished = await prisma.task.findUnique({ where: { id: singleTask.id } });
    assert('单班次：任务可发布', singlePublished.status === 'published', singlePublished.status);

    await postJson(`/api/fill/${singlePublished.publicToken}/auth`, { password: 'single-pass-1234' });
    const singleTaskData = await getJson(`/api/fill/${singlePublished.publicToken}/task`);
    const singleCells = singleTaskData.json?.task?.cells ?? [];
    assert(
      '单班次：填写端只有 1 个班次、2 个单元格',
      singleTaskData.json?.task?.shifts?.length === 1 && singleCells.length === 2,
      `shifts=${singleTaskData.json?.task?.shifts?.length} cells=${singleCells.length}`,
    );

    const singleSubmit = await postJson(`/api/fill/${singlePublished.publicToken}/submit`, {
      name: '单人',
      selections: singleCells.map((cell) => ({ date: cell.date, shiftId: cell.shiftId, choice: 'preferred' })),
    });
    assert('单班次：可正常提交意愿', singleSubmit.status === 200 && singleSubmit.json?.ok === true, JSON.stringify(singleSubmit.json));

    singleForms = parseActionForms((await getText(`/admin/tasks/${singleTask.id}`)).text);
    await submitAction(`/admin/tasks/${singleTask.id}`, findActionByName(singleForms, 'confirm'), { taskId: singleTask.id });
    singleForms = parseActionForms((await getText(`/admin/tasks/${singleTask.id}`)).text);
    await submitAction(`/admin/tasks/${singleTask.id}`, findActionByName(singleForms, 'match'), { taskId: singleTask.id, seed: '11' });

    const singleAfterMatch = await prisma.task.findUnique({ where: { id: singleTask.id }, include: { assignments: true } });
    assert(
      '单班次：可完成自动匹配',
      singleAfterMatch.matchFeasible === true && singleAfterMatch.assignments.length === 2,
      `feasible=${singleAfterMatch.matchFeasible} assignments=${singleAfterMatch.assignments.length}`,
    );
  }

  /* 12. 手动调整排班 */
  console.log('\n[12] 手动调整排班（自动匹配后人工增删）');
  const manualBase = await prisma.task.findUnique({ where: { id: createdTask.id } });
  assert('手动调整前任务已匹配', manualBase.status === 'matched', manualBase.status);

  const taskShifts = await prisma.shift.findMany({ where: { taskId: createdTask.id }, orderBy: { sortOrder: 'asc' } });
  const dayShift = taskShifts.find((shift) => shift.name === '白班');
  const manualDate = dates[0];
  const dayArea = await prisma.area.findFirst({
    where: { taskId: createdTask.id, shiftId: dayShift.id },
    orderBy: { sortOrder: 'asc' },
  });
  assert('白班存在可用区域', Boolean(dayArea), dayArea?.name ?? '(无)');
  const beforeManual = await prisma.assignment.count({
    where: { taskId: createdTask.id, date: manualDate, shiftId: dayShift.id, areaId: dayArea.id },
  });
  assert('手动调整前该班次已排 1 人', beforeManual === 1, `count=${beforeManual}`);

  const resultPageWithPanel = await getText(`/admin/tasks/${createdTask.id}/result`);
  assert('结果页含手动调整面板', resultPageWithPanel.status === 200 && resultPageWithPanel.text.includes('手动调整排班'));

  // 动态选一个「该班次尚未安排、且未标记无法排班」的人，作为手动添加对象
  const slotAssignments = await prisma.assignment.findMany({
    where: { taskId: createdTask.id, date: manualDate, shiftId: dayShift.id, areaId: dayArea.id },
  });
  const slotAssignedIds = new Set(slotAssignments.map((row) => row.submissionId));
  const slotSelections = await prisma.selection.findMany({
    where: { taskId: createdTask.id, date: manualDate, shiftId: dayShift.id },
  });
  const addableSelection = slotSelections.find(
    (selection) => !slotAssignedIds.has(selection.submissionId) && selection.choice !== 'unavailable',
  );
  const addableSubmission = addableSelection
    ? await prisma.submission.findUnique({ where: { id: addableSelection.submissionId } })
    : null;
  const jiaSubmission = await prisma.submission.findFirst({ where: { taskId: createdTask.id, name: '甲' } });
  assert('找到可手动添加的人员', Boolean(addableSubmission), addableSubmission?.name ?? '(无)');
  assert('测试用“无法排班”记录存在', Boolean(jiaSubmission));

  const addManual = await postJson(`/api/admin/tasks/${createdTask.id}/assignments`, {
    date: manualDate,
    shiftId: dayShift.id,
    areaId: dayArea.id,
    submissionId: addableSubmission.id,
    note: 'E2E 手动调整',
  });
  assert('手动添加人员成功', addManual.status === 200 && addManual.json?.ok === true, JSON.stringify(addManual.json));
  assert('超员时给出提示', /超员/.test(addManual.json?.warning ?? ''), addManual.json?.warning ?? '');

  const manualRow = await prisma.assignment.findFirst({
    where: { taskId: createdTask.id, date: manualDate, shiftId: dayShift.id, areaId: dayArea.id, submissionId: addableSubmission.id },
  });
  assert('手动记录被标记（manual=true）', manualRow?.manual === true);
  assert(
    '手动记录保留其原本意愿来源',
    manualRow?.source === addableSelection.choice,
    `source=${manualRow?.source} choice=${addableSelection.choice}`,
  );
  assert('手动记录保存调整说明', manualRow?.note === 'E2E 手动调整', manualRow?.note ?? '');

  const resultWithManual = await getText(`/admin/tasks/${createdTask.id}/result`);
  assert('结果页显示手动调整标记', resultWithManual.text.includes(addableSubmission.name) && resultWithManual.text.includes('手动'));
  assert('结果页显示调整说明', resultWithManual.text.includes('E2E 手动调整'));
  assert('结果页显示超员提示', resultWithManual.text.includes('超员'));

  const candidates = await getJson(
    `/api/admin/tasks/${createdTask.id}/candidates?date=${manualDate}&shiftId=${dayShift.id}&areaId=${dayArea.id}`,
  );
  assert('候选人接口可用', candidates.status === 200 && Array.isArray(candidates.json?.items));
  assert(
    '候选人接口标出“无法排班”人员不可安排',
    candidates.json.items.some((item) => item.name === '甲' && item.choice === 'unavailable' && item.eligible === false),
    JSON.stringify(candidates.json.items.find((item) => item.name === '甲')),
  );
  assert(
    '候选人接口标出已在该班次的人员',
    candidates.json.items.some((item) => item.name === addableSubmission.name && item.assignedHere === true),
  );

  const rejectUnavailable = await postJson(`/api/admin/tasks/${createdTask.id}/assignments`, {
    date: manualDate,
    shiftId: dayShift.id,
    areaId: dayArea.id,
    submissionId: jiaSubmission.id,
  });
  assert(
    '拒绝安排标记“无法排班”的人员',
    rejectUnavailable.status === 409 && /无法排班/.test(rejectUnavailable.json?.error ?? ''),
    `${rejectUnavailable.status} ${rejectUnavailable.json?.error ?? ''}`,
  );

  const duplicateManual = await postJson(`/api/admin/tasks/${createdTask.id}/assignments`, {
    date: manualDate,
    shiftId: dayShift.id,
    areaId: dayArea.id,
    submissionId: addableSubmission.id,
  });
  assert('重复添加同一人员被拒绝', duplicateManual.status === 409, `status=${duplicateManual.status}`);

  const removeResponse = await request(
    `/api/admin/tasks/${createdTask.id}/assignments?assignmentId=${encodeURIComponent(manualRow.id)}`,
    { method: 'DELETE' },
  );
  assert('手动移除排班记录成功', removeResponse.status === 200, `status=${removeResponse.status}`);
  const afterRemove = await prisma.assignment.count({
    where: { taskId: createdTask.id, date: manualDate, shiftId: dayShift.id, areaId: dayArea.id },
  });
  assert('移除后恢复为 1 人', afterRemove === 1, `count=${afterRemove}`);

  await postJson(`/api/admin/tasks/${createdTask.id}/assignments`, {
    date: manualDate,
    shiftId: dayShift.id,
    areaId: dayArea.id,
    submissionId: addableSubmission.id,
    note: '导出验证',
  });
  const exportWithManual = await request(`/api/admin/tasks/${createdTask.id}/result?format=csv&sheet=calendar`);
  const exportWithManualText = await exportWithManual.text();
  assert(
    '导出包含手动调整列与记录',
    exportWithManual.status === 200 &&
      exportWithManualText.includes('是否手动调整') &&
      exportWithManualText.includes('导出验证') &&
      exportWithManualText.includes('手动'),
  );

  const auditManual = await prisma.auditLog.count({
    where: { taskId: createdTask.id, action: { in: ['task.assignment.add', 'task.assignment.remove'] } },
  });
  assert('手动调整写入操作日志', auditManual >= 3, `logs=${auditManual}`);

  const detailWithManual = await getText(`/admin/tasks/${createdTask.id}`);
  assert('任务详情页显示手动调整条数', detailWithManual.text.includes('手动调整'));

  // 缺口任务：手动补人后缺口应减少；重新匹配会覆盖手动调整
  const gapTaskForManual = gapTaskName ? await prisma.task.findFirst({ where: { name: gapTaskName } }) : null;
  if (gapTaskForManual) {
    const gapRequirement = await prisma.taskDayRequirement.findFirst({ where: { taskId: gapTaskForManual.id } });
    const gapSubmission = await prisma.submission.findFirst({ where: { taskId: gapTaskForManual.id } });
    if (gapRequirement && gapSubmission) {
      const gapAdd = await postJson(`/api/admin/tasks/${gapTaskForManual.id}/assignments`, {
        date: gapRequirement.date,
        shiftId: gapRequirement.shiftId,
        areaId: gapRequirement.areaId,
        submissionId: gapSubmission.id,
        note: '缺口人工补齐',
      });
      assert('缺口任务可手动补人', gapAdd.status === 200 && gapAdd.json?.ok === true, JSON.stringify(gapAdd.json));

      const gapAssignments = await prisma.assignment.findMany({ where: { taskId: gapTaskForManual.id } });
      assert(
        '缺口任务现有 1 条手动排班',
        gapAssignments.length === 1 && gapAssignments[0].manual === true,
        `count=${gapAssignments.length}`,
      );

      const gapPage = await getText(`/admin/tasks/${gapTaskForManual.id}/result`);
      assert('手动补人后缺口由 3 减少为 2', gapPage.text.includes('共缺 2 人次'));

      const gapFormsForManual = parseActionForms((await getText(`/admin/tasks/${gapTaskForManual.id}`)).text);
      await submitAction(`/admin/tasks/${gapTaskForManual.id}`, findActionByName(gapFormsForManual, 'match'), {
        taskId: gapTaskForManual.id,
        seed: '777',
      });
      const manualAfterRematch = await prisma.assignment.count({ where: { taskId: gapTaskForManual.id, manual: true } });
      assert('重新匹配会覆盖手动调整', manualAfterRematch === 0, `manual=${manualAfterRematch}`);
    }
  }

  /* 13. v1.3 新能力：日历规则、区域匹配、工作量上限、批量选择、草案生成 */
  console.log('\n[13] v1.3：日历规则、区域匹配、工作量上限、批量选择');
  const { normalizeHolidayCn, normalizeTimor, normalizeJiejiari } = await import('../src/lib/calendar-api.ts');
  const { buildCalendarIndex, shiftIncludesDate, normalizeDateRule } = await import('../src/lib/schedule-rules.ts');
  const { slotGroupDemand } = await import('../src/lib/matching.ts');
  const { applyBulkChoice, scopeKeys, validateBulk } = await import('../src/lib/bulk-selection.ts');
  const { normalizeDraft, generateRequirements, createDraftFromTemplate } = await import('../src/lib/task-draft.ts');

  const holidayCn = normalizeHolidayCn(
    {
      year: 2026,
      days: [
        { name: '国庆节', date: '2026-10-01', isOffDay: true },
        { name: '国庆后补班', date: '2026-10-10', isOffDay: false },
      ],
    },
    2026,
  );
  assert(
    'holiday-cn 规范化：放假与补班都识别',
    holidayCn.entries.length === 2 &&
      holidayCn.entries.some((entry) => entry.date === '2026-10-01' && entry.kind === 'holiday') &&
      holidayCn.entries.some((entry) => entry.date === '2026-10-10' && entry.kind === 'workday'),
    JSON.stringify(holidayCn.entries),
  );
  const timor = normalizeTimor(
    { code: 0, holiday: { '10-01': { holiday: true, date: '2026-10-01', name: '国庆' } } },
    2026,
  );
  assert('timor 规范化可用', timor.entries.length === 1 && timor.entries[0].kind === 'holiday');
  const jiejiari = normalizeJiejiari({ '2026-10-01': { date: '2026-10-01', name: '国庆', isOffDay: true } }, 2026);
  assert('jiejiari 规范化可用', jiejiari.entries.length === 1 && jiejiari.entries[0].kind === 'holiday');

  const calendarIndex = buildCalendarIndex(
    [
      { date: '2026-10-01', kind: 'holiday' },
      { date: '2026-10-10', kind: 'workday' },
      { date: '2026-10-11', kind: 'holiday' },
    ],
    [0, 6],
  );
  const eveningRule = normalizeDateRule({ eveOfWorkday: true });
  const workdayRule = normalizeDateRule({ weekdays: [1, 2, 3, 4, 5] });
  assert('晚自习规则：节后周日晚上保留（次日工作日）', shiftIncludesDate('2026-10-11', eveningRule, calendarIndex) === true);
  assert('晚自习规则：节前晚上不排（次日放假）', shiftIncludesDate('2026-09-30', eveningRule, calendarIndex) === false);
  assert('调休补班的周六按工作日排', shiftIncludesDate('2026-10-10', workdayRule, calendarIndex) === true);
  assert('法定节假日不排普通工作日班', shiftIncludesDate('2026-10-01', workdayRule, calendarIndex) === false);

  // 自定义日历优先级：预置缓存 + 覆盖，通过 API 验证
  const calendarYear = 2031;
  await prisma.calendarCache.upsert({
    where: { year: calendarYear },
    create: {
      year: calendarYear,
      provider: 'e2e-cache',
      dataJson: JSON.stringify([{ date: '2031-01-01', kind: 'holiday', name: '元旦' }]),
      fetchedAt: new Date(),
    },
    update: {
      provider: 'e2e-cache',
      dataJson: JSON.stringify([{ date: '2031-01-01', kind: 'holiday', name: '元旦' }]),
      fetchedAt: new Date(),
    },
  });
  await prisma.calendarOverride.upsert({
    where: { year_date: { year: calendarYear, date: '2031-01-01' } },
    create: { year: calendarYear, date: '2031-01-01', kind: 'workday', name: '测试补班' },
    update: { kind: 'workday', name: '测试补班' },
  });
  const calendarApiResponse = await getJson(`/api/admin/calendar?year=${calendarYear}`);
  const mergedEntry = calendarApiResponse.json?.years?.[0]?.entries?.find((entry) => entry.date === '2031-01-01');
  assert(
    '自定义日历优先级高于接口缓存',
    calendarApiResponse.status === 200 && mergedEntry?.kind === 'workday',
    JSON.stringify(mergedEntry),
  );
  await prisma.calendarOverride.deleteMany({ where: { year: calendarYear } });
  await prisma.calendarCache.deleteMany({ where: { year: calendarYear } });

  const sharedDemand = slotGroupDemand([{ headcount: 1 }, { headcount: 1 }, { headcount: 1 }], 'shared', 2);
  const exclusiveDemand = slotGroupDemand([{ headcount: 1 }, { headcount: 1 }, { headcount: 1 }], 'exclusive', 2);
  assert('shared 时段需求按“每人最多兼顾数”折算', sharedDemand === 2, `demand=${sharedDemand}`);
  assert('exclusive 时段需求为各区域人数之和', exclusiveDemand === 3, `demand=${exclusiveDemand}`);

  const areaSubmissions = ['甲', '乙', '丙'].map((name) => ({
    id: `sub-${name}`,
    name,
    submittedAt: new Date('2026-01-01'),
    historyCount: 0,
    workloadPreference: 'normal',
    maxAssignments: null,
    choices: new Map([['2026-12-01|s1', { choice: 'preferred' }]]),
  }));
  const areaMatch = matchSchedule({
    shifts: [{ id: 's1', name: '晚自习', startTime: '18:30', endTime: '21:30' }],
    requirements: [
      { date: '2026-12-01', shiftId: 's1', areaId: 'a1', areaName: 'A 区', groupName: 'G1', headcount: 1 },
      { date: '2026-12-01', shiftId: 's1', areaId: 'a2', areaName: 'B 区', groupName: 'G1', headcount: 1 },
      { date: '2026-12-01', shiftId: 's1', areaId: 'a3', areaName: 'C 区', groupName: 'G2', headcount: 1 },
    ],
    submissions: areaSubmissions,
    allowSameDayMultiple: false,
    areaCoverage: 'shared',
    maxAreasPerPerson: 2,
    seed: 99,
  });
  const areaA = areaMatch.assignments.find((assignment) => assignment.areaId === 'a1');
  const areaB = areaMatch.assignments.find((assignment) => assignment.areaId === 'a2');
  const areaC = areaMatch.assignments.find((assignment) => assignment.areaId === 'a3');
  assert(
    '同组一人可兼顾多个区域，跨组必须换人',
    areaMatch.feasible &&
      areaMatch.assignments.length === 3 &&
      areaA?.submissionId === areaB?.submissionId &&
      areaC?.submissionId !== areaA?.submissionId,
    JSON.stringify(areaMatch.assignments.map((item) => `${item.areaName}:${item.name}`)),
  );
  assert(
    '兼顾多区域的记录被标记（multiArea）',
    areaA?.multiArea === true && areaB?.multiArea === true && areaC?.multiArea === false,
  );

  const workloadSubmissions = ['甲', '乙'].map((name) => ({
    id: `w-${name}`,
    name,
    submittedAt: new Date('2026-01-01'),
    historyCount: 0,
    workloadPreference: name === '甲' ? 'more' : 'normal',
    maxAssignments: name === '甲' ? 1 : null,
    choices: new Map([
      ['2026-12-01|s1', { choice: 'preferred' }],
      ['2026-12-02|s1', { choice: 'preferred' }],
    ]),
  }));
  const cappedMatch = matchSchedule({
    shifts: [{ id: 's1', name: '晚自习', startTime: '18:30', endTime: '21:30' }],
    requirements: [
      { date: '2026-12-01', shiftId: 's1', areaId: 'a1', areaName: 'A 区', groupName: 'G', headcount: 1 },
      { date: '2026-12-02', shiftId: 's1', areaId: 'a1', areaName: 'A 区', groupName: 'G', headcount: 1 },
    ],
    submissions: workloadSubmissions,
    allowSameDayMultiple: false,
    areaCoverage: 'shared',
    maxAreasPerPerson: 1,
    seed: 7,
  });
  assert(
    '“希望多排”优先，但 maxAssignments 硬上限生效',
    cappedMatch.feasible &&
      cappedMatch.assignments.filter((assignment) => assignment.name === '甲').length === 1 &&
      cappedMatch.assignments.filter((assignment) => assignment.name === '乙').length === 1,
    JSON.stringify(cappedMatch.assignments.map((item) => `${item.date}:${item.name}`)),
  );

  const bulkCells = [
    { date: '2026-12-01', shiftId: 's1' },
    { date: '2026-12-01', shiftId: 's2' },
    { date: '2026-12-02', shiftId: 's1' },
  ];
  assert(
    '批量范围：整行/整列/日期区间',
    scopeKeys(bulkCells, { type: 'row', date: '2026-12-01' }).length === 2 &&
      scopeKeys(bulkCells, { type: 'column', shiftId: 's1' }).length === 2 &&
      scopeKeys(bulkCells, { type: 'range', dateStart: '2026-12-01', dateEnd: '2026-12-01' }).length === 2,
  );
  const bulkApplied = applyBulkChoice({}, ['d1|s1', 'd1|s2'], 'unavailable', '已有安排');
  assert(
    '批量“无法”统一理由，改首选后理由清空',
    bulkApplied['d1|s1'].choice === 'unavailable' &&
      bulkApplied['d1|s1'].reason === '已有安排' &&
      applyBulkChoice(bulkApplied, ['d1|s1'], 'preferred')['d1|s1'].reason === '',
  );
  assert('批量“无法”缺少理由被拒绝', Boolean(validateBulk('unavailable', '')));

  const sampleDraft = createDraftFromTemplate('blank');
  sampleDraft.name = '草案生成测试';
  sampleDraft.dateStart = '2026-12-01';
  sampleDraft.dateEnd = '2026-12-02';
  sampleDraft.shifts[0].dateRule = normalizeDateRule({
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    excludeHolidays: false,
  });
  sampleDraft.shifts[0].areas = [
    { name: 'A 区', groupName: 'G', defaultHeadcount: 1 },
    { name: 'B 区', groupName: 'G', defaultHeadcount: 1 },
  ];
  sampleDraft.overrides = [{ date: '2026-12-01', shiftIndex: 0, areaIndex: 0, headcount: 3 }];
  const sampleNormalized = normalizeDraft(sampleDraft);
  const sampleGenerated = generateRequirements(sampleNormalized.draft, []);
  assert(
    '草稿可生成区域需求，稀疏覆盖生效',
    sampleNormalized.errors.length === 0 &&
      sampleGenerated.rows.length === 4 &&
      sampleGenerated.summary.totalRequired === 6,
    `rows=${sampleGenerated.rows.length} total=${sampleGenerated.summary.totalRequired}`,
  );
  assert('缺少任务名称会被校验拦截', normalizeDraft({}).errors.includes('请填写任务名称'));

  /* 13b. 多区域任务全链路 */
  console.log('\n[13b] 多区域任务：创建 → 填写 → 匹配 → 结果');
  const areaTaskName = `E2E 多区域任务 ${stamp}`;
  const areaDraft = {
    name: areaTaskName,
    description: '三个人、三个区域、同组兼顾',
    dateStart: '2026-12-01',
    dateEnd: '2026-12-02',
    fillPassword: 'area-pass-1234',
    allowSameDayMultiple: false,
    areaCoverage: 'shared',
    maxAreasPerPerson: 2,
    weekend: [0, 6],
    calendar: { useApi: false },
    shifts: [
      {
        name: '晚自习',
        startTime: '18:30',
        endTime: '21:30',
        dateRule: {
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          eveOfWorkday: false,
          excludeHolidays: false,
          includeDates: [],
          excludeDates: [],
        },
        areas: [
          { name: 'A 区', groupName: 'G1', defaultHeadcount: 1 },
          { name: 'B 区', groupName: 'G1', defaultHeadcount: 1 },
          { name: 'C 区', groupName: 'G2', defaultHeadcount: 1 },
        ],
      },
    ],
    overrides: [],
  };
  const areaForm = parseActionForms((await getText('/admin/tasks/new')).text)[0];
  await submitAction('/admin/tasks/new', areaForm, { draft: JSON.stringify(areaDraft) });
  const areaTask = await prisma.task.findFirst({
    where: { name: areaTaskName },
    include: { shifts: { include: { areas: true } }, requirements: true },
  });
  assert(
    '多区域任务已创建（3 个区域 6 条需求）',
    Boolean(areaTask) && areaTask.shifts[0]?.areas?.length === 3 && areaTask.requirements.length === 6,
    `areas=${areaTask?.shifts?.[0]?.areas?.length} req=${areaTask?.requirements?.length}`,
  );
  if (areaTask) {
    createdTaskIds.push(areaTask.id);
    let areaForms = parseActionForms((await getText(`/admin/tasks/${areaTask.id}`)).text);
    await submitAction(`/admin/tasks/${areaTask.id}`, findActionByName(areaForms, 'publish'), {
      taskId: areaTask.id,
      fillPassword: 'area-pass-1234',
    });
    const areaPublished = await prisma.task.findUnique({ where: { id: areaTask.id } });
    await postJson(`/api/fill/${areaPublished.publicToken}/auth`, { password: 'area-pass-1234' });
    for (const person of ['甲', '乙', '丙']) {
      const areaCells = (await getJson(`/api/fill/${areaPublished.publicToken}/task`)).json.task.cells;
      await postJson(`/api/fill/${areaPublished.publicToken}/submit`, {
        name: person,
        selections: areaCells.map((cell) => ({ date: cell.date, shiftId: cell.shiftId, choice: 'preferred' })),
      });
    }
    areaForms = parseActionForms((await getText(`/admin/tasks/${areaTask.id}`)).text);
    await submitAction(`/admin/tasks/${areaTask.id}`, findActionByName(areaForms, 'confirm'), { taskId: areaTask.id });
    areaForms = parseActionForms((await getText(`/admin/tasks/${areaTask.id}`)).text);
    await submitAction(`/admin/tasks/${areaTask.id}`, findActionByName(areaForms, 'match'), {
      taskId: areaTask.id,
      seed: '4242',
    });
    const areaAfter = await prisma.task.findUnique({
      where: { id: areaTask.id },
      include: { assignments: { include: { area: true } } },
    });
    assert(
      '多区域任务匹配出 6 条区域安排',
      areaAfter.matchFeasible === true && areaAfter.assignments.length === 6,
      `feasible=${areaAfter.matchFeasible} assignments=${areaAfter.assignments.length}`,
    );
    const multiAreaRows = areaAfter.assignments.filter(
      (row) =>
        areaAfter.assignments.filter(
          (other) => other.date === row.date && other.shiftId === row.shiftId && other.submissionId === row.submissionId,
        ).length > 1,
    );
    assert('多区域结果中有人兼顾同组两个区域', multiAreaRows.length >= 2, `rows=${areaAfter.assignments.length} multi=${multiAreaRows.length}`);
    const areaResultPage = await getText(`/admin/tasks/${areaTask.id}/result`);
    assert('结果页按区域展示排班', areaResultPage.text.includes('区域（组）') && areaResultPage.text.includes('A 区'));
  }

  /* 14. 清理 */
  console.log('\n[13] 清理测试数据');
  for (const id of createdTaskIds) {
    await prisma.task.delete({ where: { id } }).catch(() => {});
  }
  const remaining = await prisma.task.count({ where: { id: { in: createdTaskIds } } });
  assert('测试任务已清理', remaining === 0, `remaining=${remaining}`);

  console.log(`\n=== 结果：通过 ${passed} 项，失败 ${failures.length} 项 ===`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('全部端到端验证通过');
  }
  console.log(`导出产物目录：${ARTIFACTS}`);
}

main()
  .catch((error) => {
    console.error('\n端到端脚本执行失败：', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
