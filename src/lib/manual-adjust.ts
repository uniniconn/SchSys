import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/session';
import { isDateString, shiftsOverlap } from '@/lib/date-utils';

/**
 * 手动调整排班的核心逻辑（UI 的 Server Action 与 HTTP API 共用）。
 * 区域化后：按“日期 + 班次 + 区域”增删；同一时段跨组禁止、同组受每人上限约束。
 * 所有写操作都会写入操作日志。
 */

export type ManualResult = {
  ok?: string;
  error?: string;
  warning?: string;
  assignmentId?: string;
  status?: number;
};

type AddInput = {
  taskId: string;
  date: string;
  shiftId: string;
  areaId: string;
  submissionId: string;
  note?: string;
  adminId: string;
};

async function loadTask(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { shifts: true, areas: true },
  });
  return task;
}

export async function addManualAssignment(input: AddInput): Promise<ManualResult> {
  const { taskId, date, shiftId, areaId, submissionId, adminId } = input;
  const note = (input.note ?? '').trim();

  if (!taskId || !date || !shiftId || !areaId || !submissionId) return { error: '参数不完整', status: 400 };
  if (!isDateString(date)) return { error: '日期格式无效', status: 400 };
  if (note.length > 200) return { error: '调整说明不能超过 200 字', status: 400 };

  const task = await loadTask(taskId);
  if (!task) return { error: '任务不存在', status: 404 };
  if (task.status !== 'confirmed' && task.status !== 'matched') {
    return { error: '请先完成「截止并确认」，再进行手动调整', status: 409 };
  }

  const shift = task.shifts.find((item) => item.id === shiftId);
  if (!shift) return { error: '班次不存在', status: 404 };
  const area = task.areas.find((item) => item.id === areaId && item.shiftId === shiftId);
  if (!area) return { error: '区域不存在或不属于该班次', status: 404 };

  const requirement = await prisma.taskDayRequirement.findFirst({ where: { taskId, shiftId, areaId, date } });
  if (!requirement || requirement.headcount <= 0) {
    return { error: `「${date} ${shift.name} ${area.name}」没有排班需求，无法添加人员`, status: 400 };
  }

  const submission = await prisma.submission.findFirst({ where: { id: submissionId, taskId } });
  if (!submission) return { error: '该填写记录不存在或不属于本任务', status: 404 };

  const duplicate = await prisma.assignment.findFirst({ where: { taskId, date, shiftId, areaId, submissionId } });
  if (duplicate) return { error: `${submission.name} 已经在该日期该班次该区域中`, status: 409 };

  // 意愿是按“日期+班次”记录的（填写端不区分区域）
  const selection = await prisma.selection.findFirst({ where: { submissionId, shiftId, date } });
  if (selection?.choice === 'unavailable') {
    return {
      error: `${submission.name} 在「${date} ${shift.name}」已标记“无法排班”（理由：${selection.reason?.trim() || '未填写'}），不能强行安排`,
      status: 409,
    };
  }

  const warnings: string[] = [];

  // 同一时段的其他区域安排
  const slotAssignments = await prisma.assignment.findMany({
    where: { taskId, date, shiftId, submissionId },
    include: { area: true },
  });
  if (slotAssignments.length > 0) {
    if (task.areaCoverage !== 'shared') {
      return { error: `当前为“区域独立分人”模式，${submission.name} 在同一时段只能安排一个区域`, status: 409 };
    }
    const otherGroups = new Set(slotAssignments.map((item) => item.area.groupName));
    if (!otherGroups.has(area.groupName)) {
      return {
        error: `同一时段不允许跨区域组兼顾（${submission.name} 已在「${[...otherGroups].join('、')}」）`,
        status: 409,
      };
    }
    if (slotAssignments.length >= task.maxAreasPerPerson) {
      return {
        error: `${submission.name} 在该时段已兼顾 ${slotAssignments.length} 个区域，达到上限 ${task.maxAreasPerPerson}`,
        status: 409,
      };
    }
    warnings.push(`${submission.name} 在同一时段还将兼顾其他区域（${slotAssignments.map((item) => item.area.name).join('、')}）`);
  }

  // 同日其他班次的时间重叠提示（沿用同日单班规则）
  const sameDayOtherShifts = await prisma.assignment.findMany({
    where: { taskId, date, submissionId, shiftId: { not: shiftId } },
  });
  if (sameDayOtherShifts.length > 0) {
    if (!task.allowSameDayMultiple) {
      warnings.push(`${submission.name} 同一天已安排其他班次（当前设置为“同一人同一天最多一个班次”）`);
    } else {
      const otherShiftIds = [...new Set(sameDayOtherShifts.map((item) => item.shiftId))];
      const otherShifts = await prisma.shift.findMany({ where: { id: { in: otherShiftIds } } });
      const overlapping = otherShifts.filter((other) => shiftsOverlap(other, shift));
      if (overlapping.length > 0) warnings.push(`与同日班次「${overlapping.map((item) => item.name).join('、')}」时间重叠`);
    }
  }

  // 工作量上限提示（管理员手动安排仍允许，但明确提示）
  const totalAssigned = await prisma.assignment.count({ where: { taskId, submissionId } });
  const effectiveMax =
    submission.maxAssignments !== null && submission.maxAssignments !== undefined
      ? submission.maxAssignments
      : submission.workloadPreference === 'less'
        ? task.lessDefaultMax
        : null;
  if (effectiveMax !== null && effectiveMax !== undefined && totalAssigned >= effectiveMax) {
    warnings.push(`${submission.name} 已达工作量上限（${totalAssigned}/${effectiveMax}），本次为超限安排`);
  }

  const areaFilled = await prisma.assignment.count({ where: { taskId, date, shiftId, areaId } });
  if (areaFilled >= requirement.headcount) {
    warnings.push(`该区域已达需求人数（${areaFilled}/${requirement.headcount}），本次为超员安排`);
  }

  const source = selection?.choice === 'backup' ? 'backup' : selection?.choice === 'preferred' ? 'preferred' : 'manual';

  const created = await prisma.assignment.create({
    data: {
      taskId,
      shiftId,
      areaId,
      date,
      submissionId,
      name: submission.name,
      source,
      batchId: 'manual',
      seed: task.matchSeed ?? 0,
      historyCount: 0,
      manual: true,
      note: note || null,
    },
  });

  await writeAuditLog({
    adminId,
    taskId,
    action: 'task.assignment.add',
    detail: `手动添加：${date} ${shift.name} / ${area.name} → ${submission.name}（${
      source === 'preferred' ? '其首选' : source === 'backup' ? '其次选' : '手动指定'
    }）${note ? `；说明：${note}` : ''}`,
  });

  return {
    ok: `已添加 ${submission.name} 到 ${date} ${shift.name} / ${area.name}`,
    warning: warnings.length > 0 ? warnings.join('；') : undefined,
    assignmentId: created.id,
  };
}

