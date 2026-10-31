import PasswordForm from './password-form';
import { requireAdminPage } from '@/lib/auth';

export const metadata = { title: '修改密码 - 排班系统' };

export default async function PasswordPage() {
  const session = await requireAdminPage();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">修改密码</h1>
        <p className="hint">当前账号：{session.username}。首次登录后请立即修改初始密码。</p>
      </div>
      <div className="card max-w-xl">
        <PasswordForm />
        <p className="hint mt-3 border-t border-line pt-3">
          修改成功后当前会话仍然有效；如需强制所有人重新登录，可在服务器上更换 SESSION_SECRET 后重启服务（会使所有会话立即失效）。
        </p>
      </div>
    </div>
  );
}
