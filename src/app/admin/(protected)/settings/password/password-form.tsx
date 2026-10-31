'use client';

import { useActionState } from 'react';
import { changeOwnPasswordAction } from '../admin-actions';
import type { ActionState } from '../../task-actions';

export default function PasswordForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(changeOwnPasswordAction, {});

  return (
    <form action={action} className="space-y-3">
      {state.error ? <div className="alert alert-error">{state.error}</div> : null}
      {state.ok ? <div className="alert alert-ok">{state.ok}</div> : null}
      <div>
        <label className="label" htmlFor="currentPassword">
          当前密码 <span className="text-danger">*</span>
        </label>
        <input id="currentPassword" name="currentPassword" type="password" className="input max-w-sm" required />
      </div>
      <div>
        <label className="label" htmlFor="newPassword">
          新密码 <span className="text-danger">*</span>
        </label>
        <input id="newPassword" name="newPassword" type="password" className="input max-w-sm" required />
        <p className="hint mt-1">至少 8 位，且包含字母、数字、符号中的至少两类。</p>
      </div>
      <div>
        <label className="label" htmlFor="confirmPassword">
          确认新密码 <span className="text-danger">*</span>
        </label>
        <input id="confirmPassword" name="confirmPassword" type="password" className="input max-w-sm" required />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? '提交中…' : '修改密码'}
      </button>
    </form>
  );
}
