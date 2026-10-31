import { createHmac } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { readFillSession, FILL_COOKIE } from '@/lib/session';
import { enumerateDates, isPast } from '@/lib/date-utils';

/** 填写端通行凭证 secret：与任务当前填写密码哈希绑定，重置密码后旧凭证立即失效 */
export function fillSecret(taskId: string, fillPasswordHash: string): string {
  return createHmac('sha256', process.env.SESSION_SECRET || 'dev-fallback').update(`${taskId}:${fillPasswordHash}`).digest('base64url');
}

export type PublicTask = {
  id: string;
  name: string;
  description: string | null;
  dateStart: string;
  dateEnd: string;
  fillDeadline: Date | null;
  status: string;
  allowSameDayMultiple: boolean;
  publicToken: string;
  shifts: Array<{
    id: string;
    name: string;
    startTime: string;
    endTime: string;
    defaultHeadcount: number;
    sortOrder: number;
  }>;
  requirements: Array<{ date: string; shiftId: string; headcount: number }>;
  roster: Array<{ id: string; name: string; empNo: string | null; dept: string | null }>;
};

export async function findTaskByToken(token: string): Promise<PublicTask | null> {
  if (!token || token.length < 8) return null;
  const task = await prisma.task.findUnique({
    where: { publicToken: token },
    include: {
      shifts: { orderBy: { sortOrder: 'asc' } },
      requirements: true,
      roster: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!task) return null;
  return {
    id: task.id,
    name: task.name,
    description: task.description,
    dateStart: task.dateStart,
    dateEnd: task.dateEnd,
    fillDeadline: task.fillDeadline,
    status: task.status,
    allowSameDayMultiple: task.allowSameDayMultiple,
    publicToken: task.publicToken,
    shifts: task.shifts.map((shift) => ({
      id: shift.id,
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      defaultHeadcount: shift.defaultHeadcount,
      sortOrder: shift.sortOrder,
    })),
    requirements: task.requirements.map((requirement) => ({
      date: requirement.date,
      shiftId: requirement.shiftId,
      headcount: requirement.headcount,
    })),
    roster: task.roster.map((entry) => ({ id: entry.id, name: entry.name, empNo: entry.empNo, dept: entry.dept })),
  };
}

/** 校验填写端是否已通过密码进入该任务 */
export async function hasFillAccess(task: PublicTask): Promise<boolean> {
  const session = await readFillSession();
  if (!session || session.taskId !== task.id) return false;
  const record = await prisma.task.findUnique({ where: { id: task.id }, select: { fillPasswordHash: true } });
  if (!record) return false;
  return session.secret === fillSecret(task.id, record.fillPasswordHash);
}

/** 填写端是否仍可提交/修改 */
export function fillLocked(task: PublicTask): { locked: boolean; reason: string | null } {
  if (task.status === 'confirmed' || task.status === 'matched') {
    return { locked: true, reason: '本次排班已由管理员截止确认，填写已锁定，不能再修改。' };
  }
  if (task.status === 'draft') {
    return { locked: true, reason: '该任务尚未发布，请联系管理员。' };
  }
  if (task.fillDeadline && isPast(task.fillDeadline)) {
    return { locked: true, reason: '已超过填写截止时间，不能再提交或修改。' };
  }
  return { locked: false, reason: null };
}

/** 任务内有效的“日期 × 班次”组合（人数为 0 的班次不要求填写） */
export function buildRequirementCells(task: PublicTask): Array<{ date: string; shiftId: string; headcount: number }> {
  const dates = enumerateDates(task.dateStart, task.dateEnd, 200);
  const result: Array<{ date: string; shiftId: string; headcount: number }> = [];
  for (const date of dates) {
    for (const shift of task.shifts) {
      const requirement = task.requirements.find((r) => r.date === date && r.shiftId === shift.id);
      if (!requirement) continue;
      if (requirement.headcount <= 0) continue;
      result.push({ date, shiftId: shift.id, headcount: requirement.headcount });
    }
  }
  return result;
}

/** 确保填写端姓名与名单/已提交记录匹配 */
export async function resolveSubmission(taskId: string, nameKey: string) {
  return prisma.submission.findUnique({ where: { taskId_nameKey: { taskId, nameKey } } });
}

export { FILL_COOKIE };
