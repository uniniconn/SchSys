import { redirect } from 'next/navigation';
import FillForm from './fill-form';
import { buildRequirementCells, fillLocked, findTaskByToken, hasFillAccess } from '@/lib/fill';
import { formatDateTime } from '@/lib/date-utils';

export const metadata = { title: '填写排班意愿' };

export default async function FillFormPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const task = await findTaskByToken(uuid);
  if (!task) redirect(`/fill/${uuid}`);

  if (!(await hasFillAccess(task))) redirect(`/fill/${uuid}`);

  const locked = fillLocked(task);
  const cells = buildRequirementCells(task);

  if (cells.length === 0) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <div className="card">
          <h1 className="card-title">{task.name}</h1>
          <p className="text-sm text-danger">
            该任务尚未配置任何有效班次需求（每个班次所需人数均为 0 或未设置），请联系管理员。
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="mb-4 border border-line bg-soft p-3">
        <h1 className="text-lg font-bold">{task.name}</h1>
        <p className="text-sm">
          日期范围：{task.dateStart} ~ {task.dateEnd}
          {task.fillDeadline ? <>　填写截止：{formatDateTime(task.fillDeadline)}</> : null}
        </p>
        <p className="hint">无需账号登录；填写完成后如需修改，在管理员确认前用同一姓名重新进入即可。</p>
      </div>

      <FillForm
        uuid={uuid}
        taskName={task.name}
        description={task.description}
        shifts={task.shifts}
        cells={cells}
        roster={task.roster}
        hasRoster={task.roster.length > 0}
        locked={locked.locked}
        lockedReason={locked.reason}
      />
    </main>
  );
}
