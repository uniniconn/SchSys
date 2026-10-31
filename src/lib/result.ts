import { prisma } from '@/lib/prisma';

/** 排班来源：首选 / 次选 / 管理员手动指定 */
export type AssignmentSource = 'preferred' | 'backup' | 'manual';

export const SOURCE_LABEL: Record<AssignmentSource, string> = {
  preferred: '首选',
  backup: '次选',
  manual: '手动',
};

export type ResultShift = { id: string; name: string; startTime: string; endTime: string; sortOrder: number; defaultHeadcount: number };

export type AssignmentLike = {
  id?: string;
  date: string;
  shiftId: string;
  name: string;
  source: string;
  manual?: boolean;
  note?: string | null;
};

export type CalendarPerson = {
  assignmentId: string;
  name: string;
  source: AssignmentSource;
  manual: boolean;
  note: string | null;
};

export type CalendarRow = {
  date: string;
  shiftId: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  headcount: number;
  people: CalendarPerson[];
  missing: number;
  over: number;
};

export type NameRow = {
  name: string;
  total: number;
  entries: Array<{
    date: string;
    shiftName: string;
    startTime: string;
    endTime: string;
    source: AssignmentSource;
    manual: boolean;
  }>;
};

export type GapRow = {
  date: string;
  shiftId: string;
  shiftName: string;
  required: number;
  filled: number;
  missing: number;
  reasons: string[];
};

/** 统一来源标记；手动加入但原本有首选/次选意愿时保留其意愿来源 */
export function resolveSource(source: string, manual = false): AssignmentSource {
  if (source === 'backup') return 'backup';
  if (source === 'manual') return 'manual';
  if (source === 'preferred') return 'preferred';
  return manual ? 'manual' : 'preferred';
}

/** 来源展示文本（区分“手动加入”与“自动匹配”） */
export function sourceText(source: string, manual = false): string {
  const base = SOURCE_LABEL[resolveSource(source, manual)];
  if (!manual) return base;
  return source === 'manual' ? '手动' : `手动·${base}`;
}

export async function loadTaskForResult(taskId: string) {
  return prisma.task.findUnique({
    where: { id: taskId },
    include: {
      shifts: { orderBy: { sortOrder: 'asc' } },
      requirements: true,
      assignments: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] },
    },
  });
}

/** 日历排班表：按日期 × 班次展示安排人员（含手动调整标记） */
export function buildCalendarRows(
  shifts: ResultShift[],
  requirements: Array<{ date: string; shiftId: string; headcount: number }>,
  assignments: AssignmentLike[],
): CalendarRow[] {
  const rows: CalendarRow[] = [];
  const dates = [...new Set(requirements.map((requirement) => requirement.date))].sort();
  for (const date of dates) {
    for (const shift of shifts) {
      const requirement = requirements.find((item) => item.date === date && item.shiftId === shift.id);
      if (!requirement || requirement.headcount <= 0) continue;
      const people = assignments
        .filter((assignment) => assignment.date === date && assignment.shiftId === shift.id)
        .map((assignment) => ({
          assignmentId: assignment.id ?? '',
          name: assignment.name,
          source: resolveSource(assignment.source, assignment.manual),
          manual: Boolean(assignment.manual),
          note: assignment.note ?? null,
        }));
      rows.push({
        date,
        shiftId: shift.id,
        shiftName: shift.name,
        startTime: shift.startTime,
        endTime: shift.endTime,
        headcount: requirement.headcount,
        people,
        missing: Math.max(0, requirement.headcount - people.length),
        over: Math.max(0, people.length - requirement.headcount),
      });
    }
  }
  return rows;
}

