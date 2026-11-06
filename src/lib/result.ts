import { prisma } from '@/lib/prisma';

/** 排班来源：首选 / 次选 / 管理员手动指定 */
export type AssignmentSource = 'preferred' | 'backup' | 'manual';

export const SOURCE_LABEL: Record<AssignmentSource, string> = {
  preferred: '首选',
  backup: '次选',
  manual: '手动',
};

export type ResultArea = { id: string; shiftId: string; name: string; groupName: string; sortOrder: number; defaultHeadcount: number };
export type ResultShift = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
  defaultHeadcount: number;
  areas: ResultArea[];
};

export type AssignmentLike = {
  id?: string;
  date: string;
  shiftId: string;
  areaId: string;
  areaName?: string;
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
  areaId: string;
  areaName: string;
};

export type CalendarRow = {
  date: string;
  shiftId: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  areaId: string;
  areaName: string;
  groupName: string;
  headcount: number;
  people: CalendarPerson[];
  missing: number;
  over: number;
};

export type NameRow = {
  name: string;
  total: number;
  multiAreaSlots: number;
  entries: Array<{
    date: string;
    shiftName: string;
    areaName: string;
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
  areaId: string;
  areaName: string;
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
      areas: { orderBy: { sortOrder: 'asc' } },
      requirements: true,
      assignments: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] },
    },
  });
}

/** 日历排班表：按日期 × 班次 × 区域展示安排人员 */
export function buildCalendarRows(
  shifts: ResultShift[],
  requirements: Array<{ date: string; shiftId: string; areaId: string; headcount: number }>,
  assignments: AssignmentLike[],
): CalendarRow[] {
  const rows: CalendarRow[] = [];
  const dates = [...new Set(requirements.map((requirement) => requirement.date))].sort();
  const areaById = new Map(shifts.flatMap((shift) => shift.areas).map((area) => [area.id, area]));

  for (const date of dates) {
    for (const shift of shifts) {
      for (const area of shift.areas) {
        const requirement = requirements.find(
          (item) => item.date === date && item.shiftId === shift.id && item.areaId === area.id,
        );
        if (!requirement || requirement.headcount <= 0) continue;
        const people = assignments
          .filter(
            (assignment) =>
              assignment.date === date && assignment.shiftId === shift.id && assignment.areaId === area.id,
          )
          .map((assignment) => ({
            assignmentId: assignment.id ?? '',
            name: assignment.name,
            source: resolveSource(assignment.source, assignment.manual),
            manual: Boolean(assignment.manual),
            note: assignment.note ?? null,
            areaId: area.id,
            areaName: area.name,
          }));
        rows.push({
          date,
          shiftId: shift.id,
          shiftName: shift.name,
          startTime: shift.startTime,
          endTime: shift.endTime,
          areaId: area.id,
          areaName: area.name,
          groupName: areaById.get(area.id)?.groupName ?? '默认组',
          headcount: requirement.headcount,
          people,
          missing: Math.max(0, requirement.headcount - people.length),
          over: Math.max(0, people.length - requirement.headcount),
        });
      }
    }
  }
  return rows;
}

