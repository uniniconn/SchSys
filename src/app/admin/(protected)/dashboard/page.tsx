import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { formatDateTime } from '@/lib/date-utils';
import { TASK_STATUS_LABEL } from '@/lib/types';
import { requireAdminPage } from '@/lib/auth';
import OnboardingCard from './onboarding-card';

export const metadata = { title: '任务列表 - 排班系统' };

function statusBadgeClass(status: string): string {
  if (status === 'draft') return 'badge';
  if (status === 'published') return 'badge badge-brand';
  if (status === 'confirmed') return 'badge badge-ok';
  return 'badge badge-ok';
}

export default async function DashboardPage() {
  await requireAdminPage();

  const tasks = await prisma.task.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { submissions: true, roster: true, shifts: true } },
      assignments: { select: { id: true }, take: 1 },
    },
  });

  return (
    <div className="space-y-4">
      <OnboardingCard />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold">排班任务</h1>
        <Link className="btn btn-primary" href="/admin/tasks/new">
          + 新建排班任务
        </Link>
      </div>

      <div className="card">
        <div className="card-title">全部任务（{tasks.length}）</div>
        {tasks.length === 0 ? (
          <p className="text-sm text-ink-soft">
            还没有任务，点击右上角「新建排班任务」开始。新建并发布后，系统会生成专属填写链接与填写密码。
          </p>
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th className="min-w-[200px]">任务名称</th>
                  <th className="nowrap">状态</th>
                  <th className="nowrap">日期范围</th>
                  <th className="nowrap">填写截止</th>
                  <th className="nowrap">班次数</th>
                  <th className="nowrap">已填写</th>
                  <th className="nowrap">名单人数</th>
                  <th className="nowrap">已排班</th>
                  <th className="nowrap">操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <Link href={`/admin/tasks/${task.id}`} className="font-medium">
                        {task.name}
                      </Link>
                      {task.description ? <div className="hint mt-1">{task.description}</div> : null}
                    </td>
                    <td className="nowrap">
                      <span className={statusBadgeClass(task.status)}>{TASK_STATUS_LABEL[task.status] ?? task.status}</span>
                    </td>
                    <td className="nowrap">
                      {task.dateStart} ~ {task.dateEnd}
                    </td>
                    <td className="nowrap">{formatDateTime(task.fillDeadline)}</td>
                    <td className="nowrap">{task._count.shifts}</td>
                    <td className="nowrap">{task._count.submissions}</td>
                    <td className="nowrap">{task._count.roster}</td>
                    <td className="nowrap">{task.assignments.length > 0 ? '有结果' : '-'}</td>
                    <td className="nowrap">
                      <div className="flex flex-wrap gap-1">
                        <Link className="btn btn-sm" href={`/admin/tasks/${task.id}`}>
                          详情
                        </Link>
                        {task.status === 'matched' || task.assignments.length > 0 ? (
                          <Link className="btn btn-sm" href={`/admin/tasks/${task.id}/result`}>
                            结果
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
