'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PasswordGateForm({ uuid, taskName }: { uuid: string; taskName: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/fill/${encodeURIComponent(uuid)}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; redirectTo?: string };
      if (!response.ok || !data.ok) {
        setError(data.error ?? '进入失败，请重试');
        setPending(false);
        return;
      }
      router.replace(data.redirectTo ?? `/fill/${uuid}/form`);
      router.refresh();
    } catch {
      setError('网络错误，请重试');
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {error ? <div className="alert alert-error">{error}</div> : null}
      <p className="text-sm">
        任务：<strong>{taskName}</strong>
      </p>
      <div>
        <label className="label" htmlFor="fillPassword">
          填写密码
        </label>
        <input
          id="fillPassword"
          className="input"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="请输入管理员提供的填写密码"
          autoComplete="off"
          required
        />
      </div>
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? '校验中…' : '进入填写'}
      </button>
    </form>
  );
}
