import { prisma } from '@/lib/prisma';
import { normalizeName } from '@/lib/roster';

export type SubmissionSummary = {
  id: string;
  name: string;
  empNo: string | null;
  dept: string | null;
  onRoster: boolean;
  status: string;
  updatedAt: Date;
  createdAt: Date;
  preferredCount: number;
  backupCount: number;
  unavailableCount: number;
};

export type RosterComparison = {
  rosterTotal: number;
  submittedOnRoster: Array<{ name: string; empNo: string | null; dept: string | null; updatedAt: Date }>;
  notSubmitted: Array<{ name: string; empNo: string | null; dept: string | null }>;
  offRoster: Array<{ name: string; updatedAt: Date }>;
};

export type ReasonRow = {
  date: string;
  shiftId: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  name: string;
  reason: string;
  dept: string | null;
  empNo: string | null;
};

export async function getSubmissionSummaries(taskId: string): Promise<SubmissionSummary[]> {
  const submissions = await prisma.submission.findMany({
    where: { taskId },
    orderBy: { updatedAt: 'asc' },
    select: {
      id: true,
      name: true,
      empNo: true,
      dept: true,
      onRoster: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      selections: { select: { choice: true } },
    },
  });

  return submissions.map((submission) => ({
    id: submission.id,
    name: submission.name,
    empNo: submission.empNo,
    dept: submission.dept,
    onRoster: submission.onRoster,
    status: submission.status,
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt,
    preferredCount: submission.selections.filter((s) => s.choice === 'preferred').length,
    backupCount: submission.selections.filter((s) => s.choice === 'backup').length,
    unavailableCount: submission.selections.filter((s) => s.choice === 'unavailable').length,
  }));
}

export async function getRosterComparison(taskId: string): Promise<RosterComparison> {
  const [roster, submissions] = await Promise.all([
    prisma.rosterEntry.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } }),
    prisma.submission.findMany({
      where: { taskId },
      select: { id: true, name: true, nameKey: true, updatedAt: true },
    }),
  ]);

  const submissionByKey = new Map(submissions.map((s) => [s.nameKey, s]));
  const rosterKeys = new Set(roster.map((entry) => entry.nameKey));

  const submittedOnRoster = roster
    .filter((entry) => submissionByKey.has(entry.nameKey))
    .map((entry) => {
      const submission = submissionByKey.get(entry.nameKey)!;
      return { name: entry.name, empNo: entry.empNo, dept: entry.dept, updatedAt: submission.updatedAt };
    });

  const notSubmitted = roster
    .filter((entry) => !submissionByKey.has(entry.nameKey))
    .map((entry) => ({ name: entry.name, empNo: entry.empNo, dept: entry.dept }));

  const offRoster = submissions
    .filter((submission) => !rosterKeys.has(submission.nameKey))
    .map((submission) => ({ name: submission.name, updatedAt: submission.updatedAt }));

  return { rosterTotal: roster.length, submittedOnRoster, notSubmitted, offRoster };
}

/** 汇总所有“无法排班”理由 */
export async function getUnavailableReasons(taskId: string): Promise<ReasonRow[]> {
  const rows = await prisma.selection.findMany({
    where: { taskId, choice: 'unavailable' },
    orderBy: [{ date: 'asc' }, { shift: { sortOrder: 'asc' } }, { submission: { name: 'asc' } }],
    select: {
      date: true,
      reason: true,
      shiftId: true,
      shift: { select: { name: true, startTime: true, endTime: true } },
      submission: { select: { name: true, dept: true, empNo: true } },
    },
  });

  return rows.map((row) => ({
    date: row.date,
    shiftId: row.shiftId,
    shiftName: row.shift.name,
    startTime: row.shift.startTime,
    endTime: row.shift.endTime,
    name: row.submission.name,
    reason: row.reason ?? '',
    dept: row.submission.dept,
    empNo: row.submission.empNo,
  }));
}

/** 任务填写进度统计 */
export async function getFillProgress(taskId: string) {
  const [submissionCount, rosterCount, requiredTotal] = await Promise.all([
    prisma.submission.count({ where: { taskId } }),
    prisma.rosterEntry.count({ where: { taskId } }),
    prisma.taskDayRequirement.count({ where: { taskId } }),
  ]);

  return {
    submitted: submissionCount,
    // 应填写人数：上传名单时以名单人数为准，否则以已提交人数为参考
    expected: rosterCount,
    pending: rosterCount > 0 ? Math.max(0, rosterCount - submissionCount) : 0,
    requiredTotal,
  };
}

/** 名单内 + 名单外的姓名集合，用于填写端姓名下拉/校验 */
export function buildNameIndex(roster: Array<{ name: string; empNo: string | null; dept: string | null }>) {
  return roster.map((entry) => ({
    name: entry.name,
    empNo: entry.empNo,
    dept: entry.dept,
    key: normalizeName(entry.name),
  }));
}
