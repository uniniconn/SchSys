import { prisma } from '@/lib/prisma';
import {
  fetchCalendarYearFromProviders,
  type CalendarEntry,
  type CalendarKind,
} from '@/lib/calendar-api';

/**
 * 日历服务：API 抓取 + 数据库缓存 + 自定义覆盖
 *
 * 优先级：自定义覆盖（CalendarOverride） > API/缓存（CalendarCache）。
 * 抓取失败时返回 stale 缓存；无缓存则返回 unavailable（调用方提示手动录入）。
 */

export const CALENDAR_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type MergedCalendarYear = {
  year: number;
  entries: CalendarEntry[];
  provider: string;
  fetchedAt: string;
  stale: boolean;
  unavailable: boolean;
  papers?: string[];
};

function isFresh(fetchedAt: Date): boolean {
  return Date.now() - fetchedAt.getTime() < CALENDAR_CACHE_TTL_MS;
}

function mergeOverrides(entries: CalendarEntry[], overrides: Array<{ date: string; kind: string; name: string | null }>): CalendarEntry[] {
  const map = new Map(entries.map((entry) => [entry.date, entry]));
  for (const override of overrides) {
    if (override.kind !== 'holiday' && override.kind !== 'workday') continue;
    map.set(override.date, { date: override.date, kind: override.kind as CalendarKind, name: override.name ?? undefined });
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** 读取一年日历（带缓存、多源回退、自定义覆盖） */
export async function getCalendarYear(
  year: number,
  options: { refresh?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<MergedCalendarYear> {
  const [cache, overrides] = await Promise.all([
    prisma.calendarCache.findUnique({ where: { year } }),
    prisma.calendarOverride.findMany({ where: { year }, orderBy: { date: 'asc' } }),
  ]);

  const canUseCache = cache && !options.refresh && isFresh(cache.fetchedAt);
  if (canUseCache && cache) {
    const entries = JSON.parse(cache.dataJson) as CalendarEntry[];
    return {
      year,
      entries: mergeOverrides(entries, overrides),
      provider: cache.provider,
      fetchedAt: cache.fetchedAt.toISOString(),
      stale: false,
      unavailable: false,
      papers: cache.papers ? (JSON.parse(cache.papers) as string[]) : undefined,
    };
  }

  try {
    const result = await fetchCalendarYearFromProviders(year, { fetchImpl: options.fetchImpl });
    await prisma.calendarCache.upsert({
      where: { year },
      create: {
        year,
        provider: result.provider,
        dataJson: JSON.stringify(result.entries),
        papers: result.papers ? JSON.stringify(result.papers) : null,
        fetchedAt: result.fetchedAt,
      },
      update: {
        provider: result.provider,
        dataJson: JSON.stringify(result.entries),
        papers: result.papers ? JSON.stringify(result.papers) : null,
        fetchedAt: result.fetchedAt,
      },
    });
    return {
      year,
      entries: mergeOverrides(result.entries, overrides),
      provider: result.provider,
      fetchedAt: result.fetchedAt.toISOString(),
      stale: false,
      unavailable: false,
      papers: result.papers,
    };
  } catch (error) {
    if (cache) {
      const entries = JSON.parse(cache.dataJson) as CalendarEntry[];
      return {
        year,
        entries: mergeOverrides(entries, overrides),
        provider: cache.provider,
        fetchedAt: cache.fetchedAt.toISOString(),
        stale: true,
        unavailable: false,
        papers: cache.papers ? (JSON.parse(cache.papers) as string[]) : undefined,
      };
    }
    return {
      year,
      entries: mergeOverrides([], overrides),
      provider: 'unavailable',
      fetchedAt: new Date().toISOString(),
      stale: false,
      unavailable: true,
    };
  }
}

export async function getCalendarYears(
  years: number[],
  options: { refresh?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<MergedCalendarYear[]> {
  const unique = [...new Set(years)].filter((year) => Number.isInteger(year) && year >= 1900 && year <= 2100).sort();
  const result: MergedCalendarYear[] = [];
  for (const year of unique) result.push(await getCalendarYear(year, options));
  return result;
}

/** 生成任务日历快照（写入 Task.calendarConfig），保证历史任务可复现 */
export async function buildCalendarSnapshot(
  years: number[],
  options: {
    refresh?: boolean;
    fetchImpl?: typeof fetch;
    weekend?: number[];
    manualEntries?: CalendarEntry[];
    useApi?: boolean;
  } = {},
): Promise<{ json: string; calendar: MergedCalendarYear[]; allEntries: CalendarEntry[] }> {
  let calendar: MergedCalendarYear[];
  if (options.useApi === false) {
    calendar = years.map((year) => ({
      year,
      entries: [],
      provider: 'manual',
      fetchedAt: new Date().toISOString(),
      stale: false,
      unavailable: false,
    }));
  } else {
    calendar = await getCalendarYears(years, options);
  }
  if (options.manualEntries && options.manualEntries.length > 0) {
    // 手动兜底：把传入条目合并进对应年份
    const manualByYear = new Map<number, CalendarEntry[]>();
    for (const entry of options.manualEntries) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date ?? '')) continue;
      if (entry.kind !== 'holiday' && entry.kind !== 'workday') continue;
      const year = Number(entry.date.slice(0, 4));
      if (!manualByYear.has(year)) manualByYear.set(year, []);
      manualByYear.get(year)!.push(entry);
    }
    calendar = calendar.map((item) => {
      const extra = manualByYear.get(item.year) ?? [];
      if (extra.length === 0) return item;
      const map = new Map(item.entries.map((entry) => [entry.date, entry]));
      for (const entry of extra) map.set(entry.date, entry);
      return { ...item, entries: [...map.values()].sort((a, b) => a.date.localeCompare(b.date)) };
    });
  }
  const snapshot = {
    weekend: options.weekend ?? [0, 6],
    generatedAt: new Date().toISOString(),
    years: calendar.map((item) => ({
      year: item.year,
      provider: item.provider,
      fetchedAt: item.fetchedAt,
      stale: item.stale,
      unavailable: item.unavailable,
      papers: item.papers,
      entries: item.entries,
    })),
  };
  const allEntries = calendar.flatMap((item) => item.entries);
  return { json: JSON.stringify(snapshot), calendar, allEntries };
}

/* ------------------------------- 自定义覆盖 ------------------------------- */

export async function listOverrides(year: number) {
  return prisma.calendarOverride.findMany({ where: { year }, orderBy: { date: 'asc' } });
}

export async function upsertOverride(input: {
  year: number;
  date: string;
  kind: CalendarKind;
  name?: string;
  note?: string;
}) {
  return prisma.calendarOverride.upsert({
    where: { year_date: { year: input.year, date: input.date } },
    create: {
      year: input.year,
      date: input.date,
      kind: input.kind,
      name: input.name?.slice(0, 50) ?? null,
      note: input.note?.slice(0, 200) ?? null,
    },
    update: {
      kind: input.kind,
      name: input.name?.slice(0, 50) ?? null,
      note: input.note?.slice(0, 200) ?? null,
    },
  });
}

export async function deleteOverride(year: number, date: string) {
  await prisma.calendarOverride.deleteMany({ where: { year, date } });
}

export async function clearOverrides(year: number) {
  const result = await prisma.calendarOverride.deleteMany({ where: { year } });
  return result.count;
}
