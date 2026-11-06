// 说明：这里的相对导入带 .ts 扩展名，便于 Node（--experimental-strip-types）直接运行算法做单元验证，
// Next.js/webpack 已通过 extensionAlias 支持该写法。
import { randomUUID } from 'node:crypto';
import { enumerateDates, shiftsOverlap } from './date-utils.ts';
import type { Choice, MatchResult, ScheduleGap } from './types.ts';

/**
 * 自动匹配排班算法（v1.3：区域化 + 工作量偏好）
 *
 * 硬约束：
 *  1. 绝不安排用户标记为“无法排班”的班次。
 *  2. 默认同一用户同一天最多安排一个班次。
 *  3. 仅当管理员开启“允许同日多班”，且两个班次时间完全不重叠时，才可同日多班。
 *  4. 每人每天每个班次最多出现一次；同一时段最多进入一个“距离组”。
 *  5. maxAssignments（或少排默认上限）为硬上限。
 *
 * 两阶段：
 *  阶段 1：按“时段需求人数”供人（首选 → 次选 → 缺口）。
 *          时段需求 = Σ 组需求；组需求：shared=组内区域人数最大值，exclusive=组内区域人数之和。
 *  阶段 2：时段内把人员分配到各区域：
 *          shared 允许多人多区域（受 maxAreasPerPerson 限制），exclusive 区域之间不重复。
 *
 * 公平与复现：工作量大→小、历史次数少→多、提交早→晚、固定种子随机。
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
  areaId: string;
  areaName: string;
  groupName: string;
  headcount: number;
};

export type WorkloadPreference = 'more' | 'normal' | 'less';

export type MatchSubmission = {
  id: string;
  name: string;
  /** 提交时间（越早优先级越高） */
  submittedAt: Date | string;
  /** 历史排班次数（越少优先级越高） */
  historyCount: number;
  workloadPreference?: WorkloadPreference;
  /** 最多可排班次数（硬上限） */
  maxAssignments?: number | null;
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
  /** 区域分人模式 */
  areaCoverage?: 'shared' | 'exclusive';
  /** shared 模式下每人每时段最多兼顾的区域数 */
  maxAreasPerPerson?: number;
  /** 少排偏好的默认上限（未填 maxAssignments 时生效） */
  lessDefaultMax?: number | null;
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

const WORKLOAD_RANK: Record<WorkloadPreference, number> = { more: 0, normal: 1, less: 2 };

export function slotGroupDemand(
  areas: Array<{ headcount: number }>,
  coverage: 'shared' | 'exclusive',
  maxAreasPerPerson = 2,
): number {
  if (areas.length === 0) return 0;
  const counts = areas.map((area) => Math.max(0, area.headcount));
  if (coverage === 'exclusive') return counts.reduce((sum, count) => sum + count, 0);
  const maxCount = Math.max(...counts);
  const totalCount = counts.reduce((sum, count) => sum + count, 0);
  // shared：一个人最多覆盖 maxAreasPerPerson 个区域，同时至少要满足“人数最多的区域”
  return Math.max(maxCount, Math.ceil(totalCount / Math.max(1, maxAreasPerPerson)));
}

