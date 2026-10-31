import type { ReactNode } from 'react';
import AdminNav from './admin-nav';
import { requireAdminPage } from '@/lib/auth';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireAdminPage();

  return (
    <div className="min-h-screen bg-white">
      <AdminNav username={session.username} />
      <main className="mx-auto max-w-7xl px-4 py-4">{children}</main>
      <footer className="mx-auto max-w-7xl px-4 pb-6 pt-2 text-xs text-ink-soft no-print">
        排班系统 · 仅管理员可登录，填写用户凭专属链接与密码进入
      </footer>
    </div>
  );
}
