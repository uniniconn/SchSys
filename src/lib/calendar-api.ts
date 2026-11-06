/**
 * 日历公共 API 接入（无第三方依赖，纯 fetch，可注入实现便于测试）
 *
 * 数据源（均无需 Key）：
 *  1. holiday-cn（GitHub，依据国务院公告整理，带官方来源链接）
 *  2. timor.tech（国内可直连）
 *  3. jiejiariapi（国内可直连）
 *
 * 统一输出：{ date: 'yyyy-MM-dd', kind: 'holiday' | 'workday', name?: string }
 *   kind=holiday → 放假日（不上班）
 *   kind=workday → 调休补班日（要上班）
 */

export type CalendarKind = 'holiday' | 'workday';

export type CalendarEntry = {
  date: string;
  kind: CalendarKind;
  name?: string;
};

export type ProviderFetchResult = {
  provider: string;
  entries: CalendarEntry[];
  papers?: string[];
};

export type CalendarProvider = {
  id: string;
  label: string;
  url: (year: number) => string;
  normalize: (payload: unknown, year: number) => { entries: CalendarEntry[]; papers?: string[] };
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ENTRIES_PER_YEAR = 400;

export function isValidCalendarDate(value: unknown, year?: number): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  if (year !== undefined && !value.startsWith(`${year}-`)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function normalizeEntries(
  raw: Array<{ date: string; kind: CalendarKind; name?: string }>,
  year: number,
): CalendarEntry[] {
  const byDate = new Map<string, CalendarEntry>();
  for (const item of raw) {
    if (!isValidCalendarDate(item.date, year)) continue;
    if (item.kind !== 'holiday' && item.kind !== 'workday') continue;
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 50) : undefined;
    // 同一天冲突时保留先出现的一条（提供方内部应已一致）
    if (!byDate.has(item.date)) byDate.set(item.date, { date: item.date, kind: item.kind, name });
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, MAX_ENTRIES_PER_YEAR);
}

/** holiday-cn: { year, days: [{ name, date, isOffDay }] } */
export function normalizeHolidayCn(payload: unknown, year: number): { entries: CalendarEntry[]; papers?: string[] } {
  if (!payload || typeof payload !== 'object') return { entries: [] };
  const record = payload as { year?: unknown; days?: unknown; papers?: unknown };
  if (record.year !== undefined && Number(record.year) !== year) return { entries: [] };
  if (!Array.isArray(record.days)) return { entries: [] };
  const raw = record.days
    .filter((item): item is { date: unknown; isOffDay: unknown; name?: unknown } => Boolean(item && typeof item === 'object'))
    .filter((item) => item.isOffDay === true || item.isOffDay === false)
    .map((item) => ({
      date: String(item.date ?? ''),
      kind: (item.isOffDay === true ? 'holiday' : 'workday') as CalendarKind,
      name: typeof item.name === 'string' ? item.name : undefined,
    }));
  const papers = Array.isArray(record.papers)
    ? record.papers.filter((item): item is string => typeof item === 'string').slice(0, 5)
    : undefined;
  return { entries: normalizeEntries(raw, year), papers };
}

/** timor.tech: { code: 0, holiday: { "MM-DD": { holiday: boolean, date, name } } } */
export function normalizeTimor(payload: unknown, year: number): { entries: CalendarEntry[] } {
  if (!payload || typeof payload !== 'object') return { entries: [] };
  const record = payload as { code?: unknown; holiday?: unknown };
  if (record.code !== undefined && Number(record.code) !== 0) return { entries: [] };
  if (!record.holiday || typeof record.holiday !== 'object') return { entries: [] };
  const raw = Object.values(record.holiday as Record<string, unknown>)
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      date: String(item.date ?? ''),
      kind: (item.holiday === true ? 'holiday' : 'workday') as CalendarKind,
      name: typeof item.name === 'string' ? item.name : undefined,
    }));
  return { entries: normalizeEntries(raw, year) };
}

/** jiejiariapi: { "yyyy-MM-dd": { date, name, isOffDay } } */
export function normalizeJiejiari(payload: unknown, year: number): { entries: CalendarEntry[] } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { entries: [] };
  const raw = Object.values(payload as Record<string, unknown>)
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      date: String(item.date ?? ''),
      kind: (item.isOffDay === true ? 'holiday' : 'workday') as CalendarKind,
      name: typeof item.name === 'string' ? item.name : undefined,
    }));
  return { entries: normalizeEntries(raw, year) };
}

export const CALENDAR_PROVIDERS: CalendarProvider[] = [
  {
    id: 'holiday-cn',
    label: 'holiday-cn（国务院公告整理）',
    url: (year) => `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`,
    normalize: normalizeHolidayCn,
  },
  {
    id: 'timor.tech',
    label: 'timor.tech 节假日接口',
    url: (year) => `https://timor.tech/api/holiday/year/${year}`,
    normalize: normalizeTimor,
  },
  {
    id: 'jiejiariapi',
    label: 'jiejiariapi 节假日接口',
    url: (year) => `https://api.jiejiariapi.com/v1/holidays/${year}`,
    normalize: normalizeJiejiari,
  },
];

export type FetchOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  providers?: CalendarProvider[];
  userAgent?: string;
};

/**
 * 按提供方顺序抓取某一年数据；任一成功即返回。
 * 全部失败时抛出最后一个错误（调用方决定是否用缓存兜底）。
 */
export async function fetchCalendarYearFromProviders(
  year: number,
  options: FetchOptions = {},
): Promise<ProviderFetchResult & { fetchedAt: Date }> {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) throw new Error('年份无效');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? Number(process.env.CALENDAR_HTTP_TIMEOUT_MS ?? 5000);
  const providers = options.providers ?? CALENDAR_PROVIDERS;
  const errors: string[] = [];

  for (const provider of providers) {
    const url = provider.url(year);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          headers: { 'user-agent': options.userAgent ?? 'scheduling-system/1.3', accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as unknown;
        const normalized = provider.normalize(payload, year);
        if (normalized.entries.length === 0) throw new Error('返回数据为空');
        return { provider: provider.id, entries: normalized.entries, papers: normalized.papers, fetchedAt: new Date() };
      } catch (error) {
        errors.push(`${provider.id}: ${(error as Error).message}`);
      }
    }
  }
  throw new Error(`日历接口全部失败：${errors.slice(-3).join('；')}`);
}
