// 说明：这里的相对导入带 .ts 扩展名，便于 Node（--experimental-strip-types）直接运行算法做单元验证，
// Next.js/webpack 已通过 extensionAlias 支持该写法。
import { randomUUID } from 'node:crypto';
import { enumerateDates, shiftsOverlap } from './date-utils.ts';
import type { Choice, MatchResult, ScheduleGap } from './types.ts';

/**
 * 自动匹配排班算法
 *
 * 硬约束：
 *  1. 绝不安排用户标记为“无法排班”的班次。
 *  2. 默认同一用户同一天最多安排一个班次。
 *  3. 仅当管理员开启“允许同日多班”，且两个班次时间完全不重叠时，才可同日多班。
 *  4. 每人每天每个班次的安排不超过 1 次。
 *
 * 优先级：第一轮首选 -> 第二轮次选 -> 第三轮记录缺口（不使用“无法”）。
 * 超额分配公平规则（可复现）：历史排班次数少者优先 -> 提交时间早者优先 -> 固定随机种子打散同分者。
 */

export type MatchShift = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
};

export type MatchRequirement = {
  date: string;
  shiftId: string;
  headcount: number;
};

export type MatchSubmission = {
  id: string;
  name: string;
  /** 提交时间（越早优先级越高） */
  submittedAt: Date | string;
  /** 历史排班次数（越少优先级越高） */
  historyCount: number;
  /** key 为 `${date}|${shiftId}` */
  choices: Map<string, { choice: Choice; reason?: string | null }>;
};

export type MatchInput = {
  shifts: MatchShift[];
  requirements: MatchRequirement[];
  submissions: MatchSubmission[];
  allowSameDayMultiple: boolean;
  seed: number;
  /** 同一用户同日多班时，允许的最多班次数（默认不限，受时间重叠约束） */
  maxShiftsPerDay?: number;
};

