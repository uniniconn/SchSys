/** 日期与时间工具：全部以 yyyy-MM-dd / HH:mm 字符串在数据库与前端之间传递，避免时区漂移。 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDateString(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(toUtcDate(value).getTime());
}

export function isTimeString(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value);
}

/** 把 yyyy-MM-dd 解析成 UTC 零点，用于纯日期加减 */
export function toUtcDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

export function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(dateStr: string, days: number): string {
  const date = toUtcDate(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

/** 枚举 [start, end] 闭区间内的所有日期 */
export function enumerateDates(start: string, end: string, maxDays = 400): string[] {
  if (!isDateString(start) || !isDateString(end)) return [];
  const out: string[] = [];
  let cursor = start;
  let guard = 0;
  while (cursor <= end && guard < maxDays) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return out;
}

export function diffDays(start: string, end: string): number {
  return Math.round((toUtcDate(end).getTime() - toUtcDate(start).getTime()) / 86400000);
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayLabel(dateStr: string): string {
  if (!isDateString(dateStr)) return '';
  return WEEKDAYS[toUtcDate(dateStr).getUTCDay()] ?? '';
}

/** 2025-03-04 -> 3月4日（周二） */
export function friendlyDate(dateStr: string): string {
  if (!isDateString(dateStr)) return dateStr;
  const date = toUtcDate(dateStr);
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日（${weekdayLabel(dateStr)}）`;
}

export function timeToMinutes(time: string): number {
  if (!isTimeString(time)) return 0;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** 班次时间是否重叠（跨零点按到 24:00 处理；start >= end 视为跨夜，重叠判定为真） */
export function shiftsOverlap(a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }): boolean {
  const aStart = timeToMinutes(a.startTime);
  const aEnd = timeToMinutes(a.endTime);
  const bStart = timeToMinutes(b.startTime);
  const bEnd = timeToMinutes(b.endTime);
  // 跨夜班次保守认为与任何班次都可能重叠
  if (aEnd <= aStart || bEnd <= bStart) return true;
  return aStart < bEnd && bStart < aEnd;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '-';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function isPast(value: Date | string | null | undefined): boolean {
  if (!value) return false;
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.getTime() < Date.now();
}
