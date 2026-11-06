import { addDays, enumerateDates, isDateString, isTimeString } from './date-utils.ts';
import type { CalendarEntry } from './calendar-api.ts';

/** 日历索引：把条目转成集合，便于纯函数判定的可测试性 */
export type CalendarIndex = {
  holidays: Set<string>;
  workdays: Set<string>;
  weekend: number[];
};

export type ShiftDateRule = {
  /** 适用的星期（0=周日 … 6=周六）；eveOfWorkday 为 true 时该字段忽略 */
  weekdays: number[];
  /** 晚自习规则：只要“次日是工作日”，当天晚上就排（含周日、节假日最后一天） */
  eveOfWorkday: boolean;
  /** 是否把节假日排除（false 表示节假日也照常排） */
  excludeHolidays: boolean;
  /** 强制纳入的日期 */
  includeDates: string[];
  /** 强制排除的日期 */
  excludeDates: string[];
};

export const DEFAULT_WEEKEND = [0, 6];

export function buildCalendarIndex(entries: CalendarEntry[], weekend: number[] = DEFAULT_WEEKEND): CalendarIndex {
  const holidays = new Set<string>();
  const workdays = new Set<string>();
  for (const entry of entries) {
    if (!isDateString(entry.date)) continue;
    if (entry.kind === 'holiday') holidays.add(entry.date);
    else if (entry.kind === 'workday') workdays.add(entry.date);
  }
  const normalizedWeekend = [...new Set(weekend.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];
  return { holidays, workdays, weekend: normalizedWeekend.length > 0 ? normalizedWeekend : DEFAULT_WEEKEND };
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** 真实工作日：调休补班日，或（非周末且非节假日） */
export function isWorkday(date: string, index: CalendarIndex): boolean {
  if (index.workdays.has(date)) return true;
  if (index.weekend.includes(weekdayOf(date))) return false;
  return !index.holidays.has(date);
}

/** 按班次规则判断某天是否排该班次 */
export function shiftIncludesDate(date: string, rule: ShiftDateRule, index: CalendarIndex): boolean {
  if (rule.excludeDates.includes(date)) return false;
  if (rule.includeDates.includes(date)) return true;
  if (rule.eveOfWorkday) {
    return isWorkday(addDays(date, 1), index);
  }
  if (index.workdays.has(date)) return true;
  if (!rule.excludeHolidays && index.holidays.has(date)) return true;
  if (index.holidays.has(date)) return false;
  if (index.weekend.includes(weekdayOf(date))) return false;
  return rule.weekdays.includes(weekdayOf(date));
}

export function shiftDates(
  dateStart: string,
  dateEnd: string,
  rule: ShiftDateRule,
  index: CalendarIndex,
  maxDays = 200,
): string[] {
  return enumerateDates(dateStart, dateEnd, maxDays).filter((date) => shiftIncludesDate(date, rule, index));
}

export type DateRulePresetKey = 'workday' | 'evening' | 'everyday' | 'weekend';

export const DATE_RULE_PRESETS: Record<
  DateRulePresetKey,
  { label: string; description: string; rule: ShiftDateRule }
> = {
  workday: {
    label: '仅工作日',
    description: '周一到周五，自动剔除节假日；调休补班日照常',
    rule: { weekdays: [1, 2, 3, 4, 5], eveOfWorkday: false, excludeHolidays: true, includeDates: [], excludeDates: [] },
  },
  evening: {
    label: '晚自习（次日工作日）',
    description: '只要第二天是工作日，当天晚上就排——周日晚上、节假日最后一天晚上都会保留',
    rule: { weekdays: [0, 1, 2, 3, 4], eveOfWorkday: true, excludeHolidays: true, includeDates: [], excludeDates: [] },
  },
  everyday: {
    label: '每天',
    description: '日期范围内每天都排，不区分周末与节假日',
    rule: { weekdays: [0, 1, 2, 3, 4, 5, 6], eveOfWorkday: false, excludeHolidays: false, includeDates: [], excludeDates: [] },
  },
  weekend: {
    label: '仅周末',
    description: '周六、周日；节假日仍照常',
    rule: { weekdays: [0, 6], eveOfWorkday: false, excludeHolidays: false, includeDates: [], excludeDates: [] },
  },
};

export function normalizeDateRule(input: Partial<ShiftDateRule> | null | undefined): ShiftDateRule {
  const base: ShiftDateRule = {
    weekdays: [1, 2, 3, 4, 5],
    eveOfWorkday: false,
    excludeHolidays: true,
    includeDates: [],
    excludeDates: [],
  };
  if (!input) return base;
  const weekdays = Array.isArray(input.weekdays)
    ? [...new Set(input.weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
    : base.weekdays;
  const includeDates = Array.isArray(input.includeDates) ? input.includeDates.filter(isDateString).slice(0, 200) : [];
  const excludeDates = Array.isArray(input.excludeDates) ? input.excludeDates.filter(isDateString).slice(0, 200) : [];
  return {
    weekdays: weekdays.length > 0 ? weekdays : base.weekdays,
    eveOfWorkday: Boolean(input.eveOfWorkday),
    excludeHolidays: input.excludeHolidays !== false,
    includeDates,
    excludeDates,
  };
}

export function serializeDateRule(rule: ShiftDateRule): string {
  return JSON.stringify(normalizeDateRule(rule));
}

export function parseDateRule(json: string | null | undefined): ShiftDateRule {
  if (!json) return normalizeDateRule(null);
  try {
    return normalizeDateRule(JSON.parse(json) as Partial<ShiftDateRule>);
  } catch {
    return normalizeDateRule(null);
  }
}

export function validateTimeRange(startTime: string, endTime: string): string | null {
  if (!isTimeString(startTime) || !isTimeString(endTime)) return '时间格式应为 HH:mm';
  if (startTime === endTime) return '开始时间与结束时间不能相同';
  return null;
}
