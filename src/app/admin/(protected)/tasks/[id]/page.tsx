import Link from 'next/link';
import { notFound } from 'next/navigation';
import FillLinkPanel from './fill-link-panel';
import LifecyclePanel from './lifecycle-panel';
import RosterPanel from './roster-panel';
import RosterDeleteButton from './roster-delete-button';
import ReasonsPanel from './reasons-panel';
import { prisma } from '@/lib/prisma';
import { requireAdminPage } from '@/lib/auth';
import { getFillProgress, getRosterComparison, getSubmissionSummaries, getUnavailableReasons } from '@/lib/task-data';
import { formatDateTime } from '@/lib/date-utils';
import { normalizeName } from '@/lib/roster';
import { TASK_STATUS_LABEL } from '@/lib/types';
import { resolveBaseUrl } from '@/lib/http';
import { computeGapsFromAssignments, sourceText } from '@/lib/result';

export const metadata = { title: '任务详情 - 排班系统' };

function toDateTimeLocal(value: Date | null): string {
  if (!value) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  await requireAdminPage();
  const { id } = await params;
  const { created } = await searchParams;

  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      shifts: { orderBy: { sortOrder: 'asc' } },
      areas: { orderBy: { sortOrder: 'asc' } },
      requirements: true,
      roster: { orderBy: { createdAt: 'asc' } },
      auditLogs: { orderBy: { createdAt: 'desc' }, take: 20, include: { admin: { select: { username: true } } } },
    },
  });
  if (!task) notFound();

  const [progress, comparison, summaries, reasons] = await Promise.all([
    getFillProgress(task.id),
    getRosterComparison(task.id),
    getSubmissionSummaries(task.id),
    getUnavailableReasons(task.id),
  ]);

  const assignments = await prisma.assignment.findMany({
    where: { taskId: task.id },
    select: {
      id: true,
      date: true,
      shiftId: true,
      areaId: true,
      name: true,
      source: true,
      manual: true,
      note: true,
      area: { select: { name: true } },
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });

  const manualCount = assignments.filter((assignment) => assignment.manual).length;
  const currentGaps = task.status === 'confirmed' || task.status === 'matched' ? await computeGapsFromAssignments(task.id) : [];
  const totalGap = currentGaps.reduce((sum, gap) => sum + gap.missing, 0);

  const dates = [...new Set(task.requirements.map((requirement) => requirement.date))].sort();
  const baseUrl = resolveBaseUrl();
  const published = task.status !== 'draft';
  const unlockedReasons = reasons.map((row) => ({
    date: row.date,
    shiftName: row.shiftName,
    name: row.name,
    dept: row.dept,
    empNo: row.empNo,
    reason: row.reason,
  }));

  const requirementTotal = task.requirements
    .filter((requirement) => requirement.headcount > 0)
    .reduce((sum, requirement) => sum + requirement.headcount, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">{task.name}</h1>
          <p className="hint">
            {task.dateStart} ~ {task.dateEnd} ・{' '}
            <span className="badge">{TASK_STATUS_LABEL[task.status] ?? task.status}</span> ・ 班次 {task.shifts.length} 个 ・
            区域 {task.areas.length} 个 ・
            总需求 {requirementTotal} 人次
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn" href="/admin/dashboard">
            返回任务列表
          </Link>
          {assignments.length > 0 ? (
            <Link className="btn btn-primary" href={`/admin/tasks/${task.id}/result`}>
              查看排班结果
            </Link>
          ) : null}
        </div>
      </div>

      {created === '1' ? (
        <div className="alert alert-ok">
          任务已创建为草稿。请在下方「填写链接与密码」中发布任务并设置填写密码，然后把链接和密码发给需要填写的人。
        </div>
      ) : null}

      <div className="alert alert-info">
        <strong>下一步：</strong>
        {task.status === 'draft' ? (
          <>在下方「填写链接与密码」中点击发布，复制链接与密码发给填写人。</>
        ) : task.status === 'published' ? (
          <>把填写链接与密码发给填写人；收齐后点击「截止并确认」，再执行自动匹配。</>
        ) : task.status === 'confirmed' ? (
          <>已截止确认，请在「截止确认与自动匹配」中点击「自动匹配排班」。</>
        ) : task.status === 'matched' ? (
          <>
            已生成排班结果。
            <Link className="underline" href={`/admin/tasks/${task.id}/result`}>
              查看结果与导出
            </Link>
            ，或到结果页做手动调整。
          </>
        ) : (
          <>任务已归档，如需修改可先恢复为已匹配状态（如界面提供）。</>
        )}
      </div>

      <FillLinkPanel
        taskId={task.id}
        publicToken={task.publicToken}
        baseUrl={baseUrl}
        published={published}
        showPasswordBox={created === '1'}
      />

      <div className="card">
        <div className="card-title">填写情况</div>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="border border-line p-3">
            <div className="hint">已填写人数</div>
            <div className="text-2xl font-bold">{progress.submitted}</div>
          </div>
          <div className="border border-line p-3">
            <div className="hint">应填写人数（名单人数）</div>
            <div className="text-2xl font-bold">{progress.expected > 0 ? progress.expected : '未上传名单'}</div>
          </div>
          <div className="border border-line p-3">
            <div className="hint">未填写人数</div>
            <div className="text-2xl font-bold">{progress.expected > 0 ? progress.pending : '-'}</div>
          </div>
          <div className="border border-line p-3">
            <div className="hint">已产生排班人次</div>
            <div className="text-2xl font-bold">{assignments.length}</div>
          </div>
        </div>
        <p className="hint mt-2">
          应填写人数以管理员上传的名单为准。未上传名单时，系统以实际提交人数统计，无法计算“未填写”。
        </p>
      </div>

      <RosterPanel taskId={task.id} rosterCount={progress.expected} />

      <div className="card">
        <div className="card-title">已提交人员（{summaries.length}）</div>
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th className="nowrap">姓名</th>
                <th className="nowrap">工号</th>
                <th className="nowrap">部门</th>
                <th className="nowrap">名单状态</th>
                <th className="nowrap">首选</th>
                <th className="nowrap">次选</th>
                <th className="nowrap">无法</th>
                <th className="nowrap">工作量</th>
                <th className="nowrap">上限</th>
                <th className="nowrap">最近提交</th>
              </tr>
            </thead>
            <tbody>
              {summaries.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-ink-soft">
                    还没有人提交。
                  </td>
                </tr>
              ) : (
                summaries.map((item) => (
                  <tr key={item.id}>
                    <td className="nowrap font-medium">{item.name}</td>
                    <td className="nowrap">{item.empNo ?? '-'}</td>
                    <td className="nowrap">{item.dept ?? '-'}</td>
                    <td className="nowrap">
                      {item.onRoster ? <span className="badge badge-ok">名单内</span> : <span className="badge badge-danger">名单外提交</span>}
                    </td>
                    <td className="nowrap">{item.preferredCount}</td>
                    <td className="nowrap">{item.backupCount}</td>
                    <td className="nowrap">{item.unavailableCount}</td>
                    <td className="nowrap">
                      {item.workloadPreference === 'more' ? '希望多排' : item.workloadPreference === 'less' ? '希望少排' : '正常'}
                    </td>
                    <td className="nowrap">{item.maxAssignments ?? '-'}</td>
                    <td className="nowrap">{formatDateTime(item.updatedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {progress.expected > 0 ? (
        <div className="card">
          <div className="card-title">名单核对结果</div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="section-title">未填写人员（{comparison.notSubmitted.length}）</div>
              {comparison.notSubmitted.length === 0 ? (
                <p className="text-sm text-ok">全部名单人员均已填写。</p>
              ) : (
                <div className="scroll-x">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>姓名</th>
                        <th>工号</th>
                        <th>部门</th>
                        <th className="nowrap">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.notSubmitted.map((entry) => (
                        <tr key={`${entry.name}-${entry.empNo ?? ''}`}>
                          <td>{entry.name}</td>
                          <td>{entry.empNo ?? '-'}</td>
                          <td>{entry.dept ?? '-'}</td>
                          <td className="nowrap">
                            {(() => {
                              const record = task.roster.find((item) => normalizeName(item.name) === normalizeName(entry.name));
                              return record ? <RosterDeleteButton taskId={task.id} entryId={record.id} name={entry.name} /> : null;
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div>
              <div className="section-title">名单外提交（{comparison.offRoster.length}）</div>
              {comparison.offRoster.length === 0 ? (
                <p className="text-sm text-ink-soft">没有名单外的提交。</p>
              ) : (
                <div className="scroll-x">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>姓名</th>
                        <th className="nowrap">提交时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.offRoster.map((entry) => (
                        <tr key={entry.name}>
                          <td>{entry.name}</td>
                          <td className="nowrap">{formatDateTime(entry.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
          <div className="mt-3">
            <div className="section-title">已填写名单人员（{comparison.submittedOnRoster.length}）</div>
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>姓名</th>
                    <th>工号</th>
                    <th>部门</th>
                    <th className="nowrap">提交时间</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.submittedOnRoster.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-ink-soft">
                        暂无
                      </td>
                    </tr>
                  ) : (
                    comparison.submittedOnRoster.map((entry) => (
                      <tr key={`${entry.name}-${entry.empNo ?? ''}`}>
                        <td>{entry.name}</td>
                        <td>{entry.empNo ?? '-'}</td>
                        <td>{entry.dept ?? '-'}</td>
                        <td className="nowrap">{formatDateTime(entry.updatedAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      <ReasonsPanel
        taskId={task.id}
        items={unlockedReasons}
        dates={dates}
        shifts={task.shifts.map((shift) => shift.name)}
      />

      <LifecyclePanel
        taskId={task.id}
        status={task.status}
        allowSameDayMultiple={task.allowSameDayMultiple}
        areaCoverage={task.areaCoverage === 'exclusive' ? 'exclusive' : 'shared'}
        maxAreasPerPerson={task.maxAreasPerPerson}
        lessDefaultMax={task.lessDefaultMax}
        matchSeed={task.matchSeed}
        name={task.name}
        description={task.description ?? ''}
        fillDeadline={toDateTimeLocal(task.fillDeadline)}
        manualCount={manualCount}
      />

      {task.matchSummary ? (
        <div className={`alert ${task.matchFeasible ? 'alert-ok' : 'alert-error'}`}>
          最近一次匹配（种子 {task.matchSeed}，{formatDateTime(task.lastMatchedAt)}）：{task.matchSummary}
          {!task.matchFeasible ? ' 请到结果页查看完整缺口报告。' : ''}
        </div>
      ) : null}

      {assignments.length > 0 ? (
        <div className="card">
          <div className="card-title">
            排班结果概览（前 20 条）{manualCount > 0 ? `　手动调整 ${manualCount} 条` : ''}
          </div>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th className="nowrap">日期</th>
                  <th className="nowrap">班次</th>
                  <th className="nowrap">区域</th>
                  <th className="nowrap">人员</th>
                  <th className="nowrap">来源</th>
                  <th className="nowrap">说明</th>
                </tr>
              </thead>
              <tbody>
                {assignments.slice(0, 20).map((assignment) => (
                  <tr key={assignment.id}>
                    <td className="nowrap">{assignment.date}</td>
                    <td className="nowrap">{task.shifts.find((shift) => shift.id === assignment.shiftId)?.name ?? '-'}</td>
                    <td className="nowrap">{assignment.area?.name ?? '-'}</td>
                    <td className="nowrap">{assignment.name}</td>
                    <td className="nowrap">
                      {assignment.manual ? (
                        <span className="badge badge-brand">{sourceText(assignment.source, true)}</span>
                      ) : (
                        sourceText(assignment.source)
                      )}
                    </td>
                    <td>{assignment.note ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 flex flex-wrap gap-2">
            <Link className="btn btn-primary btn-sm" href={`/admin/tasks/${task.id}/result`}>
              查看完整排班结果与导出
            </Link>
            {task.status === 'confirmed' || task.status === 'matched' ? (
              <Link className="btn btn-sm" href={`/admin/tasks/${task.id}/result#manual-adjust`}>
                手动调整人员（增删）
              </Link>
            ) : null}
          </p>
          {totalGap > 0 ? (
            <p className="hint mt-2 text-danger">
              当前仍缺 {totalGap} 人次（{currentGaps.length} 个“日期+班次”），可到结果页「手动调整」补人，或重新匹配。
            </p>
          ) : (
            <p className="hint mt-2 text-ok">当前所有班次需求均已满足。</p>
          )}
        </div>
      ) : null}

      <div className="card">
        <div className="card-title">任务班次与需求</div>
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th className="nowrap">班次</th>
                <th className="nowrap">时间</th>
                <th className="nowrap">区域（组/人数）</th>
                <th className="nowrap">默认人数</th>
                <th className="nowrap">需要该班次的日期数</th>
                <th className="nowrap">合计需求</th>
              </tr>
            </thead>
            <tbody>
              {task.shifts.map((shift) => {
                const rows = task.requirements.filter((requirement) => requirement.shiftId === shift.id);
                const shiftAreas = task.areas.filter((area) => area.shiftId === shift.id);
                return (
                  <tr key={shift.id}>
                    <td className="nowrap font-medium">{shift.name}</td>
                    <td className="nowrap">
                      {shift.startTime} ~ {shift.endTime}
                    </td>
                    <td>
                      {shiftAreas.map((area) => (
                        <span key={area.id} className="mr-2 inline-block border border-line px-1 py-0.5 text-xs">
                          {area.name}
                          <span className="hint ml-1">
                            {area.groupName} / {area.defaultHeadcount} 人
                          </span>
                        </span>
                      ))}
                    </td>
                    <td className="nowrap">{shift.defaultHeadcount}</td>
                    <td className="nowrap">{rows.filter((row) => row.headcount > 0).length}</td>
                    <td className="nowrap">{rows.reduce((sum, row) => sum + row.headcount, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-title">操作日志（最近 20 条）</div>
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th className="nowrap">时间</th>
                <th className="nowrap">操作人</th>
                <th className="nowrap">动作</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {task.auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-ink-soft">
                    暂无日志
                  </td>
                </tr>
              ) : (
                task.auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="nowrap">{formatDateTime(log.createdAt)}</td>
                    <td className="nowrap">{log.admin?.username ?? '-'}</td>
                    <td className="nowrap">{log.action}</td>
                    <td>{log.detail ?? '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
