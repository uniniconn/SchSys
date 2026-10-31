import { prisma } from '@/lib/prisma';
import { findTaskByToken, hasFillAccess, fillLocked, buildRequirementCells } from '@/lib/fill';
import { fail, json } from '@/lib/http';
import { normalizeName } from '@/lib/roster';

/** 读取任务填写所需数据（需要已通过密码进入）；可选 ?name= 回填该姓名已提交的内容 */
export async function GET(request: Request, context: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await context.params;
  const task = await findTaskByToken(uuid);
  if (!task) return fail('填写链接无效或已被删除', 404);

  const allowed = await hasFillAccess(task);
  if (!allowed) return fail('请先输入填写密码', 401);

  const locked = fillLocked(task);
  const nameParam = (new URL(request.url).searchParams.get('name') ?? '').trim();

  let existing: {
    name: string;
    status: string;
    updatedAt: string;
    selections: Array<{ date: string; shiftId: string; choice: string; reason: string | null }>;
  } | null = null;

  if (nameParam) {
    const submission = await prisma.submission.findUnique({
      where: { taskId_nameKey: { taskId: task.id, nameKey: normalizeName(nameParam) } },
      include: { selections: { select: { date: true, shiftId: true, choice: true, reason: true } } },
    });
    if (submission) {
      existing = {
        name: submission.name,
        status: submission.status,
        updatedAt: submission.updatedAt.toISOString(),
        selections: submission.selections.map((selection) => ({
          date: selection.date,
          shiftId: selection.shiftId,
          choice: selection.choice,
          reason: selection.reason,
        })),
      };
    }
  }

  const cells = buildRequirementCells(task);

  return json({
    ok: true,
    task: {
      name: task.name,
      description: task.description,
      dateStart: task.dateStart,
      dateEnd: task.dateEnd,
      fillDeadline: task.fillDeadline,
      status: task.status,
      allowSameDayMultiple: task.allowSameDayMultiple,
      shifts: task.shifts,
      cells,
      hasRoster: task.roster.length > 0,
    },
    roster: task.roster.map((entry) => ({ id: entry.id, name: entry.name, empNo: entry.empNo, dept: entry.dept })),
    locked: locked.locked,
    lockedReason: locked.reason,
    existing,
  });
}
