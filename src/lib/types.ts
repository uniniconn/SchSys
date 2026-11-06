/** 全局共享类型 */

export type Choice = 'preferred' | 'backup' | 'unavailable';

export const CHOICE_LABEL: Record<Choice, string> = {
  preferred: '首选班次',
  backup: '次选班次',
  unavailable: '无法排班',
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  confirmed: '已截止确认',
  matched: '已匹配',
};

export type ShiftInput = {
  name: string;
  startTime: string;
  endTime: string;
  defaultHeadcount: number;
  sortOrder?: number;
};

export type ScheduleGap = {
  date: string;
  shiftId: string;
  shiftName: string;
  areaId?: string;
  areaName?: string;
  required: number;
  filled: number;
  missing: number;
  reasons: string[];
};

export type MatchResult = {
  feasible: boolean;
  seed: number;
  batchId: string;
  assignments: Array<{
    date: string;
    shiftId: string;
    shiftName: string;
    areaId: string;
    areaName: string;
    submissionId: string;
    name: string;
    source: 'preferred' | 'backup';
    historyCount: number;
    multiArea: boolean;
  }>;
  gaps: ScheduleGap[];
  totalRequired: number;
  totalAssigned: number;
  summary: string;
};

/** 结果页展示用的行：某天某班次 + 安排人员 */
export type CalendarCell = {
  date: string;
  shiftId: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  headcount: number;
  people: string[];
  missing: number;
};