/** 姓名排班表：按人员展示其日期与班次 */
export function buildNameRows(shifts: ResultShift[], assignments: AssignmentLike[]): NameRow[] {
  const byName = new Map<string, NameRow>();
  for (const assignment of assignments) {
    const shift = shifts.find((item) => item.id === assignment.shiftId);
    const row = byName.get(assignment.name) ?? { name: assignment.name, total: 0, entries: [] };
    row.entries.push({
      date: assignment.date,
      shiftName: shift?.name ?? '-',
      startTime: shift?.startTime ?? '',
      endTime: shift?.endTime ?? '',
      source: resolveSource(assignment.source, assignment.manual),
      manual: Boolean(assignment.manual),
    });
    row.total += 1;
    byName.set(assignment.name, row);
  }
  return [...byName.values()]
    .map((row) => ({ ...row, entries: row.entries.sort((a, b) => a.date.localeCompare(b.date)) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/**
 * 缺口报告：以**实际排班结果**为准（含管理员手动调整），
 * 因此手动补齐缺口后，缺口会自动减少/消失。
 */
export async function computeGapsFromAssignments(taskId: string): Promise<GapRow[]> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { shifts: true, requirements: true, assignments: { select: { date: true, shiftId: true } } },
  });
  if (!task) return [];

  const shiftById = new Map(task.shifts.map((shift) => [shift.id, shift]));
  const filledByKey = new Map<string, number>();
  for (const assignment of task.assignments) {
    const key = `${assignment.date}|${assignment.shiftId}`;
    filledByKey.set(key, (filledByKey.get(key) ?? 0) + 1);
  }

  const selectionStats = await prisma.selection.groupBy({
    by: ['date', 'shiftId', 'choice'],
    where: { taskId },
    _count: { _all: true },
  });
  const statsByKey = new Map<string, { preferred: number; backup: number; unavailable: number }>();
  for (const row of selectionStats) {
    const key = `${row.date}|${row.shiftId}`;
    const entry = statsByKey.get(key) ?? { preferred: 0, backup: 0, unavailable: 0 };
    if (row.choice === 'preferred') entry.preferred += row._count._all;
    else if (row.choice === 'backup') entry.backup += row._count._all;
    else if (row.choice === 'unavailable') entry.unavailable += row._count._all;
    statsByKey.set(key, entry);
  }

  const gaps: GapRow[] = [];
  for (const requirement of task.requirements) {
    if (requirement.headcount <= 0) continue;
    const key = `${requirement.date}|${requirement.shiftId}`;
    const filled = filledByKey.get(key) ?? 0;
    if (filled >= requirement.headcount) continue;
    const stats = statsByKey.get(key) ?? { preferred: 0, backup: 0, unavailable: 0 };
    const reasons: string[] = [];
    if (stats.preferred + stats.backup === 0) {
      reasons.push('该日期班次无任何“首选/次选”意愿');
    } else {
      reasons.push('有意愿的人数少于需求人数（可能受同日单班约束影响）');
    }
    if (stats.unavailable > 0) reasons.push(`${stats.unavailable} 人标记“无法排班”`);
    if (!task.allowSameDayMultiple) reasons.push('未开启“允许同日多班”，同日只能安排一个班次');
    reasons.push('可在“手动调整”中人工补人，或调整需求/放宽同一日多班后重新匹配');
    gaps.push({
      date: requirement.date,
      shiftId: requirement.shiftId,
      shiftName: shiftById.get(requirement.shiftId)?.name ?? '-',
      required: requirement.headcount,
      filled,
      missing: Math.max(0, requirement.headcount - filled),
      reasons,
    });
  }
  return gaps;
}

/** 统计：总需求、已安排、各来源人次、缺口 */
export async function summarizeTaskResult(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { requirements: true, assignments: true },
  });
  if (!task) return null;
  const gaps = await computeGapsFromAssignments(taskId);
  return {
    required: task.requirements.reduce((sum, requirement) => sum + requirement.headcount, 0),
    assigned: task.assignments.length,
    preferred: task.assignments.filter((assignment) => !assignment.manual && assignment.source === 'preferred').length,
    backup: task.assignments.filter((assignment) => !assignment.manual && assignment.source === 'backup').length,
    manual: task.assignments.filter((assignment) => assignment.manual).length,
    gapCount: gaps.reduce((sum, gap) => sum + gap.missing, 0),
    gaps,
  };
}