/** 姓名排班表：按人员展示其日期、班次与区域 */
export function buildNameRows(shifts: ResultShift[], assignments: AssignmentLike[]): NameRow[] {
  const byName = new Map<string, NameRow>();
  const areaNameById = new Map(shifts.flatMap((shift) => shift.areas).map((area) => [area.id, area.name]));
  const slotCounts = new Map<string, number>();

  for (const assignment of assignments) {
    const slotKey = `${assignment.name}|${assignment.date}|${assignment.shiftId}`;
    slotCounts.set(slotKey, (slotCounts.get(slotKey) ?? 0) + 1);

    const shift = shifts.find((item) => item.id === assignment.shiftId);
    const row = byName.get(assignment.name) ?? { name: assignment.name, total: 0, multiAreaSlots: 0, entries: [] };
    row.entries.push({
      date: assignment.date,
      shiftName: shift?.name ?? '-',
      areaName: assignment.areaName ?? areaNameById.get(assignment.areaId) ?? '-',
      startTime: shift?.startTime ?? '',
      endTime: shift?.endTime ?? '',
      source: resolveSource(assignment.source, assignment.manual),
      manual: Boolean(assignment.manual),
    });
    row.total += 1;
    byName.set(assignment.name, row);
  }

  for (const row of byName.values()) {
    const slots = new Set(row.entries.map((entry) => `${entry.date}|${entry.shiftName}`));
    row.multiAreaSlots = [...slots].filter((slot) => {
      const [date, shiftName] = slot.split('|');
      return (slotCounts.get(`${row.name}|${date}|${shiftName}`) ?? 0) > 1;
    }).length;
    row.entries.sort((a, b) => a.date.localeCompare(b.date) || a.shiftName.localeCompare(b.shiftName));
  }

  return [...byName.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/**
 * 缺口报告：以**实际排班结果**为准（含管理员手动调整），按区域统计。
 */
export async function computeGapsFromAssignments(taskId: string): Promise<GapRow[]> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { shifts: true, areas: true, requirements: true, assignments: { select: { date: true, shiftId: true, areaId: true } } },
  });
  if (!task) return [];

  const shiftById = new Map(task.shifts.map((shift) => [shift.id, shift]));
  const areaById = new Map(task.areas.map((area) => [area.id, area]));
  const filledByKey = new Map<string, number>();
  for (const assignment of task.assignments) {
    const key = `${assignment.date}|${assignment.shiftId}|${assignment.areaId}`;
    filledByKey.set(key, (filledByKey.get(key) ?? 0) + 1);
  }

  const selectionStats = await prisma.selection.groupBy({
    by: ['date', 'shiftId', 'choice'],
    where: { taskId },
    _count: { _all: true },
  });
  const statsBySlot = new Map<string, { preferred: number; backup: number; unavailable: number }>();
  for (const row of selectionStats) {
    const key = `${row.date}|${row.shiftId}`;
    const entry = statsBySlot.get(key) ?? { preferred: 0, backup: 0, unavailable: 0 };
    if (row.choice === 'preferred') entry.preferred += row._count._all;
    else if (row.choice === 'backup') entry.backup += row._count._all;
    else if (row.choice === 'unavailable') entry.unavailable += row._count._all;
    statsBySlot.set(key, entry);
  }

  const gaps: GapRow[] = [];
  for (const requirement of task.requirements) {
    if (requirement.headcount <= 0) continue;
    const key = `${requirement.date}|${requirement.shiftId}|${requirement.areaId}`;
    const filled = filledByKey.get(key) ?? 0;
    if (filled >= requirement.headcount) continue;
    const stats = statsBySlot.get(`${requirement.date}|${requirement.shiftId}`) ?? {
      preferred: 0,
      backup: 0,
      unavailable: 0,
    };
    const reasons: string[] = [];
    if (stats.preferred + stats.backup === 0) reasons.push('该日期班次无任何“首选/次选”意愿');
    else reasons.push('有意愿的人数少于需求（可能受同日单班或区域兼顾上限影响）');
    if (stats.unavailable > 0) reasons.push(`${stats.unavailable} 人标记“无法排班”`);
    if (!task.allowSameDayMultiple) reasons.push('未开启“允许同日多班”，同日只能安排一个班次');
    if (task.areaCoverage !== 'shared') reasons.push('当前为“区域独立分人”模式');
    reasons.push('可在“手动调整”中人工补人，或调整规则后重新匹配');
    gaps.push({
      date: requirement.date,
      shiftId: requirement.shiftId,
      shiftName: shiftById.get(requirement.shiftId)?.name ?? '-',
      areaId: requirement.areaId,
      areaName: areaById.get(requirement.areaId)?.name ?? '-',
      required: requirement.headcount,
      filled,
      missing: Math.max(0, requirement.headcount - filled),
      reasons,
    });
  }
  return gaps;
}

/** 统计：总需求、已安排、各来源人次、兼顾多区域人次、缺口 */
export async function summarizeTaskResult(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { requirements: true, assignments: true },
  });
  if (!task) return null;
  const gaps = await computeGapsFromAssignments(taskId);

  const slotCounts = new Map<string, number>();
  for (const assignment of task.assignments) {
    const key = `${assignment.submissionId}|${assignment.date}|${assignment.shiftId}`;
    slotCounts.set(key, (slotCounts.get(key) ?? 0) + 1);
  }
  const multiAreaAssignments = [...slotCounts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);

  return {
    required: task.requirements.reduce((sum, requirement) => sum + requirement.headcount, 0),
    assigned: task.assignments.length,
    preferred: task.assignments.filter((assignment) => !assignment.manual && assignment.source === 'preferred').length,
    backup: task.assignments.filter((assignment) => !assignment.manual && assignment.source === 'backup').length,
    manual: task.assignments.filter((assignment) => assignment.manual).length,
    multiAreaAssignments,
    gapCount: gaps.reduce((sum, gap) => sum + gap.missing, 0),
    gaps,
  };
}
