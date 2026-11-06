import { requireAdminApi } from '@/lib/auth';
import { fail, json } from '@/lib/http';
import { listCandidates } from '@/lib/manual-adjust';

/**
 * 手动调整时的候选人列表：返回所有填写人对指定「日期 + 班次」的意愿与当前排班情况，
 * 供管理员在结果页挑选人员。
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAdminApi();
  if (!session) return fail('未登录或会话已过期', 401);

  const { id } = await context.params;
  const params = new URL(request.url).searchParams;
  const result = await listCandidates({
    taskId: id,
    date: (params.get('date') ?? '').trim(),
    shiftId: (params.get('shiftId') ?? '').trim(),
    areaId: (params.get('areaId') ?? '').trim(),
  });

  if ('error' in result) return fail(result.error, result.status);
  return json({ ok: true, ...result });
}
