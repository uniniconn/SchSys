import Link from 'next/link';
import TaskWizard from './task-wizard';
import { requireAdminPage } from '@/lib/auth';

export const metadata = { title: '新建排班任务 - 排班系统' };

export default async function NewTaskPage() {
  await requireAdminPage();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">新建排班任务</h1>
          <p className="hint">快速创建只需名称与日期；需要多区域、晚自习规则时再进入详细配置。</p>
        </div>
        <Link className="btn" href="/admin/dashboard">
          返回任务列表
        </Link>
      </div>
      <TaskWizard />
    </div>
  );
}
