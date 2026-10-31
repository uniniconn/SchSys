import Link from 'next/link';
import { redirect } from 'next/navigation';
import LoginForm from './login-form';
import { getAdminSession } from '@/lib/session';

export const metadata = { title: '管理员登录 - 排班系统' };

export default async function AdminLoginPage() {
  const session = await getAdminSession();
  if (session) redirect('/admin/dashboard');

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <div className="card">
        <h1 className="card-title">排班系统 · 管理员登录</h1>
        <LoginForm />
        <p className="hint mt-4 border-t border-line pt-3">
          本系统仅提供管理员登录入口，普通用户无需注册账号；填写排班意愿请使用管理员发放的专属填写链接。
        </p>
        <p className="mt-2 text-xs text-ink-soft">
          忘记密码？请联系其他管理员在「管理员账号管理」中重置，或在服务器上执行{' '}
          <code className="border border-line px-1">npm run db:seed</code> 检查初始管理员。
        </p>
        <p className="mt-3 text-xs">
          <Link href="/fill">我有填写链接</Link>
        </p>
      </div>
    </main>
  );
}