export function matchSchedule(input: MatchInput): MatchResult {
  const random = mulberry32(input.seed);
  const shiftsById = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const coverage = input.areaCoverage === 'exclusive' ? 'exclusive' : 'shared';
  const maxAreasPerPerson = Math.max(1, Math.min(10, input.maxAreasPerPerson ?? 2));

  const userDaySlots = new Map<string, Array<{ startTime: string; endTime: string }>>();
  const userDayCount = new Map<string, number>();
  const userSlotTotal = new Map<string, number>();
  const sourceBySlot = new Map<string, 'preferred' | 'backup'>();
  const maxPerDay = input.maxShiftsPerDay && input.maxShiftsPerDay > 0 ? input.maxShiftsPerDay : 99;

  const batchId = randomUUID();
  const assignments: MatchResult['assignments'] = [];
  const gaps: ScheduleGap[] = [];

  const capFor = (submission: MatchSubmission): number => {
    if (submission.maxAssignments !== null && submission.maxAssignments !== undefined && submission.maxAssignments >= 0) {
      return submission.maxAssignments;
    }
    if (submission.workloadPreference === 'less' && input.lessDefaultMax !== null && input.lessDefaultMax !== undefined) {
      return Math.max(0, input.lessDefaultMax);
    }
    return Number.POSITIVE_INFINITY;
  };

  const canAssign = (submission: MatchSubmission, date: string, shift: MatchShift): boolean => {
    const dayKey = `${submission.id}|${date}`;
    const count = userDayCount.get(dayKey) ?? 0;
    if (count === 0) return true;
    if (!input.allowSameDayMultiple) return false;
    if (count >= maxPerDay) return false;
    const slots = userDaySlots.get(dayKey) ?? [];
    return slots.every((slot) => !shiftsOverlap(slot, shift));
  };

  const submittedAtMs = (s: MatchSubmission) =>
    (typeof s.submittedAt === 'string' ? new Date(s.submittedAt) : s.submittedAt).getTime();

  const workloadOf = (s: MatchSubmission): WorkloadPreference =>
    s.workloadPreference === 'more' || s.workloadPreference === 'less' ? s.workloadPreference : 'normal';

  /** 排序：工作量偏好（多→正常→少）-> 历史少 -> 提交早 -> 随机种子 */
  const sortCandidates = (list: MatchSubmission[]): MatchSubmission[] => {
    const withNoise = list.map((submission) => ({ submission, noise: random() }));
    withNoise.sort((a, b) => {
      const rankA = WORKLOAD_RANK[workloadOf(a.submission)];
      const rankB = WORKLOAD_RANK[workloadOf(b.submission)];
      if (rankA !== rankB) return rankA - rankB;
      if (a.submission.historyCount !== b.submission.historyCount) {
        return a.submission.historyCount - b.submission.historyCount;
      }
      const ta = submittedAtMs(a.submission);
      const tb = submittedAtMs(b.submission);
      if (ta !== tb) return ta - tb;
      if (a.noise !== b.noise) return a.noise - b.noise;
      return a.submission.id.localeCompare(b.submission.id);
    });
    return withNoise.map((entry) => entry.submission);
  };

  // 需求去重（同一日期+班次+区域）
  const requirementMap = new Map<string, MatchRequirement>();
  for (const requirement of input.requirements) {
    if (!shiftsById.has(requirement.shiftId)) continue;
    if (requirement.headcount <= 0) continue;
    const key = `${requirement.date}|${requirement.shiftId}|${requirement.areaId}`;
    const existing = requirementMap.get(key);
    if (existing) existing.headcount += requirement.headcount;
    else requirementMap.set(key, { ...requirement });
  }

  // 按“日期+班次”聚合区域
  const slotMap = new Map<
    string,
    { date: string; shiftId: string; areas: MatchRequirement[] }
  >();
  for (const requirement of requirementMap.values()) {
    const key = `${requirement.date}|${requirement.shiftId}`;
    if (!slotMap.has(key)) slotMap.set(key, { date: requirement.date, shiftId: requirement.shiftId, areas: [] });
    slotMap.get(key)!.areas.push(requirement);
  }

  const slots = [...slotMap.values()].sort((a, b) =>
    a.date === b.date ? a.shiftId.localeCompare(b.shiftId) : a.date.localeCompare(b.date),
  );

  let totalRequired = 0;

  for (const slot of slots) {
    const shift = shiftsById.get(slot.shiftId);
    if (!shift) continue;

    // 按时段需求供人
    const groups = new Map<string, MatchRequirement[]>();
    for (const area of slot.areas) {
      const group = area.groupName || '默认组';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(area);
    }
    const sortedGroups = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const demandByGroup = new Map<string, number>();
    let slotDemand = 0;
    totalRequired += slot.areas.reduce((sum, area) => sum + Math.max(0, area.headcount), 0);
    for (const group of sortedGroups) {
      const demand = slotGroupDemand(groups.get(group)!, coverage, maxAreasPerPerson);
      demandByGroup.set(group, demand);
      slotDemand += demand;
    }

    const key = `${slot.date}|${slot.shiftId}`;
    const poolFor = (choice: Choice) => input.submissions.filter((s) => s.choices.get(key)?.choice === choice);

    const preferredPool = poolFor('preferred');
    const backupPool = poolFor('backup');
    const unavailableReasons = input.submissions
      .filter((s) => s.choices.get(key)?.choice === 'unavailable')
      .map((s) => (s.choices.get(key)?.reason ?? '').trim())
      .filter(Boolean);

    let capped = 0;
    let sameDayBlocked = 0;
    const slotPeople: MatchSubmission[] = [];

    const tryFill = (pool: MatchSubmission[], source: 'preferred' | 'backup') => {
      for (const candidate of sortCandidates(pool)) {
        if (slotPeople.length >= slotDemand) break;
        if ((userSlotTotal.get(candidate.id) ?? 0) >= capFor(candidate)) {
          capped += 1;
          continue;
        }
        if (!canAssign(candidate, slot.date, shift)) {
          sameDayBlocked += 1;
          continue;
        }
        slotPeople.push(candidate);
        const dayKey = `${candidate.id}|${slot.date}`;
        userDaySlots.set(dayKey, [
          ...(userDaySlots.get(dayKey) ?? []),
          { startTime: shift.startTime, endTime: shift.endTime },
        ]);
        userDayCount.set(dayKey, (userDayCount.get(dayKey) ?? 0) + 1);
        userSlotTotal.set(candidate.id, (userSlotTotal.get(candidate.id) ?? 0) + 1);
        sourceBySlot.set(`${candidate.id}|${key}`, source);
      }
    };

    tryFill(preferredPool, 'preferred');
    if (slotPeople.length < slotDemand) tryFill(backupPool, 'backup');

    // 把时段人员分配到各区域
    const assignmentCountByArea = new Map<string, number>();
    const groupPeopleCounts = new Map<string, number>();
    let cursor = 0;
    for (const group of sortedGroups) {
      const areas = [...groups.get(group)!].sort(
        (a, b) => b.headcount - a.headcount || a.areaId.localeCompare(b.areaId),
      );
      const groupDemand = demandByGroup.get(group) ?? 0;
      const groupPeople = slotPeople.slice(cursor, cursor + groupDemand);
      cursor += groupDemand;
      groupPeopleCounts.set(group, groupPeople.length);

      const assignToArea = (submission: MatchSubmission, area: MatchRequirement) => {
        const source = sourceBySlot.get(`${submission.id}|${key}`) ?? 'preferred';
        assignments.push({
          date: slot.date,
          shiftId: slot.shiftId,
          shiftName: shift.name,
          areaId: area.areaId,
          areaName: area.areaName,
          submissionId: submission.id,
          name: submission.name,
          source,
          historyCount: submission.historyCount,
          multiArea: false,
        });
        assignmentCountByArea.set(area.areaId, (assignmentCountByArea.get(area.areaId) ?? 0) + 1);
      };

      if (groupPeople.length === 0) continue;

      if (coverage === 'exclusive') {
        const used = new Set<string>();
        const sortedPeople = [...groupPeople].sort(
          (a, b) => (userSlotTotal.get(a.id) ?? 0) - (userSlotTotal.get(b.id) ?? 0) || submittedAtMs(a) - submittedAtMs(b),
        );
        for (const area of areas) {
          for (const person of sortedPeople) {
            if ((assignmentCountByArea.get(area.areaId) ?? 0) >= area.headcount) break;
            if (used.has(person.id)) continue;
            used.add(person.id);
            assignToArea(person, area);
          }
        }
      } else {
        const areaCount = new Map<string, number>();
        for (const area of areas) {
          let picked = 0;
          const candidates = [...groupPeople].sort((a, b) => {
            const countA = areaCount.get(a.id) ?? 0;
            const countB = areaCount.get(b.id) ?? 0;
            if (countA !== countB) return countA - countB;
            const loadA = userSlotTotal.get(a.id) ?? 0;
            const loadB = userSlotTotal.get(b.id) ?? 0;
            if (loadA !== loadB) return loadA - loadB;
            return submittedAtMs(a) - submittedAtMs(b);
          });
          for (const person of candidates) {
            if (picked >= area.headcount) break;
            if ((areaCount.get(person.id) ?? 0) >= maxAreasPerPerson) continue;
            areaCount.set(person.id, (areaCount.get(person.id) ?? 0) + 1);
            assignToArea(person, area);
            picked += 1;
          }
        }
      }
    }

    // 缺口（按区域）
    for (const group of sortedGroups) {
      const areas = groups.get(group)!;
      const groupPeopleCount = groupPeopleCounts.get(group) ?? 0;
      for (const area of areas) {
        const filled = assignmentCountByArea.get(area.areaId) ?? 0;
        if (filled >= area.headcount) continue;
        const reasons: string[] = [];
        if (preferredPool.length + backupPool.length === 0) {
          reasons.push('该日期班次无任何用户选择首选或次选');
        } else if (slotPeople.length < slotDemand) {
          reasons.push(`该时段可安排人数不足（需 ${slotDemand} 人，仅 ${slotPeople.length} 人）`);
        }
        if (capped > 0) reasons.push(`有 ${capped} 人受工作量上限限制`);
        if (sameDayBlocked > 0) reasons.push(`有 ${sameDayBlocked} 人同日已被安排其他班次`);
        if (!input.allowSameDayMultiple) reasons.push('未开启“允许同日多班”，同日只能安排一个班次');
        if (coverage === 'shared' && maxAreasPerPerson < areas.length) {
          reasons.push(`同组兼顾上限为 ${maxAreasPerPerson} 个区域，剩余区域无法由同一人覆盖`);
        }
        if (groupPeopleCount <= 0) reasons.push('该区域组没有可用人员');
        if (unavailableReasons.length > 0) reasons.push(`另有 ${unavailableReasons.length} 人标记无法排班`);
        reasons.push('不强行安排“无法排班”用户');
        gaps.push({
          date: slot.date,
          shiftId: shift.id,
          shiftName: shift.name,
          areaId: area.areaId,
          areaName: area.areaName,
          required: area.headcount,
          filled,
          missing: Math.max(0, area.headcount - filled),
          reasons: [...new Set(reasons)],
        });
      }
    }
  }

  // 标记同一人同组多区域
  const perSlotCount = new Map<string, number>();
  for (const assignment of assignments) {
    const key = `${assignment.submissionId}|${assignment.date}|${assignment.shiftId}`;
    perSlotCount.set(key, (perSlotCount.get(key) ?? 0) + 1);
  }
  for (const assignment of assignments) {
    const key = `${assignment.submissionId}|${assignment.date}|${assignment.shiftId}`;
    assignment.multiArea = (perSlotCount.get(key) ?? 0) > 1;
  }

  const feasible = gaps.length === 0;
  const totalAssigned = assignments.length;
  const multiAreaPeople = new Set(
    assignments.filter((assignment) => assignment.multiArea).map((assignment) => `${assignment.submissionId}|${assignment.date}|${assignment.shiftId}`),
  ).size;
  const summary = feasible
    ? `全部满足：共 ${slots.length} 个时段、${totalRequired} 人次区域需求，安排 ${totalAssigned} 人次${
        multiAreaPeople > 0 ? `（其中 ${multiAreaPeople} 人次兼顾多个区域）` : ''
      }（种子 ${input.seed}）。`
    : `存在缺口：${gaps.length} 个区域需求未满足，共缺 ${gaps.reduce((sum, gap) => sum + gap.missing, 0)} 人次（种子 ${input.seed}）。`;

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
