import { requireAdminApi } from '@/lib/auth';
import { downloadResponse, parseFormat } from '@/lib/export';
import { fail } from '@/lib/http';
import {
  buildCalendarRows,
  buildNameRows,
  computeGapsFromAssignments,
  loadTaskForResult,
  resolveSource,
  SOURCE_LABEL,
  summarizeTaskResult,
} from '@/lib/result';
import { weekdayLabel } from '@/lib/date-utils';

/** 排班结果导出：日历排班表 / 姓名排班表 / 缺口报告 / 统计概览（含区域与手动调整） */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAdminApi();
  if (!session) return fail('未登录或会话已过期', 401);

  const { id } = await context.params;
  const task = await loadTaskForResult(id);
  if (!task) return fail('任务不存在', 404);

  const params = new URL(request.url).searchParams;
  const format = parseFormat(params.get('format'), 'csv');
  const sheet = params.get('sheet') ?? 'calendar';

  const shifts = task.shifts.map((shift) => ({
    id: shift.id,
    name: shift.name,
    startTime: shift.startTime,
    endTime: shift.endTime,
    sortOrder: shift.sortOrder,
    defaultHeadcount: shift.defaultHeadcount,
    areas: task.areas
      .filter((area) => area.shiftId === shift.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((area) => ({
        id: area.id,
        shiftId: area.shiftId,
        name: area.name,
        groupName: area.groupName,
        sortOrder: area.sortOrder,
        defaultHeadcount: area.defaultHeadcount,
      })),
  }));

  const assignmentLike = task.assignments.map((assignment) => ({
    id: assignment.id,
    date: assignment.date,
    shiftId: assignment.shiftId,
    areaId: assignment.areaId,
    name: assignment.name,
    source: assignment.source,
    manual: assignment.manual,
    note: assignment.note,
  }));

  const calendarRows = buildCalendarRows(
    shifts,
    task.requirements.map((requirement) => ({
      date: requirement.date,
      shiftId: requirement.shiftId,
      areaId: requirement.areaId,
      headcount: requirement.headcount,
    })),
    assignmentLike,
  );

  const nameRows = buildNameRows(shifts, assignmentLike);
  const gaps = await computeGapsFromAssignments(task.id);
  const summary = await summarizeTaskResult(task.id);

  const calendarHeaders = [
    '日期',
    '星期',
    '班次',
    '区域',
    '区域组',
    '开始时间',
    '结束时间',
    '需求人数',
    '已安排人数',
    '安排人员',
    '来源',
    '是否手动调整',
    '调整说明',
    '缺口人数',
  ];
  const calendarData: Array<Array<string | number>> = [];
  for (const row of calendarRows) {
    if (row.people.length === 0) {
      calendarData.push([
        row.date,
        weekdayLabel(row.date),
        row.shiftName,
        row.areaName,
        row.groupName,
        row.startTime,
        row.endTime,
        row.headcount,
        0,
        '',
        '',
        '',
        '',
        row.missing,
      ]);
    } else {
      for (const person of row.people) {
        calendarData.push([
          row.date,
          weekdayLabel(row.date),
          row.shiftName,
          row.areaName,
          row.groupName,
          row.startTime,
          row.endTime,
          row.headcount,
          row.people.length,
          person.name,
          SOURCE_LABEL[resolveSource(person.source, person.manual)] ?? person.source,
          person.manual ? '是' : '否',
          person.note ?? '',
          row.missing,
        ]);
      }
    }
  }

  const nameHeaders = ['姓名', '总班次数', '日期', '星期', '班次', '区域', '开始时间', '结束时间', '来源', '是否手动调整'];
  const nameData: Array<Array<string | number>> = [];
  for (const row of nameRows) {
    for (const entry of row.entries) {
      nameData.push([
        row.name,
        row.total,
        entry.date,
        weekdayLabel(entry.date),
        entry.shiftName,
        entry.areaName,
        entry.startTime,
        entry.endTime,
        SOURCE_LABEL[resolveSource(entry.source, entry.manual)] ?? entry.source,
        entry.manual ? '是' : '否',
      ]);
    }
  }

  const gapHeaders = ['日期', '星期', '班次', '区域', '需求人数', '已满足人数', '缺口人数', '可能原因'];
  const gapData = gaps.map((gap) => [
    gap.date,
    weekdayLabel(gap.date),
    gap.shiftName,
    gap.areaName,
    gap.required,
    gap.filled,
    gap.missing,
    gap.reasons.join('；'),
  ]);

  const manualCount = task.assignments.filter((assignment) => assignment.manual).length;
  const summaryHeaders = ['统计项', '数值'];
  const summaryData: Array<Array<string | number>> = [
    ['任务名称', task.name],
    ['日期范围', `${task.dateStart} ~ ${task.dateEnd}`],
    ['任务状态', task.status],
    ['区域模式', task.areaCoverage === 'shared' ? `同组可兼顾（每人最多 ${task.maxAreasPerPerson} 个区域）` : '区域独立分人'],
    ['总需求人次', summary?.required ?? 0],
    ['已安排人次', task.assignments.length],
    ['首选人次', summary?.preferred ?? 0],
    ['次选人次', summary?.backup ?? 0],
    ['手动调整人次', manualCount],
    ['兼顾多区域人次', summary?.multiAreaAssignments ?? 0],
    ['缺口人次', gaps.reduce((sum, gap) => sum + gap.missing, 0)],
    ['随机种子', task.matchSeed ?? ''],
    ['匹配说明', task.matchSummary ?? ''],
    ['导出时间', new Date().toLocaleString('zh-CN')],
  ];

  const fileNameBase = `排班结果-${task.name}`;

  if (format === 'xlsx') {
    const sheets =
      sheet === 'all'
        ? [
            {
              name: '日历排班表',
              rows: [calendarHeaders, ...calendarData],
              headerRow: true,
              columnWidths: [13, 8, 12, 12, 12, 10, 10, 10, 12, 14, 10, 12, 24, 10],
            },
            { name: '姓名排班表', rows: [nameHeaders, ...nameData], headerRow: true, columnWidths: [14, 10, 13, 8, 12, 12, 10, 10, 10, 12] },
            { name: '缺口报告', rows: [gapHeaders, ...gapData], headerRow: true, columnWidths: [13, 8, 12, 12, 10, 12, 10, 46] },
            { name: '统计概览', rows: [summaryHeaders, ...summaryData], headerRow: true, columnWidths: [18, 46] },
          ]
        : sheet === 'name'
          ? [{ name: '姓名排班表', rows: [nameHeaders, ...nameData], headerRow: true, columnWidths: [14, 10, 13, 8, 12, 12, 10, 10, 10, 12] }]
          : sheet === 'gaps'
            ? [{ name: '缺口报告', rows: [gapHeaders, ...gapData], headerRow: true, columnWidths: [13, 8, 12, 12, 10, 12, 10, 46] }]
            : [
                {
                  name: '日历排班表',
                  rows: [calendarHeaders, ...calendarData],
                  headerRow: true,
                  columnWidths: [13, 8, 12, 12, 12, 10, 10, 10, 12, 14, 10, 12, 24, 10],
                },
              ];

    return downloadResponse({ format: 'xlsx', fileName: `${fileNameBase}-${sheet}`, headers: [], rows: [], sheets });
  }

  if (sheet === 'name') {
    return downloadResponse({ format, fileName: `${fileNameBase}-姓名排班表`, headers: nameHeaders, rows: nameData });
  }
  if (sheet === 'gaps') {
    return downloadResponse({ format, fileName: `${fileNameBase}-缺口报告`, headers: gapHeaders, rows: gapData });
  }
  if (sheet === 'summary') {
    return downloadResponse({ format, fileName: `${fileNameBase}-统计概览`, headers: summaryHeaders, rows: summaryData });
  }

  const rows = [...calendarData];
  if (gaps.length > 0) {
    rows.push([]);
    rows.push(['缺口报告']);
    rows.push(gapHeaders);
    rows.push(...gapData);
  }
  rows.push([]);
  rows.push(['统计概览']);
  rows.push(...summaryData);

  return downloadResponse({ format, fileName: `${fileNameBase}-日历排班表`, headers: calendarHeaders, rows });
}
