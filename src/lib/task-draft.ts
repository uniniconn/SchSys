import { diffDays, enumerateDates, isDateString, isTimeString } from './date-utils.ts';
import type { CalendarEntry } from './calendar-api.ts';
import { buildCalendarIndex, normalizeDateRule, shiftDates, type ShiftDateRule } from './schedule-rules.ts';

/** 创建任务时的“草稿”结构：客户端与服务端共用，提交时整体以 JSON 传递 */
export type DraftArea = {
  name: string;
  groupName: string;
  defaultHeadcount: number;
};

export type DraftShift = {
  name: string;
  startTime: string;
  endTime: string;
  dateRule: ShiftDateRule;
  areas: DraftArea[];
};

export type DraftOverride = {
  date: string;
  shiftIndex: number;
  areaIndex: number;
  headcount: number;
};

export type TaskDraft = {
  name: string;
  description: string;
  dateStart: string;
  dateEnd: string;
  fillDeadline: string;
  fillPassword: string;
  templateKey?: string;
  allowSameDayMultiple: boolean;
  areaCoverage: 'shared' | 'exclusive';
  maxAreasPerPerson: number;
  lessDefaultMax?: number | null;
  weekend: number[];
  shifts: DraftShift[];
  overrides: DraftOverride[];
  calendar?: {
    useApi: boolean;
    manualEntries?: CalendarEntry[];
  };
};

export type RequirementRow = {
  date: string;
  shiftIndex: number;
  areaIndex: number;
  headcount: number;
};

export type DraftSummary = {
  dates: number;
  shifts: number;
  areas: number;
  totalRequired: number;
  cells: number;
};

export const MAX_DRAFT_DAYS = 200;
export const MAX_DRAFT_SHIFTS = 20;
export const MAX_DRAFT_AREAS = 10;
export const MAX_DRAFT_OVERRIDES = 5000;

export type DateRulePresetKey = 'workday' | 'evening' | 'everyday' | 'weekend';

export type TemplateKey = 'evening' | 'day' | 'weekend' | 'blank';

export const TEMPLATES: Array<{
  key: TemplateKey;
  title: string;
  description: string;
  build: () => Pick<TaskDraft, 'shifts' | 'areaCoverage' | 'maxAreasPerPerson' | 'allowSameDayMultiple'>;
}> = [
  {
    key: 'evening',
    title: '晚自习（多区域）',
    description: '1 个晚自习时段，A/B/C 三个区域各 1 人；按“次日是工作日”自动保留周日晚与节前晚',
    build: () => ({
      areaCoverage: 'shared',
      maxAreasPerPerson: 2,
      allowSameDayMultiple: false,
      shifts: [
        {
          name: '晚自习',
          startTime: '18:30',
          endTime: '21:30',
          dateRule: normalizeDateRule({
            weekdays: [0, 1, 2, 3, 4],
            eveOfWorkday: true,
            excludeHolidays: true,
            includeDates: [],
            excludeDates: [],
          }),
          areas: [
            { name: 'A 区', groupName: '教学楼 A', defaultHeadcount: 1 },
            { name: 'B 区', groupName: '教学楼 A', defaultHeadcount: 1 },
            { name: 'C 区', groupName: '教学楼 B', defaultHeadcount: 1 },
          ],
        },
      ],
    }),
  },
  {
    key: 'day',
    title: '白班值班',
    description: '工作日白天 1 个班次、1 个区域、1 人',
    build: () => ({
      areaCoverage: 'exclusive',
      maxAreasPerPerson: 1,
      allowSameDayMultiple: false,
      shifts: [
        {
          name: '白班',
          startTime: '08:00',
          endTime: '17:00',
          dateRule: normalizeDateRule({ weekdays: [1, 2, 3, 4, 5], eveOfWorkday: false, excludeHolidays: true }),
          areas: [{ name: '默认区域', groupName: '默认组', defaultHeadcount: 1 }],
        },
      ],
    }),
  },
  {
    key: 'weekend',
    title: '周末值班',
    description: '仅周六、周日，1 个班次、1 个区域',
    build: () => ({
      areaCoverage: 'exclusive',
      maxAreasPerPerson: 1,
      allowSameDayMultiple: false,
      shifts: [
        {
          name: '周末班',
          startTime: '09:00',
          endTime: '17:00',
          dateRule: normalizeDateRule({ weekdays: [0, 6], eveOfWorkday: false, excludeHolidays: false }),
          areas: [{ name: '默认区域', groupName: '默认组', defaultHeadcount: 1 }],
        },
      ],
    }),
  },
  {
    key: 'blank',
    title: '空白任务',
    description: '1 个班次、1 个区域，从零开始配置',
    build: () => ({
      areaCoverage: 'exclusive',
      maxAreasPerPerson: 1,
      allowSameDayMultiple: false,
      shifts: [
        {
          name: '班次 1',
          startTime: '08:00',
          endTime: '16:00',
          dateRule: normalizeDateRule({ weekdays: [1, 2, 3, 4, 5], eveOfWorkday: false, excludeHolidays: true }),
          areas: [{ name: '默认区域', groupName: '默认组', defaultHeadcount: 1 }],
        },
      ],
    }),
  },
];

