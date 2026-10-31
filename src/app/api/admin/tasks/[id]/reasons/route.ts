import { prisma } from '@/lib/prisma';
import { requireAdminApi } from '@/lib/auth';
import { downloadResponse, parseFormat } from '@/lib/export';
import { fail } from '@/lib/http';
import { getUnavailableReasons } from '@/lib/task-data';

/** 导出「无法排班」理由汇总（支持按关键字/日期/班次筛选） */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAdminApi();
  if (!session) return fail('未登录或会话已过期', 401);

  const { id } = await context.params;
  const task = await prisma.task.findUnique({ where: { id }, select: { name: true } });
  if (!task) return fail('任务不存在', 404);

  const params = new URL(request.url).searchParams;
  const format = parseFormat(params.get('format'), 'csv');
  const keyword = (params.get('q') ?? '').trim().toLowerCase();
  const dateFilter = params.get('date') ?? '';
  const shiftFilter = params.get('shift') ?? '';

  let rows = await getUnavailableReasons(id);
  if (dateFilter) rows = rows.filter((row) => row.date === dateFilter);
  if (shiftFilter) rows = rows.filter((row) => row.shiftName === shiftFilter);
  if (keyword) {
    rows = rows.filter((row) =>
      [row.name, row.reason, row.date, row.shiftName, row.dept ?? '', row.empNo ?? '']
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    );
  }

  const headers = ['日期', '班次', '开始时间', '结束时间', '姓名', '工号', '部门', '无法排班理由'];
  const data = rows.map((row) => [
    row.date,
    row.shiftName,
    row.startTime,
    row.endTime,
    row.name,
    row.empNo ?? '',
    row.dept ?? '',
    row.reason,
  ]);

  return downloadResponse({
    format,
    fileName: `无法排班理由-${task.name}`,
    headers,
    rows: data,
    sheets: [
      {
        name: '无法排班理由',
        rows: [headers, ...data],
        headerRow: true,
        columnWidths: [14, 12, 10, 10, 14, 12, 16, 40],
      },
    ],
  });
}
