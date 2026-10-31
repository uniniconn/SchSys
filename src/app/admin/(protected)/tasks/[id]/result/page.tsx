import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminPage } from '@/lib/auth';
import {
  buildCalendarRows,
  buildNameRows,
  computeGapsFromAssignments,
  loadTaskForResult,
  sourceText,
  summarizeTaskResult,
} from '@/lib/result';
import { formatDateTime, weekdayLabel, friendlyDate } from '@/lib/date-utils';
import { TASK_STATUS_LABEL } from '@/lib/types';
import PrintButton from './print-button';
import ManualAdjustPanel from './manual-adjust-panel';

export const metadata = { title: '排班结果 - 排班系统' };

export default async function TaskResultPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;

  const task = await loadTaskForResult(id);
  if (!task) notFound();

  const shifts = task.shifts.map((shift) => ({
    id: shift.id,
    name: shift.name,
    startTime: shift.startTime,
    endTime: shift.endTime,
    sortOrder: shift.sortOrder,
    defaultHeadcount: shift.defaultHeadcount,
  }));

  const requirements = task.requirements.map((requirement) => ({
    date: requirement.date,
    shiftId: requirement.shiftId,
    headcount: requirement.headcount,
  }));

  const assignmentLike = task.assignments.map((assignment) => ({
    id: assignment.id,
    date: assignment.date,
    shiftId: assignment.shiftId,
    name: assignment.name,
    source: assignment.source,
    manual: assignment.manual,
    note: assignment.note,
  }));

  const calendarRows = buildCalendarRows(shifts, requirements, assignmentLike);
  const nameRows = buildNameRows(shifts, assignmentLike);

  // 缺口以“实际排班结果”为准：手动补齐后缺口会自动减少/消失
  const [gaps, summary] = await Promise.all([
    computeGapsFromAssignments(task.id),
    summarizeTaskResult(task.id),
  ]);

  const dates = [...new Set(calendarRows.map((row) => row.date))].sort();
  const canAdjust = task.status === 'confirmed' || task.status === 'matched';
  const manualCount = task.assignments.filter((assignment) => assignment.manual).length;
  const totalGap = gaps.reduce((sum, gap) => sum + gap.missing, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <div>
          <h1 className="text-lg font-bold">{task.name} · 排班结果</h1>
          <p className="hint">
            {task.dateStart} ~ {task.dateEnd} ・ <span className="badge">{TASK_STATUS_LABEL[task.status] ?? task.status}</span>
            {task.lastMatchedAt ? <> ・ 最近匹配：{formatDateTime(task.lastMatchedAt)}（种子 {task.matchSeed}）</> : null}
            {manualCount > 0 ? <> ・ <span className="badge badge-brand">手动调整 {manualCount} 条</span></> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canAdjust ? (
            <a className="btn btn-primary" href="#manual-adjust">
              手动调整排班
            </a>
          ) : null}
          <Link className="btn" href={`/admin/tasks/${task.id}`}>
            返回任务详情
          </Link>
          <Link className="btn" href="/admin/dashboard">
            任务列表
          </Link>
        </div>
      </div>

      <div className="card no-print">
        <div className="card-title">导出与打印</div>
        <div className="flex flex-wrap gap-2">
          <a className="btn" href={`/api/admin/tasks/${task.id}/result?format=csv&sheet=calendar`}>
            导出日历排班表 (CSV)
          </a>
          <a className="btn" href={`/api/admin/tasks/${task.id}/result?format=xlsx&sheet=calendar`}>
            导出日历排班表 (XLSX)
          </a>
          <a className="btn" href={`/api/admin/tasks/${task.id}/result?format=csv&sheet=name`}>
            导出姓名排班表 (CSV)
          </a>
          <a className="btn" href={`/api/admin/tasks/${task.id}/result?format=xlsx&sheet=name`}>
            导出姓名排班表 (XLSX)
          </a>
          <a className="btn" href={`/api/admin/tasks/${task.id}/result?format=xlsx&sheet=all`}>
            导出全部（含缺口报告）
          </a>
          <a className="btn" href={`/api/admin/tasks/${task.id}/result?format=csv&sheet=gaps`}>
            导出缺口报告 (CSV)
          </a>
          <PrintButton />
        </div>
        <p className="hint mt-2">
          打印时会自动隐藏按钮等操作元素；导出内容包含手动调整后的最终结果（来源列区分“首选 / 次选 / 手动”）。
        </p>
      </div>

      <div className="card">
        <div className="card-title">当前进度</div>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="border border-line p-3">
            <div className="hint">已安排 / 总需求</div>
            <div className="text-2xl font-bold">
              {task.assignments.length} / {summary?.required ?? 0}
            </div>
          </div>
          <div className="border border-line p-3">
            <div className="hint">缺口人次</div>
            <div className={`text-2xl font-bold ${totalGap > 0 ? 'text-danger' : 'text-ok'}`}>{totalGap}</div>
          </div>
          <div className="border border-line p-3">
            <div className="hint">来源分布</div>
            <div className="text-sm">
              首选 {summary?.preferred ?? 0} ・ 次选 {summary?.backup ?? 0} ・ 手动 {summary?.manual ?? 0}
            </div>
          </div>
          <div className="border border-line p-3">
            <div className="hint">状态</div>
            <div className="text-sm">
              {totalGap === 0 ? <span className="text-ok font-bold">全部满足</span> : <span className="text-danger font-bold">仍存在缺口</span>}
            </div>
          </div>
        </div>
      </div>

      {task.assignments.length === 0 ? (
        <div className="alert alert-error">
          当前没有可展示的排班结果。可能原因：任务尚未截止确认、尚未点击「自动匹配排班」，或存在缺口导致未生成结果。
          {gaps.length > 0 ? ' 你可以在下方「手动调整排班」中人工补人，或查看缺口报告。' : ''}
        </div>
      ) : null}

      {gaps.length > 0 ? (
        <div className="card">
          <div className="card-title">
            缺口报告（{gaps.length} 个“日期+班次”未满足，共缺 {totalGap} 人次）
          </div>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th className="nowrap">日期</th>
                  <th className="nowrap">星期</th>
                  <th className="nowrap">班次</th>
                  <th className="nowrap">需求人数</th>
                  <th className="nowrap">已满足人数</th>
                  <th className="nowrap">缺口人数</th>
                  <th>可能原因</th>
                </tr>
              </thead>
              <tbody>
                {gaps.map((gap) => (
                  <tr key={`${gap.date}-${gap.shiftId}`}>
                    <td className="nowrap">{gap.date}</td>
                    <td className="nowrap">{weekdayLabel(gap.date)}</td>
                    <td className="nowrap">{gap.shiftName}</td>
                    <td className="nowrap">{gap.required}</td>
                    <td className="nowrap">{gap.filled}</td>
                    <td className="nowrap text-danger font-bold">{gap.missing}</td>
                    <td>{gap.reasons.join('；')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint mt-2">
            缺口不会强行用「无法排班」的用户填补。可在下方「手动调整排班」中人工补人；也可放宽「允许同日多班」、
            邀请更多人填写首选/次选，或调整需求人数后重新匹配。
          </p>
        </div>
      ) : null}

      {calendarRows.length > 0 ? (
        <div className="card">
          <div className="card-title">一、日历排班表（按日期 × 班次）</div>
          {dates.map((date) => {
            const rows = calendarRows.filter((row) => row.date === date);
            return (
              <div key={date} className="mb-4 last:mb-0">
                <div className="section-title">
                  {date} {weekdayLabel(date)}（{friendlyDate(date)}）
                </div>
                <div className="scroll-x">
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="nowrap w-32">班次</th>
                        <th className="nowrap w-32">时间</th>
                        <th className="nowrap w-24">需求人数</th>
                        <th>安排人员</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={`${row.date}-${row.shiftId}`}>
                          <td className="nowrap font-medium">{row.shiftName}</td>
                          <td className="nowrap">
                            {row.startTime}~{row.endTime}
                          </td>
                          <td className="nowrap">{row.headcount}</td>
                          <td>
                            {row.people.length === 0 ? (
                              <span className="text-danger">未安排（缺口 {row.missing} 人）</span>
                            ) : (
                              row.people.map((person) => (
                                <span
                                  key={person.assignmentId || `${row.date}-${row.shiftId}-${person.name}`}
                                  className={`mr-2 inline-block border px-2 py-0.5 ${
                                    person.manual ? 'border-brand' : 'border-line'
                                  }`}
                                >
                                  {person.name}
                                  <span className={`hint ml-1 ${person.manual ? 'text-brand' : ''}`}>
                                    {sourceText(person.source, person.manual)}
                                  </span>
                                  {person.note ? (
                                    <span className="hint ml-1" title={person.note}>
                                      （{person.note}）
                                    </span>
                                  ) : null}
                                </span>
                              ))
                            )}
                            {row.missing > 0 && row.people.length > 0 ? (
                              <span className="text-danger">（还缺 {row.missing} 人）</span>
                            ) : null}
                            {row.over > 0 ? <span className="text-danger">（超员 {row.over} 人）</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {canAdjust ? (
        <ManualAdjustPanel
          taskId={task.id}
          manualCount={manualCount}
          rows={calendarRows.map((row) => ({
            date: row.date,
            shiftId: row.shiftId,
            shiftName: row.shiftName,
            startTime: row.startTime,
            endTime: row.endTime,
            headcount: row.headcount,
            people: row.people,
          }))}
        />
      ) : (
        <div className="alert alert-info no-print">
          完成「截止并确认」后，可在此页面手动增删排班人员。请先回到任务详情页点击「截止并确认」。
        </div>
      )}

      {nameRows.length > 0 ? (
        <div className="card">
          <div className="card-title">二、姓名排班表（按人员）</div>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th className="nowrap w-28">姓名</th>
                  <th className="nowrap w-24">总班次数</th>
                  <th>日期 / 班次 / 来源</th>
                </tr>
              </thead>
              <tbody>
                {nameRows.map((row) => (
                  <tr key={row.name}>
                    <td className="nowrap font-medium">{row.name}</td>
                    <td className="nowrap">{row.total}</td>
                    <td>
                      {row.entries.map((entry, index) => (
                        <span
                          key={`${entry.date}-${entry.shiftName}-${index}`}
                          className={`mr-2 inline-block border px-2 py-0.5 ${entry.manual ? 'border-brand' : 'border-line'}`}
                        >
                          {entry.date}（{weekdayLabel(entry.date)}） {entry.shiftName} {entry.startTime}~{entry.endTime}
                          <span className={`hint ml-1 ${entry.manual ? 'text-brand' : ''}`}>
                            {sourceText(entry.source, entry.manual)}
                          </span>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-title">三、统计概览</div>
        <table className="table">
          <tbody>
            <tr>
              <th className="w-48">任务总需求</th>
              <td>
                {summary?.required ?? 0} 人次（
                {task.requirements.filter((requirement) => requirement.headcount > 0).length} 个“日期+班次”）
              </td>
            </tr>
            <tr>
              <th>已安排人次</th>
              <td>
                {task.assignments.length} 人次（首选 {summary?.preferred ?? 0} ・ 次选 {summary?.backup ?? 0} ・ 手动{' '}
                {summary?.manual ?? 0}）
              </td>
            </tr>
            <tr>
              <th>缺口人次</th>
              <td className={totalGap > 0 ? 'text-danger' : 'text-ok'}>{totalGap} 人次</td>
            </tr>
            <tr>
              <th>随机种子</th>
              <td>{task.matchSeed ?? '-'}（固定种子 + 历史排班次数 + 提交时间，保证结果可复现）</td>
            </tr>
            <tr>
              <th>最近匹配说明</th>
              <td>{task.matchSummary ?? '-'}</td>
            </tr>
            <tr>
              <th>手动调整</th>
              <td>
                {manualCount > 0 ? (
                  <>
                    {manualCount} 条手动调整记录（重新执行自动匹配会被覆盖）
                  </>
                ) : (
                  '暂无手动调整'
                )}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="hint mt-2">
          重新匹配：回到任务详情页，在「截止确认与自动匹配」中指定随机种子后点击「重新匹配」，系统会二次确认并覆盖现有结果
          （包括手动调整）。
        </p>
        <p className="no-print mt-3">
          <Link className="btn" href={`/admin/tasks/${task.id}`}>
            返回任务详情（截止确认 / 重新匹配）
          </Link>
        </p>
      </div>
    </div>
  );
}
