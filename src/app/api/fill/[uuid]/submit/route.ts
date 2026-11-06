import { prisma } from '@/lib/prisma';
import { findTaskByToken, hasFillAccess, fillLocked, buildRequirementCells } from '@/lib/fill';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { fail, ok } from '@/lib/http';
import { normalizeName } from '@/lib/roster';
import { isDateString } from '@/lib/date-utils';

type SelectionPayload = { date?: string; shiftId?: string; choice?: string; reason?: string };

const VALID_CHOICES = new Set(['preferred', 'backup', 'unavailable']);

/** 提交或更新排班意愿（同一姓名在管理员确认前可反复修改） */
export async function POST(request: Request, context: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await context.params;
  const ip = clientIp(request.headers);

  // 限流：防止重复提交与恶意提交
  const max = Number(process.env.FILL_RATE_LIMIT_MAX ?? 30) || 30;
  const windowSeconds = Number(process.env.FILL_RATE_LIMIT_WINDOW ?? 60) || 60;
  const limit = rateLimit(`fill-submit:${uuid}:${ip}`, max, windowSeconds);
  if (!limit.allowed) {
    return fail(`提交过于频繁，请 ${limit.retryAfterSeconds} 秒后再试`, 429);
  }

  const task = await findTaskByToken(uuid);
  if (!task) return fail('填写链接无效或已被删除', 404);

  if (!(await hasFillAccess(task))) return fail('请先输入填写密码', 401);

  const locked = fillLocked(task);
  if (locked.locked) return fail(locked.reason ?? '当前不可提交', 403);

  let body: { name?: string; selections?: SelectionPayload[]; workloadPreference?: string; maxAssignments?: number | string | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail('请求格式错误');
  }

  const workloadPreference =
    body.workloadPreference === 'more' || body.workloadPreference === 'less' ? body.workloadPreference : 'normal';
  let maxAssignments: number | null = null;
  if (body.maxAssignments !== null && body.maxAssignments !== undefined && String(body.maxAssignments).trim() !== '') {
    const parsed = Number(body.maxAssignments);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1000) return fail('最多可排班次数应在 0~1000 之间', 422);
    maxAssignments = Math.floor(parsed);
  }

  const name = (body.name ?? '').trim();
  const nameKey = normalizeName(name);
  if (!name) return fail('请填写姓名');
  if (name.length > 40) return fail('姓名过长');

  const rosterKeys = new Set(task.roster.map((entry) => normalizeName(entry.name)));
  const rosterEntry = task.roster.find((entry) => normalizeName(entry.name) === nameKey) ?? null;
  const hasRoster = task.roster.length > 0;
  if (hasRoster && !rosterEntry) {
    return fail('该姓名不在管理员上传的名单中，请重新选择或联系管理员', 422);
  }

  const cells = buildRequirementCells(task);
  const cellKeys = new Set(cells.map((cell) => `${cell.date}|${cell.shiftId}`));
  const provided = new Map<string, SelectionPayload>();
  for (const selection of body.selections ?? []) {
    if (!isDateString(selection.date) || !selection.shiftId) continue;
    provided.set(`${selection.date}|${selection.shiftId}`, selection);
  }

  // 校验：所有日期×班次都必须三选一；无法排班必须填理由
  const missing: string[] = [];
  const missingReason: string[] = [];
  const rows: Array<{ date: string; shiftId: string; choice: string; reason: string | null }> = [];

  for (const cell of cells) {
    const key = `${cell.date}|${cell.shiftId}`;
    const selection = provided.get(key);
    if (!selection || !selection.choice) {
      missing.push(key);
      continue;
    }
    if (!VALID_CHOICES.has(selection.choice)) {
      missing.push(key);
      continue;
    }
    const reason = (selection.reason ?? '').trim();
    if (selection.choice === 'unavailable' && !reason) {
      missingReason.push(key);
      continue;
    }
    rows.push({
      date: cell.date,
      shiftId: cell.shiftId,
      choice: selection.choice,
      reason: selection.choice === 'unavailable' ? reason.slice(0, 500) : null,
    });
  }

  if (missing.length > 0) {
    return fail(`还有 ${missing.length} 个“日期+班次”未选择，请全部完成后再提交`, 422, { missing: missing.slice(0, 20) });
  }
  if (missingReason.length > 0) {
    return fail(`有 ${missingReason.length} 处选择“无法排班”但未填写理由`, 422, { missingReason: missingReason.slice(0, 20) });
  }

  const submission = await prisma.$transaction(async (tx) => {
    const existing = await tx.submission.findUnique({ where: { taskId_nameKey: { taskId: task.id, nameKey } } });
    const record = existing
      ? await tx.submission.update({
          where: { id: existing.id },
          data: {
            name,
            empNo: rosterEntry?.empNo ?? existing.empNo,
            dept: rosterEntry?.dept ?? existing.dept,
            onRoster: Boolean(rosterEntry),
            status: 'submitted',
            workloadPreference,
            maxAssignments,
            ipAddress: ip,
            userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? null,
          },
        })
      : await tx.submission.create({
          data: {
            taskId: task.id,
            name,
            nameKey,
            empNo: rosterEntry?.empNo ?? null,
            dept: rosterEntry?.dept ?? null,
            onRoster: Boolean(rosterEntry),
            status: 'submitted',
            workloadPreference,
            maxAssignments,
            ipAddress: ip,
            userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? null,
          },
        });

    // 覆盖式更新：先删除原有选择，保证与本次提交完全一致
    await tx.selection.deleteMany({ where: { submissionId: record.id } });
    await tx.selection.createMany({
      data: rows.map((row) => ({
        submissionId: record.id,
        taskId: task.id,
        shiftId: row.shiftId,
        date: row.date,
        choice: row.choice,
        reason: row.reason,
      })),
    });

    return record;
  });

  return ok({
    redirectTo: `/fill/${uuid}/success?name=${encodeURIComponent(name)}`,
    submissionId: submission.id,
    total: rows.length,
    preferred: rows.filter((row) => row.choice === 'preferred').length,
    backup: rows.filter((row) => row.choice === 'backup').length,
    unavailable: rows.filter((row) => row.choice === 'unavailable').length,
    onRoster: Boolean(rosterEntry),
    cells: cellKeys.size,
  });
}
