import { requireAdminApi } from '@/lib/auth';
import { fail, json } from '@/lib/http';
import { addManualAssignment, removeAssignment } from '@/lib/manual-adjust';

/**
 * 排班结果的手动调整 API（与后台「手动调整」面板共用同一套核心逻辑）：
 *
 *   POST   /api/admin/tasks/{id}/assignments
 *          body: { date: "2026-06-01", shiftId: "...", submissionId: "...", note?: "临时调整" }
 *          → 添加一条手动排班（不允许安排标记“无法排班”的人员）
 *
 *   DELETE /api/admin/tasks/{id}/assignments?assignmentId=...
 *          → 移除一条排班记录
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAdminApi();
  if (!session) return fail('未登录或会话已过期', 401);

  const { id } = await context.params;
  let body: { date?: string; shiftId?: string; submissionId?: string; note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail('请求格式错误');
  }

  const result = await addManualAssignment({
    taskId: id,
    date: (body.date ?? '').trim(),
    shiftId: (body.shiftId ?? '').trim(),
    submissionId: (body.submissionId ?? '').trim(),
    note: body.note ?? '',
    adminId: session.adminId,
  });

  if (result.error) return fail(result.error, result.status ?? 400);
  return json({ ok: true, message: result.ok, warning: result.warning, assignmentId: result.assignmentId });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAdminApi();
  if (!session) return fail('未登录或会话已过期', 401);

  const { id } = await context.params;
  const assignmentId = (new URL(request.url).searchParams.get('assignmentId') ?? '').trim();
  const result = await removeAssignment({ taskId: id, assignmentId, adminId: session.adminId });

  if (result.error) return fail(result.error, result.status ?? 400);
  return json({ ok: true, message: result.ok });
}
