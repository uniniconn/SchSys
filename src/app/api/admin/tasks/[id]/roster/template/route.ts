import { prisma } from '@/lib/prisma';
import { requireAdminApi } from '@/lib/auth';
import { downloadResponse, parseFormat } from '@/lib/export';
import { fail } from '@/lib/http';

/** 名单模板下载：固定格式 = 姓名,工号,部门 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAdminApi();
  if (!session) return fail('未登录或会话已过期', 401);

  const { id } = await context.params;
  const task = await prisma.task.findUnique({ where: { id }, select: { name: true } });
  if (!task) return fail('任务不存在', 404);

  const format = parseFormat(new URL(request.url).searchParams.get('format'), 'csv');
  const headers = ['姓名', '工号', '部门'];
  const rows: Array<Array<string | number>> = [
    ['张三', 'A001', '内科'],
    ['李四', 'A002', '外科'],
  ];

  return downloadResponse({
    format,
    fileName: `名单模板-${task.name}`,
    headers,
    rows,
    sheets: [
      {
        name: '名单模板',
        rows: [headers, ...rows, ['（示例行请删除，姓名列必填，工号/部门可选，可增删行）']],
        headerRow: true,
        columnWidths: [18, 16, 18],
      },
      {
        name: '填写说明',
        rows: [
          ['说明'],
          ['1. 第一行必须是表头，且包含「姓名」列；「工号」「部门」为可选列。'],
          ['2. 每行一个人员，姓名不要重复、不要包含多余空格。'],
          ['3. 保存为 .xlsx 或 UTF-8 编码的 .csv 后在任务详情页上传。'],
        ],
      },
    ],
  });
}