/** mulberry32：小巧、确定性、跨平台的伪随机数发生器 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function resolveSeed(seed: number | null | undefined, salt = ''): number {
  if (typeof seed === 'number' && Number.isFinite(seed) && seed > 0) return Math.floor(seed) % 2147483647;
  return hashStringToSeed(`${Date.now()}-${salt}-${randomUUID()}`) % 2147483647;
}

export function matchSchedule(input: MatchInput): MatchResult {
  const random = mulberry32(input.seed);
  const shiftsById = new Map(input.shifts.map((s) => [s.id, s]));

  // 每个用户在同一日期已占用的班次（用于时间重叠判定）
  const userDaySlots = new Map<string, Array<{ startTime: string; endTime: string }>>();
  // 每人每天已安排班次数
  const userDayCount = new Map<string, number>();
  const userTotalCount = new Map<string, number>();
  const maxPerDay = input.maxShiftsPerDay && input.maxShiftsPerDay > 0 ? input.maxShiftsPerDay : 99;

  const batchId = randomUUID();
  const assignments: MatchResult['assignments'] = [];

  const canAssign = (
    submission: MatchSubmission,
    date: string,
    shift: MatchShift,
  ): boolean => {
    const dayKey = `${submission.id}|${date}`;
    const count = userDayCount.get(dayKey) ?? 0;
    if (count === 0) return true;
    // 默认同日最多一个班次
    if (!input.allowSameDayMultiple) return false;
    if (count >= maxPerDay) return false;
    // 已占用的班次必须与目标班次时间完全不重叠
    const slots = userDaySlots.get(dayKey) ?? [];
    return slots.every((slot) => !shiftsOverlap(slot, shift));
  };

  const assign = (submission: MatchSubmission, date: string, shiftId: string, source: 'preferred' | 'backup') => {
    const shift = shiftsById.get(shiftId);
    if (!shift) return;
    const dayKey = `${submission.id}|${date}`;
    userDaySlots.set(dayKey, [...(userDaySlots.get(dayKey) ?? []), { startTime: shift.startTime, endTime: shift.endTime }]);
    userDayCount.set(dayKey, (userDayCount.get(dayKey) ?? 0) + 1);
    userTotalCount.set(submission.id, (userTotalCount.get(submission.id) ?? 0) + 1);
    assignments.push({
      date,
      shiftId,
      shiftName: shift.name,
      submissionId: submission.id,
      name: submission.name,
      source,
      historyCount: submission.historyCount,
    });
  };

  const submittedAtMs = (s: MatchSubmission) =>
    (typeof s.submittedAt === 'string' ? new Date(s.submittedAt) : s.submittedAt).getTime();

  /** 排序：历史排班少 -> 提交早 -> 随机种子（保证可复现） */
  const sortCandidates = (list: MatchSubmission[]): MatchSubmission[] => {
    const withNoise = list.map((s) => ({ s, noise: random() }));
    withNoise.sort((a, b) => {
      if (a.s.historyCount !== b.s.historyCount) return a.s.historyCount - b.s.historyCount;
      const ta = submittedAtMs(a.s);
      const tb = submittedAtMs(b.s);
      if (ta !== tb) return ta - tb;
      if (a.noise !== b.noise) return a.noise - b.noise;
      return a.s.id.localeCompare(b.s.id);
    });
    return withNoise.map((entry) => entry.s);
  };

  // 需求按日期+班次去重合并
  const requirementMap = new Map<string, MatchRequirement>();
  for (const req of input.requirements) {
    if (!shiftsById.has(req.shiftId)) continue;
    const key = `${req.date}|${req.shiftId}`;
    const existing = requirementMap.get(key);
    if (existing) existing.headcount += req.headcount;
    else requirementMap.set(key, { ...req });
  }

  const requirements = [...requirementMap.values()]
    .filter((r) => r.headcount > 0)
    .sort((a, b) => (a.date === b.date ? a.shiftId.localeCompare(b.shiftId) : a.date.localeCompare(b.date)));

  const gaps: ScheduleGap[] = [];
  let totalRequired = 0;

  for (const req of requirements) {
    totalRequired += req.headcount;
    const shift = shiftsById.get(req.shiftId);
    if (!shift) continue;
    const key = `${req.date}|${req.shiftId}`;

    const poolFor = (choice: Choice) =>
      input.submissions.filter((s) => s.choices.get(key)?.choice === choice);

    const preferredPool = poolFor('preferred');
    const backupPool = poolFor('backup');
    const unavailableReasons = input.submissions
      .filter((s) => s.choices.get(key)?.choice === 'unavailable')
      .map((s) => (s.choices.get(key)?.reason ?? '').trim())
      .filter(Boolean);

    let filled = 0;

    // 第一轮：首选
    for (const candidate of sortCandidates(preferredPool)) {
      if (filled >= req.headcount) break;
      if (canAssign(candidate, req.date, shift)) {
        assign(candidate, req.date, shift.id, 'preferred');
        filled += 1;
      }
    }

    // 第二轮：次选补充
    if (filled < req.headcount) {
      for (const candidate of sortCandidates(backupPool)) {
        if (filled >= req.headcount) break;
        if (canAssign(candidate, req.date, shift)) {
          assign(candidate, req.date, shift.id, 'backup');
          filled += 1;
        }
      }
    }

    // 第三轮：仍不足 -> 记录缺口（绝不安排“无法”）
    if (filled < req.headcount) {
      const missing = req.headcount - filled;
      const reasons: string[] = [];
      if (preferredPool.length + backupPool.length === 0) {
        reasons.push('该日期班次无任何用户选择首选或次选');
      }
      if (preferredPool.length + backupPool.length > 0 && filled === 0) {
        reasons.push('有意愿用户均已在该日被安排其他班次（同日单班约束）');
      }
      if (filled > 0 && missing > 0) {
        reasons.push('可安排意愿人数少于需求人数');
      }
      if (unavailableReasons.length > 0) {
        reasons.push(`另有 ${unavailableReasons.length} 人标记无法排班`);
      }
      if (!input.allowSameDayMultiple) {
        reasons.push('未开启“允许同日多班”，同日只能安排一个班次');
      }
      reasons.push('不强行安排“无法排班”用户');
      gaps.push({
        date: req.date,
        shiftId: shift.id,
        shiftName: shift.name,
        required: req.headcount,
        filled,
        missing,
        reasons: [...new Set(reasons)],
      });
    }
  }

  const feasible = gaps.length === 0;
  const totalAssigned = assignments.length;
  const summary = feasible
    ? `全部满足：共 ${requirements.length} 个“日期+班次”需求，安排 ${totalAssigned} 人次（种子 ${input.seed}）。`
    : `存在缺口：${gaps.length} 个“日期+班次”未满足，共缺 ${gaps.reduce((sum, g) => sum + g.missing, 0)} 人次（种子 ${input.seed}）。`;

  return {
    feasible,
    seed: input.seed,
    batchId,
    assignments: feasible ? assignments : [],
    gaps,
    totalRequired,
    totalAssigned: feasible ? totalAssigned : 0,
    summary,
  };
}

/** 计算每个人在“其他历史任务”中的排班次数，用于公平规则 */
export function historyKey(taskId: string, nameKey: string): string {
  return `${taskId}::${nameKey}`;
}

export { enumerateDates };
