import Link from 'next/link';
import TaskForm from './task-form';
import { requireAdminPage } from '@/lib/auth';

export const metadata = { title: '新建排班任务 - 排班系统' };

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export default async function NewTaskPage() {
  await requireAdminPage();

  const today = new Date();
  const start = new Date(today.getTime() + 86400000);
  const end = new Date(today.getTime() + 7 * 86400000);
  const iso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const deadline = `${iso(new Date(today.getTime() + 5 * 86400000))}T18:00`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold">新建排班任务</h1>
        <Link className="btn" href="/admin/dashboard">
          返回任务列表
        </Link>
      </div>
      <TaskForm defaultStart={iso(start)} defaultEnd={iso(end)} defaultDeadline={deadline} />
    </div>
  );
}
