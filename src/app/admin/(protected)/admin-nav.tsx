'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/admin/dashboard', label: '任务列表' },
  { href: '/admin/tasks/new', label: '新建任务' },
  { href: '/admin/settings/admins', label: '管理员账号' },
  { href: '/admin/settings/password', label: '修改密码' },
];

export default function AdminNav({ username }: { username: string }) {
  const pathname = usePathname();

  return (
    <header className="border-b border-line bg-white no-print">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <span className="text-sm font-bold">排班系统</span>
        <nav className="flex flex-wrap items-center gap-1">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`border px-2 py-1 text-sm ${
                  active ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-ink-soft">管理员：{username}</span>
          <form action="/api/admin/auth/logout" method="post">
            <button type="submit" className="btn btn-sm">
              退出登录
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