export async function removeAssignment(input: {
  taskId: string;
  assignmentId: string;
  adminId: string;
}): Promise<ManualResult> {
  const { taskId, assignmentId, adminId } = input;
  if (!taskId || !assignmentId) return { error: '参数不完整', status: 400 };

  const task = await loadTask(taskId);
  if (!task) return { error: '任务不存在', status: 404 };
  if (task.status !== 'confirmed' && task.status !== 'matched') {
    return { error: '请先完成「截止并确认」，再进行手动调整', status: 409 };
  }

  const assignment = await prisma.assignment.findFirst({ where: { id: assignmentId, taskId }, include: { area: true } });
  if (!assignment) return { error: '排班记录不存在', status: 404 };
  const shift = task.shifts.find((item) => item.id === assignment.shiftId);

  await prisma.assignment.delete({ where: { id: assignmentId } });
  await writeAuditLog({
    adminId,
    taskId,
    action: 'task.assignment.remove',
    detail: `手动移除：${assignment.date} ${shift?.name ?? ''} / ${assignment.area?.name ?? ''} → ${assignment.name}${
      assignment.manual ? '（原为手动安排）' : ''
    }`,
  });

  return { ok: `已移除 ${assignment.name}（${assignment.date} ${shift?.name ?? ''} / ${assignment.area?.name ?? ''}）` };
}

export async function updateAssignmentNote(input: {
  taskId: string;
  assignmentId: string;
  note: string;
  adminId: string;
}): Promise<ManualResult> {
  const note = (input.note ?? '').trim();
  if (!input.taskId || !input.assignmentId) return { error: '参数不完整', status: 400 };
  if (note.length > 200) return { error: '调整说明不能超过 200 字', status: 400 };

  const assignment = await prisma.assignment.findFirst({ where: { id: input.assignmentId, taskId: input.taskId } });
  if (!assignment) return { error: '排班记录不存在', status: 404 };

  await prisma.assignment.update({ where: { id: input.assignmentId }, data: { note: note || null } });
  await writeAuditLog({
    adminId: input.adminId,
    taskId: input.taskId,
    action: 'task.assignment.note',
    detail: `修改排班说明：${assignment.date} → ${assignment.name}：${note || '(清空)'}`,
  });

  return { ok: '说明已保存' };
}

export async function clearManualAssignments(input: { taskId: string; adminId: string }): Promise<ManualResult> {
  const { taskId, adminId } = input;
  if (!taskId) return { error: '参数不完整', status: 400 };

  const count = await prisma.assignment.count({ where: { taskId, manual: true } });
  if (count === 0) return { ok: '没有手动添加的排班记录' };

  await prisma.assignment.deleteMany({ where: { taskId, manual: true } });
  await writeAuditLog({
    adminId,
    taskId,
    action: 'task.assignment.clear_manual',
    detail: `清空手动调整记录 ${count} 条`,
  });

  return { ok: `已清空 ${count} 条手动调整记录` };
}

