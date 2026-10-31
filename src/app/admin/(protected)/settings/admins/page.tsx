import AdminAccountsPanel from './admin-accounts-panel';
import { prisma } from '@/lib/prisma';
import { requireAdminPage } from '@/lib/auth';
import { formatDateTime } from '@/lib/date-utils';

export const metadata = { title: '管理员账号管理 - 排班系统' };

export default async function AdminAccountsPage() {
  const session = await requireAdminPage();

  const admins = await prisma.admin.findMany({ orderBy: { createdAt: 'asc' } });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">管理员账号管理</h1>
        <p className="hint">
          本系统只有管理员登录入口，不提供普通用户注册与登录。填写排班意愿的用户仅凭专属链接 + 填写密码进入，无需账号。
        </p>
      </div>

      <AdminAccountsPanel
        admins={admins.map((admin) => ({
          id: admin.id,
          username: admin.username,
          displayName: admin.displayName,
          status: admin.status,
          isSuper: admin.isSuper,
          lastLoginAt: admin.lastLoginAt ? formatDateTime(admin.lastLoginAt) : null,
          createdAt: formatDateTime(admin.createdAt),
          isSelf: admin.id === session.adminId,
        }))}
      />

      <div className="card">
        <div className="card-title">安全说明</div>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>管理员密码使用 scrypt 加盐哈希存储，数据库中不保存明文。</li>
          <li>管理员会话使用 HttpOnly Cookie + 签名令牌，服务端会校验账号状态（禁用后立即失效）。</li>
          <li>填写链接使用 UUID，无法被枚举；填写密码以哈希方式存储，可随时重置。</li>
          <li>启用 / 禁用、重置密码、解锁填写等敏感操作都会写入操作日志。</li>
        </ul>
      </div>
    </div>
  );
}
