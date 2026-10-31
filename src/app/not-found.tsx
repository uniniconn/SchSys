import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <div className="card">
        <h1 className="card-title">页面不存在</h1>
        <p className="text-sm text-ink-soft">
          请确认填写链接是否完整（链接中包含一长串唯一标识），或联系排班管理员重新获取链接。
        </p>
        <p className="mt-4">
          <Link className="btn" href="/admin/login">
            管理员登录
          </Link>
        </p>
      </div>
    </main>
  );
}
