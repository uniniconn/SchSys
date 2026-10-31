import Link from 'next/link';
import { findTaskByToken, fillLocked, hasFillAccess } from '@/lib/fill';
import { normalizeName } from '@/lib/roster';
import { prisma } from '@/lib/prisma';
import { formatDateTime } from '@/lib/date-utils';

export const metadata = { title: '提交成功' };

export default async function FillSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ uuid: string }>;
  searchParams: Promise<{ name?: string }>;
}) {
  const { uuid } = await params;
  const { name = '' } = await searchParams;
  const task = await findTaskByToken(uuid);

  if (!task) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <div className="card">
          <h1 className="card-title">链接无效</h1>
          <p className="text-sm text-ink-soft">该填写链接无效或已被删除。</p>
        </div>
      </main>
    );
  }

  const allowed = await hasFillAccess(task);
  const locked = fillLocked(task);

  let summary: { preferred: number; backup: number; unavailable: number; updatedAt: Date; status: string } | null = null;
  if (allowed && name.trim()) {
    const submission = await prisma.submission.findUnique({
      where: { taskId_nameKey: { taskId: task.id, nameKey: normalizeName(name) } },
      select: {
        status: true,
        updatedAt: true,
        selections: { select: { choice: true } },
      },
    });
    if (submission) {
      summary = {
        status: submission.status,
        updatedAt: submission.updatedAt,
        preferred: submission.selections.filter((s) => s.choice === 'preferred').length,
        backup: submission.selections.filter((s) => s.choice === 'backup').length,
        unavailable: submission.selections.filter((s) => s.choice === 'unavailable').length,
      };
    }
  }

  return (
    <main className="mx-auto max-w-lg p-6">
      <div className="card">
        <h1 className="card-title">提交成功</h1>
        <p className="text-sm alert alert-ok mb-3">
          {name ? `「${name}」的排班意愿已提交成功。` : '你的排班意愿已提交成功。'}
        </p>

        <table className="table">
          <tbody>
            <tr>
              <th className="w-32">任务名称</th>
              <td>{task.name}</td>
            </tr>
            <tr>
              <th>日期范围</th>
              <td>
                {task.dateStart} ~ {task.dateEnd}
              </td>
            </tr>
            {summary ? (
              <>
                <tr>
                  <th>选择统计</th>
                  <td>
                    首选 {summary.preferred} 个 · 次选 {summary.backup} 个 · 无法排班 {summary.unavailable} 个
                  </td>
                </tr>
                <tr>
                  <th>提交时间</th>
                  <td>{formatDateTime(summary.updatedAt)}</td>
                </tr>
                <tr>
                  <th>当前状态</th>
                  <td>
                    {summary.status === 'locked' ? (
                      <span className="badge badge-ok">已被管理员确认锁定</span>
                    ) : (
                      <span className="badge badge-brand">已提交（管理员确认前可修改）</span>
                    )}
                  </td>
                </tr>
              </>
            ) : null}
          </tbody>
        </table>

        {locked.locked ? (
          <p className="alert alert-info mt-3">本次排班已由管理员截止确认，你的填写已锁定，不能再修改。</p>
        ) : (
          <p className="hint mt-3">
            如需修改，请返回填写页面，使用同一姓名重新进入（可先点击「载入我已提交的内容」），修改后再次提交即可覆盖。
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Link className="btn" href={`/fill/${uuid}/form`}>
            返回填写页面
          </Link>
        </div>
      </div>
    </main>
  );
}
