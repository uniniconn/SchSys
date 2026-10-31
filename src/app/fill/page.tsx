import Link from 'next/link';

export const metadata = { title: '填写入口' };

export default function FillIndexPage() {
  return (
    <main className="mx-auto max-w-lg p-6">
      <div className="card">
        <h1 className="card-title">排班意愿填写入口</h1>
        <p className="text-sm">
          请使用管理员发给你的专属填写链接（形如 <code className="border border-line px-1">/fill/xxxxxxxx-xxxx-...</code>
          ）打开页面，并输入对应的填写密码。
        </p>
        <p className="hint mt-3">本系统不需要注册或登录普通账号，链接与密码即身份凭证。</p>
        <p className="mt-4">
          <Link className="btn" href="/admin/login">
            我是管理员，去登录
          </Link>
        </p>
      </div>
    </main>
  );
}
