import Link from 'next/link';
import { redirect } from 'next/navigation';
import PasswordGateForm from './password-gate-form';
import { findTaskByToken, hasFillAccess } from '@/lib/fill';
import { formatDateTime } from '@/lib/date-utils';

export const metadata = { title: '填写排班意愿' };

export default async function FillGatePage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const task = await findTaskByToken(uuid);

  if (!task) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <div className="card">
          <h1 className="card-title">链接无效</h1>
          <p className="text-sm text-ink-soft">
            该填写链接无效或已被删除，请向排班管理员确认链接是否完整（链接中应包含一长串唯一标识）。
          </p>
        </div>
      </main>
    );
  }

  // 已通过密码进入过，直接跳到填写页
  if (await hasFillAccess(task)) redirect(`/fill/${uuid}/form`);

  const closed = task.status === 'confirmed' || task.status === 'matched';

  return (
    <main className="mx-auto max-w-lg p-6">
      <div className="card">
        <h1 className="card-title">排班意愿填写</h1>
        {closed ? (
          <div className="alert alert-info mb-3">该任务已截止确认，填写已锁定；你仍可输入密码查看自己的填写内容。</div>
        ) : null}
        <p className="mb-3 text-sm">
          日期范围：{task.dateStart} ~ {task.dateEnd}
          {task.fillDeadline ? <>　填写截止：{formatDateTime(task.fillDeadline)}</> : null}
        </p>
        {task.description ? <p className="mb-3 border border-line bg-soft p-2 text-sm">{task.description}</p> : null}
        <PasswordGateForm uuid={uuid} taskName={task.name} />
        <p className="hint mt-4 border-t border-line pt-3">
          无需注册账号，输入管理员提供的填写密码即可进入。填写完成后如需修改，请在管理员确认前重新进入。
        </p>
        <p className="mt-2 text-xs">
          <Link href="/fill">返回填写入口</Link>
        </p>
      </div>
    </main>
  );
}