export function createDraftFromTemplate(templateKey: TemplateKey = 'evening'): TaskDraft {
  const template = TEMPLATES.find((item) => item.key === templateKey) ?? TEMPLATES[0];
  const built = template.build();
  return {
    name: '',
    description: '',
    dateStart: '',
    dateEnd: '',
    fillDeadline: '',
    fillPassword: '',
    templateKey: template.key,
    allowSameDayMultiple: built.allowSameDayMultiple,
    areaCoverage: built.areaCoverage,
    maxAreasPerPerson: built.maxAreasPerPerson,
    lessDefaultMax: null,
    weekend: [0, 6],
    shifts: built.shifts,
    overrides: [],
    calendar: { useApi: true },
  };
}

/** 把任意输入规整为 TaskDraft，并返回所有校验错误（供向导逐项定位） */
export function normalizeDraft(input: unknown): { draft: TaskDraft; errors: string[] } {
  const errors: string[] = [];
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const base = createDraftFromTemplate('blank');

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  const dateStart = typeof raw.dateStart === 'string' ? raw.dateStart.trim() : '';
  const dateEnd = typeof raw.dateEnd === 'string' ? raw.dateEnd.trim() : '';
  const fillDeadline = typeof raw.fillDeadline === 'string' ? raw.fillDeadline.trim() : '';
  const fillPassword = typeof raw.fillPassword === 'string' ? raw.fillPassword.trim() : '';

  if (!name) errors.push('请填写任务名称');
  if (name.length > 100) errors.push('任务名称不能超过 100 个字符');
  if (!isDateString(dateStart) || !isDateString(dateEnd)) {
    errors.push('请选择有效的任务日期范围');
  } else {
    if (dateStart > dateEnd) errors.push('开始日期不能晚于结束日期');
    if (diffDays(dateStart, dateEnd) > MAX_DRAFT_DAYS - 1) errors.push(`日期范围不能超过 ${MAX_DRAFT_DAYS} 天`);
  }
  if (fillPassword && fillPassword.length < 4) errors.push('填写密码至少 4 位');

  let fillDeadlineIso = '';
  if (fillDeadline) {
    const parsed = new Date(fillDeadline);
    if (Number.isNaN(parsed.getTime())) errors.push('填写截止时间格式不正确');
    else fillDeadlineIso = fillDeadline;
  }

  const areaCoverage = raw.areaCoverage === 'exclusive' ? 'exclusive' : 'shared';
  const maxAreasRaw = Number(raw.maxAreasPerPerson);
  const maxAreasPerPerson = Number.isFinite(maxAreasRaw) ? Math.min(10, Math.max(1, Math.floor(maxAreasRaw))) : 2;
  const lessDefaultMaxRaw = raw.lessDefaultMax;
  const lessDefaultMax =
    lessDefaultMaxRaw === null || lessDefaultMaxRaw === undefined || lessDefaultMaxRaw === ''
      ? null
      : Math.max(0, Math.min(365, Math.floor(Number(lessDefaultMaxRaw))));

  const weekendRaw = Array.isArray(raw.weekend) ? raw.weekend : base.weekend;
  const weekend = [...new Set(weekendRaw.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];
  if (weekend.length === 0) weekend.push(0, 6);

  const rawShifts = Array.isArray(raw.shifts) ? raw.shifts : [];
  if (rawShifts.length === 0) errors.push('请至少添加一个班次');
  if (rawShifts.length > MAX_DRAFT_SHIFTS) errors.push(`班次数量不能超过 ${MAX_DRAFT_SHIFTS} 个`);

  const shiftNames = new Set<string>();
  const shifts: DraftShift[] = rawShifts.slice(0, MAX_DRAFT_SHIFTS).map((item, index) => {
    const record = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const shiftName = typeof record.name === 'string' ? record.name.trim() : '';
    const startTime = typeof record.startTime === 'string' ? record.startTime.trim() : '';
    const endTime = typeof record.endTime === 'string' ? record.endTime.trim() : '';
    if (!shiftName) errors.push(`第 ${index + 1} 个班次缺少名称`);
    if (shiftName.length > 30) errors.push(`第 ${index + 1} 个班次名称过长`);
    if (shiftName && shiftNames.has(shiftName)) errors.push(`班次名称重复：${shiftName}`);
    shiftNames.add(shiftName);
    if (!isTimeString(startTime) || !isTimeString(endTime)) errors.push(`班次「${shiftName || index + 1}」时间格式应为 HH:mm`);

    const rawAreas = Array.isArray(record.areas) ? record.areas : [];
    if (rawAreas.length === 0) errors.push(`班次「${shiftName || index + 1}」至少需要一个区域`);
    if (rawAreas.length > MAX_DRAFT_AREAS) errors.push(`每个班次最多 ${MAX_DRAFT_AREAS} 个区域`);

    const areaNames = new Set<string>();
    const areas: DraftArea[] = rawAreas.slice(0, MAX_DRAFT_AREAS).map((areaItem, areaIndex) => {
      const area = (areaItem && typeof areaItem === 'object' ? areaItem : {}) as Record<string, unknown>;
      const areaName = typeof area.name === 'string' ? area.name.trim() : '';
      const groupName = typeof area.groupName === 'string' && area.groupName.trim() ? area.groupName.trim() : '默认组';
      const headcountRaw = Number(area.defaultHeadcount);
      const defaultHeadcount = Number.isFinite(headcountRaw) ? Math.max(0, Math.min(500, Math.floor(headcountRaw))) : 1;
      if (!areaName) errors.push(`班次「${shiftName || index + 1}」第 ${areaIndex + 1} 个区域缺少名称`);
      if (areaName && areaNames.has(areaName)) errors.push(`班次「${shiftName || index + 1}」区域名称重复：${areaName}`);
      areaNames.add(areaName);
      if (groupName.length > 30) errors.push(`区域组名称过长：${groupName}`);
      return { name: areaName, groupName, defaultHeadcount };
    });

    return {
      name: shiftName,
      startTime,
      endTime,
      dateRule: normalizeDateRule(record.dateRule as Partial<ShiftDateRule> | undefined),
      areas,
    };
  });

  const rawOverrides = Array.isArray(raw.overrides) ? raw.overrides : [];
  if (rawOverrides.length > MAX_DRAFT_OVERRIDES) errors.push(`按天调整的单元格过多（上限 ${MAX_DRAFT_OVERRIDES}）`);
  const overrides: DraftOverride[] = [];
  for (const item of rawOverrides.slice(0, MAX_DRAFT_OVERRIDES)) {
    const record = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const date = typeof record.date === 'string' ? record.date : '';
    const shiftIndex = Number(record.shiftIndex);
    const areaIndex = Number(record.areaIndex);
    const headcountRaw = Number(record.headcount);
    if (!isDateString(date)) continue;
    if (!Number.isInteger(shiftIndex) || shiftIndex < 0 || shiftIndex >= shifts.length) continue;
    if (!Number.isInteger(areaIndex) || areaIndex < 0 || areaIndex >= shifts[shiftIndex].areas.length) continue;
    if (!Number.isFinite(headcountRaw)) continue;
    overrides.push({
      date,
      shiftIndex,
      areaIndex,
      headcount: Math.max(0, Math.min(500, Math.floor(headcountRaw))),
    });
  }

  const draft: TaskDraft = {
    name,
    description: description.slice(0, 500),
    dateStart,
    dateEnd,
    fillDeadline: fillDeadlineIso,
    fillPassword,
    templateKey: typeof raw.templateKey === 'string' ? raw.templateKey : undefined,
    allowSameDayMultiple: Boolean(raw.allowSameDayMultiple),
    areaCoverage,
    maxAreasPerPerson,
    lessDefaultMax,
    weekend,
    shifts,
    overrides,
    calendar: {
      useApi: !(raw.calendar && typeof raw.calendar === 'object' && (raw.calendar as { useApi?: unknown }).useApi === false),
      manualEntries: Array.isArray((raw.calendar as { manualEntries?: unknown } | undefined)?.manualEntries)
        ? ((raw.calendar as { manualEntries: CalendarEntry[] }).manualEntries ?? []).slice(0, 800)
        : undefined,
    },
  };

  return { draft, errors };
}

export function generateRequirements(
  draft: TaskDraft,
  calendarEntries: CalendarEntry[],
): { rows: RequirementRow[]; dates: string[]; warnings: string[]; summary: DraftSummary } {
  const warnings: string[] = [];
  if (!isDateString(draft.dateStart) || !isDateString(draft.dateEnd)) {
    return { rows: [], dates: [], warnings: ['日期范围无效'], summary: { dates: 0, shifts: draft.shifts.length, areas: 0, totalRequired: 0, cells: 0 } };
  }
  const index = buildCalendarIndex(calendarEntries, draft.weekend);
  const overrideMap = new Map<string, number>();
  for (const override of draft.overrides) {
    overrideMap.set(`${override.date}|${override.shiftIndex}|${override.areaIndex}`, override.headcount);
  }

  const allDates = new Set<string>();
  const rows: RequirementRow[] = [];

  draft.shifts.forEach((shift, shiftIndex) => {
    const dates = shiftDates(draft.dateStart, draft.dateEnd, shift.dateRule, index, MAX_DRAFT_DAYS);
    if (dates.length === 0) warnings.push(`班次「${shift.name}」在所选日期范围内没有符合规则的日期`);
    for (const date of dates) {
      allDates.add(date);
      shift.areas.forEach((area, areaIndex) => {
        const override = overrideMap.get(`${date}|${shiftIndex}|${areaIndex}`);
        const headcount = override !== undefined ? override : area.defaultHeadcount;
        if (headcount <= 0) return;
        rows.push({ date, shiftIndex, areaIndex, headcount });
      });
    }
  });

  const dates = [...allDates].sort();
  const areaCount = draft.shifts.reduce((sum, shift) => sum + shift.areas.length, 0);
  const totalRequired = rows.reduce((sum, row) => sum + row.headcount, 0);
  const summary: DraftSummary = {
    dates: dates.length,
    shifts: draft.shifts.length,
    areas: areaCount,
    totalRequired,
    cells: rows.length,
  };
  if (rows.length === 0) warnings.push('生成结果为空：请检查日期规则与区域人数');
  return { rows, dates, warnings, summary };
}

/** 每个班次生成后的日期数量（用于向导预览） */
export function draftShiftDateCounts(draft: TaskDraft, calendarEntries: CalendarEntry[]): number[] {
  if (!isDateString(draft.dateStart) || !isDateString(draft.dateEnd)) return draft.shifts.map(() => 0);
  const index = buildCalendarIndex(calendarEntries, draft.weekend);
  return draft.shifts.map((shift) => shiftDates(draft.dateStart, draft.dateEnd, shift.dateRule, index, MAX_DRAFT_DAYS).length);
}

export function enumerateDraftDates(draft: TaskDraft, calendarEntries: CalendarEntry[]): string[] {
  if (!isDateString(draft.dateStart) || !isDateString(draft.dateEnd)) return [];
  if (draft.shifts.length === 0) return enumerateDates(draft.dateStart, draft.dateEnd, MAX_DRAFT_DAYS);
  const index = buildCalendarIndex(calendarEntries, draft.weekend);
  const set = new Set<string>();
  for (const shift of draft.shifts) {
    for (const date of shiftDates(draft.dateStart, draft.dateEnd, shift.dateRule, index, MAX_DRAFT_DAYS)) set.add(date);
  }
  return [...set].sort();
}
