import { prisma } from '@/lib/prisma';
import { requireAdminApi } from '@/lib/auth';
import { downloadResponse, parseFormat } from '@/lib/export';
import { fail } from '@/lib/http';

/** 导出未填写名单 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAdminApi();
  if (!session) return fail('未登录或会话已过期', 401);

  const { id } = await context.params;
  const task = await prisma.task.findUnique({
    where: { id },
    select: { name: true, dateStart: true, dateEnd: true, roster: true, submissions: { select: { nameKey: true } } },
  });
  if (!task) return fail('任务不存在', 404);

  const submittedKeys = new Set(task.submissions.map((submission) => submission.nameKey));
  const unfilled = task.roster.filter((entry) => !submittedKeys.has(entry.nameKey));

  const format = parseFormat(new URL(request.url).searchParams.get('format'), 'csv');
  const headers = ['姓名', '工号', '部门', '任务名称', '日期范围'];
  const rows = unfilled.map((entry) => [
    entry.name,
    entry.empNo ?? '',
    entry.dept ?? '',
    task.name,
    `${task.dateStart} ~ ${task.dateEnd}`,
  ]);

  return downloadResponse({
    format,
    fileName: `未填写名单-${task.name}`,
    headers,
    rows,
    sheets: [
      {
        name: '未填写名单',
        rows: [headers, ...rows],
        headerRow: true,
        columnWidths: [16, 14, 16, 26, 24],
      },
    ],
  });
}
