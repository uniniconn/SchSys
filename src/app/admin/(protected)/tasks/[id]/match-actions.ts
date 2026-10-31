'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireAdminPage } from '@/lib/auth';
import { writeAuditLog } from '@/lib/session';
import { matchSchedule, resolveSeed, type MatchSubmission } from '@/lib/matching';
import { normalizeName } from '@/lib/roster';
import type { Choice } from '@/lib/types';
import type { ActionState } from '../../task-actions';

/** 截止并确认：锁定用户填写 */
export async function confirmTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdminPage();
  const taskId = String(formData.get('taskId') ?? '');
  if (!taskId) return { error: '缺少任务 ID' };

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return { error: '任务不存在' };
  if (task.status === 'confirmed' || task.status === 'matched') return { error: '任务已处于确认状态' };

  await prisma.$transaction([
    prisma.task.update({ where: { id: taskId }, data: { status: 'confirmed', confirmedAt: new Date(), confirmedBy: session.username } }),
    prisma.submission.updateMany({ where: { taskId }, data: { status: 'locked' } }),
  ]);

  await writeAuditLog({
    adminId: session.adminId,
    taskId,
    action: 'task.confirm',
    detail: '截止并确认：锁定用户填写',
  });

  revalidatePath(`/admin/tasks/${taskId}`);
  return { ok: '已截止并确认，用户端填写已锁定。如需修改请点击「解锁填写」。' };
}

/** 解锁填写（需二次确认，记录日志） */
export async function unlockTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdminPage();
  const taskId = String(formData.get('taskId') ?? '');
  if (!taskId) return { error: '缺少任务 ID' };

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return { error: '任务不存在' };
  if (task.status !== 'confirmed' && task.status !== 'matched') return { error: '任务当前不是已确认状态' };

  await prisma.$transaction([
    prisma.task.update({
      where: { id: taskId },
      data: { status: 'published', confirmedAt: null, confirmedBy: null },
    }),
    prisma.submission.updateMany({ where: { taskId }, data: { status: 'submitted' } }),
  ]);

  await writeAuditLog({
    adminId: session.adminId,
    taskId,
    action: 'task.unlock',
    detail: '解锁填写（管理员二次确认）',
  });

  revalidatePath(`/admin/tasks/${taskId}`);
  return { ok: '已解锁，用户可以再次进入修改。' };
}

/** 自动匹配排班（可指定随机种子，结果可复现） */
export async function matchTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdminPage();
  const taskId = String(formData.get('taskId') ?? '');
  const seedRaw = String(formData.get('seed') ?? '').trim();
  const batchId = String(formData.get('batchId') ?? '').trim();
  if (!taskId) return { error: '缺少任务 ID' };

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { shifts: { orderBy: { sortOrder: 'asc' } }, requirements: true },
  });
  if (!task) return { error: '任务不存在' };
  if (task.status !== 'confirmed' && task.status !== 'matched') {
    return { error: '请先点击「截止并确认」，确认后才能自动匹配排班' };
  }

  const seed = seedRaw ? Number(seedRaw) : resolveSeed(null, taskId);
  if (!Number.isFinite(seed) || seed <= 0) return { error: '随机种子必须为正整数' };

  const submissions = await prisma.submission.findMany({
    where: { taskId },
    select: {
      id: true,
      name: true,
      nameKey: true,
      createdAt: true,
      selections: { select: { date: true, shiftId: true, choice: true, reason: true } },
    },
  });

  // 历史排班次数（跨其他任务，用于公平规则）
  const historyRows = await prisma.assignment.groupBy({
    by: ['name'],
    where: { taskId: { not: taskId } },
    _count: { _all: true },
  });
  const historyByName = new Map(historyRows.map((row) => [normalizeName(row.name), row._count._all]));

  // 上一批次结果，用于展示变化
  const previous = await prisma.assignment.findMany({
    where: { taskId },
    select: { submissionId: true, date: true, shiftId: true, manual: true },
  });
  const manualOverwritten = previous.filter((row) => row.manual).length;

  const matchSubmissions: MatchSubmission[] = submissions.map((submission) => {
    const choices = new Map<string, { choice: Choice; reason?: string | null }>();
    for (const selection of submission.selections) {
      choices.set(`${selection.date}|${selection.shiftId}`, {
        choice: selection.choice as Choice,
        reason: selection.reason,
      });
    }
    return {
      id: submission.id,
      name: submission.name,
      submittedAt: submission.createdAt,
      historyCount: historyByName.get(submission.nameKey) ?? 0,
      choices,
    };
  });

  const result = matchSchedule({
    shifts: task.shifts.map((shift) => ({
      id: shift.id,
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
    })),
    requirements: task.requirements.map((requirement) => ({
      date: requirement.date,
      shiftId: requirement.shiftId,
      headcount: requirement.headcount,
    })),
    submissions: matchSubmissions,
    allowSameDayMultiple: task.allowSameDayMultiple,
    seed,
  });

  await prisma.$transaction(async (tx) => {
    await tx.assignment.deleteMany({ where: { taskId } });
    if (result.feasible) {
      await tx.assignment.createMany({
        data: result.assignments.map((assignment) => ({
          taskId,
          shiftId: assignment.shiftId,
          date: assignment.date,
          submissionId: assignment.submissionId,
          name: assignment.name,
          source: assignment.source,
          batchId: result.batchId,
          seed: result.seed,
          historyCount: assignment.historyCount,
        })),
      });
    }
    await tx.task.update({
      where: { id: taskId },
      data: {
        status: result.feasible ? 'matched' : 'confirmed',
        matchSeed: result.seed,
        matchFeasible: result.feasible,
        matchSummary: result.summary,
        lastMatchedAt: new Date(),
      },
    });
  });

  const changes = previous.length;
  await writeAuditLog({
    adminId: session.adminId,
    taskId,
    action: 'task.match',
    detail: `自动匹配（种子 ${result.seed}）：${result.summary}${changes > 0 ? `，覆盖上一批次 ${changes} 条记录` : ''}${
      manualOverwritten > 0 ? `，其中含 ${manualOverwritten} 条手动调整记录（已覆盖）` : ''
    }`,
  });

  revalidatePath(`/admin/tasks/${taskId}`);
  revalidatePath(`/admin/tasks/${taskId}/result`);

  return {
    ok: result.feasible
      ? `匹配成功：${result.summary}`
      : `存在缺口，未生成排班结果：${result.summary}`,
  };
}

/** 删除任务（连带级联删除班次、提交、结果） */
export async function deleteTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdminPage();
  const taskId = String(formData.get('taskId') ?? '');
  if (!taskId) return { error: '缺少任务 ID' };
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { name: true } });
  if (!task) return { error: '任务不存在' };

  await prisma.task.delete({ where: { id: taskId } });
  await writeAuditLog({ adminId: session.adminId, action: 'task.delete', detail: `删除任务「${task.name}」` });

  revalidatePath('/admin/dashboard');
  redirect('/admin/dashboard');
}
