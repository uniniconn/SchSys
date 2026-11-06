import { requireAdminApi } from '@/lib/auth';
import { fail, json } from '@/lib/http';
import { getCalendarYear, listOverrides } from '@/lib/calendar-service';
import { isDateString } from '@/lib/date-utils';
import { clientIp, rateLimit } from '@/lib/rate-limit';

/** 读取某年日历（合并自定义覆盖）；?refresh=1 强制重新抓取 */
export async function GET(request: Request) {
  const session = await requireAdminApi();
  if (!session) return fail('未登录或会话已过期', 401);

  const params = new URL(request.url).searchParams;
  const yearsParam = (params.get('years') ?? params.get('year') ?? '').trim();
  const years = yearsParam
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((year) => Number.isInteger(year) && year >= 1900 && year <= 2100);
  if (years.length === 0) return fail('请提供年份，例如 ?year=2026');

  const refresh = params.get('refresh') === '1';
  const results = [];
  for (const year of [...new Set(years)].slice(0, 5)) {
    const calendar = await getCalendarYear(year, { refresh });
    results.push({
      ...calendar,
      overrides: (await listOverrides(year)).map((item) => ({
        date: item.date,
        kind: item.kind,
        name: item.name,
        note: item.note,
      })),
    });
  }

  return json({ ok: true, years: results });
}

/** 新增/更新自定义日历条目 */
export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return fail('未登录或会话已过期', 401);
  const limit = rateLimit(`calendar:write:${clientIp(request.headers)}`, 20, 60);
  if (!limit.allowed) return fail('操作过于频繁，请稍后再试', 429);

  let body: { year?: number; date?: string; kind?: string; name?: string; note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail('请求格式错误');
  }

  const date = (body.date ?? '').trim();
  if (!isDateString(date)) return fail('日期格式应为 yyyy-MM-dd');
  const year = Number(date.slice(0, 4));
  const kind = body.kind === 'workday' ? 'workday' : 'holiday';
  const { upsertOverride } = await import('@/lib/calendar-service');
  await upsertOverride({ year, date, kind, name: body.name, note: body.note });
  const { writeAuditLog } = await import('@/lib/session');
  await writeAuditLog({
    adminId: session.adminId,
    action: 'calendar.override.upsert',
    detail: `自定义日历：${date} → ${kind === 'holiday' ? '放假' : '补班'}${body.name ? `（${body.name}）` : ''}`,
  });

  return json({ ok: true, year });
}

/** 删除自定义日历条目 */
export async function DELETE(request: Request) {
  const session = await requireAdminApi();
  if (!session) return fail('未登录或会话已过期', 401);
  const limit = rateLimit(`calendar:write:${clientIp(request.headers)}`, 20, 60);
  if (!limit.allowed) return fail('操作过于频繁，请稍后再试', 429);

  const params = new URL(request.url).searchParams;
  const date = (params.get('date') ?? '').trim();
  if (!isDateString(date)) return fail('日期格式应为 yyyy-MM-dd');
  const year = Number(date.slice(0, 4));

  const { deleteOverride } = await import('@/lib/calendar-service');
  await deleteOverride(year, date);
  const { writeAuditLog } = await import('@/lib/session');
  await writeAuditLog({ adminId: session.adminId, action: 'calendar.override.delete', detail: `删除自定义日历：${date}` });

  return json({ ok: true });
}