export type CandidateItem = {
  id: string;
  name: string;
  empNo: string | null;
  dept: string | null;
  onRoster: boolean;
  choice: 'preferred' | 'backup' | 'unavailable' | 'none';
  reason: string | null;
  assignedHere: boolean;
  sameDayOther: boolean;
  slotAreas: number;
  eligible: boolean;
};

/** 指定「日期 + 班次 + 区域」的候选人列表（意愿按日期+班次） */
export async function listCandidates(input: {
  taskId: string;
  date: string;
  shiftId: string;
  areaId: string;
}): Promise<
  | { error: string; status: number }
  | {
      date: string;
      shift: { id: string; name: string; startTime: string; endTime: string };
      area: { id: string; name: string; groupName: string };
      headcount: number;
      filled: number;
      items: CandidateItem[];
    }
> {
  const { taskId, date, shiftId, areaId } = input;
  if (!isDateString(date) || !shiftId || !areaId) return { error: '参数不完整', status: 400 };

  const task = await loadTask(taskId);
  if (!task) return { error: '任务不存在', status: 404 };
  const shift = task.shifts.find((item) => item.id === shiftId);
  if (!shift) return { error: '班次不存在', status: 404 };
  const area = task.areas.find((item) => item.id === areaId && item.shiftId === shiftId);
  if (!area) return { error: '区域不存在或不属于该班次', status: 404 };

  const requirement = await prisma.taskDayRequirement.findFirst({ where: { taskId, shiftId, areaId, date } });
  if (!requirement) return { error: '该日期没有这个区域的需求', status: 404 };

  const [submissions, areaAssignments, slotAssignments, sameDayAssignments] = await Promise.all([
    prisma.submission.findMany({
      where: { taskId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        empNo: true,
        dept: true,
        onRoster: true,
        selections: { where: { date, shiftId }, select: { choice: true, reason: true } },
      },
    }),
    prisma.assignment.findMany({ where: { taskId, date, shiftId, areaId }, select: { submissionId: true } }),
    prisma.assignment.findMany({ where: { taskId, date, shiftId }, select: { submissionId: true, area: { select: { groupName: true } } } }),
    prisma.assignment.findMany({ where: { taskId, date, shiftId: { not: shiftId } }, select: { submissionId: true } }),
  ]);

  const assignedHere = new Set(areaAssignments.map((row) => row.submissionId));
  const slotCount = new Map<string, number>();
  const slotGroups = new Map<string, Set<string>>();
  for (const row of slotAssignments) {
    slotCount.set(row.submissionId, (slotCount.get(row.submissionId) ?? 0) + 1);
    if (!slotGroups.has(row.submissionId)) slotGroups.set(row.submissionId, new Set());
    slotGroups.get(row.submissionId)!.add(row.area.groupName);
  }
  const sameDayOther = new Set(sameDayAssignments.map((row) => row.submissionId));

  const order: Record<string, number> = { preferred: 0, backup: 1, none: 2, unavailable: 3 };
  const items: CandidateItem[] = submissions
    .map((submission) => {
      const selection = submission.selections[0] ?? null;
      const choice = (selection?.choice ?? 'none') as CandidateItem['choice'];
      const groups = slotGroups.get(submission.id) ?? new Set<string>();
      const crossGroup = groups.size > 0 && !groups.has(area.groupName);
      const reachedAreaLimit = (slotCount.get(submission.id) ?? 0) >= task.maxAreasPerPerson;
      const exclusiveConflict = task.areaCoverage !== 'shared' && (slotCount.get(submission.id) ?? 0) > 0;
      return {
        id: submission.id,
        name: submission.name,
        empNo: submission.empNo,
        dept: submission.dept,
        onRoster: submission.onRoster,
        choice,
        reason: selection?.reason ?? null,
        assignedHere: assignedHere.has(submission.id),
        sameDayOther: sameDayOther.has(submission.id),
        slotAreas: slotCount.get(submission.id) ?? 0,
        eligible:
          choice !== 'unavailable' &&
          !assignedHere.has(submission.id) &&
          !crossGroup &&
          !reachedAreaLimit &&
          !exclusiveConflict,
      };
    })
    .sort((a, b) => {
      const diff = (order[a.choice] ?? 9) - (order[b.choice] ?? 9);
      return diff !== 0 ? diff : a.name.localeCompare(b.name, 'zh-CN');
    });

  return {
    date,
    shift: { id: shift.id, name: shift.name, startTime: shift.startTime, endTime: shift.endTime },
    area: { id: area.id, name: area.name, groupName: area.groupName },
    headcount: requirement.headcount,
    filled: areaAssignments.length,
    items,
  };
}
