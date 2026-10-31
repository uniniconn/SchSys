'use client';

import { useActionState } from 'react';
import { createAdminAction, resetAdminPasswordAction, toggleAdminStatusAction } from '../admin-actions';
import type { ActionState } from '../../task-actions';
import ConfirmSubmit from '@/components/confirm-submit';
import Collapsible from '@/components/collapsible';

type AdminRow = {
  id: string;
  username: string;
  displayName: string | null;
  status: string;
  isSuper: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  isSelf: boolean;
};

export default function AdminAccountsPanel({ admins }: { admins: AdminRow[] }) {
  const [createState, createAction, createPending] = useActionState<ActionState, FormData>(createAdminAction, {});
  const [toggleState, toggleAction] = useActionState<ActionState, FormData>(toggleAdminStatusAction, {});
  const [resetState, resetAction, resetPending] = useActionState<ActionState, FormData>(resetAdminPasswordAction, {});

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-title">新增管理员账号</div>
        {createState.error ? <div className="alert alert-error mb-2">{createState.error}</div> : null}
        {createState.ok ? <div className="alert alert-ok mb-2">{createState.ok}</div> : null}
        <form action={createAction} className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="label" htmlFor="username">
              登录账号 <span className="text-danger">*</span>
            </label>
            <input id="username" name="username" className="input" placeholder="如 zhangsan" required />
          </div>
          <div>
            <label className="label" htmlFor="displayName">
              显示名称
            </label>
            <input id="displayName" name="displayName" className="input" placeholder="如 张管理员" />
          </div>
          <div>
            <label className="label" htmlFor="password">
              初始密码 <span className="text-danger">*</span>
            </label>
            <input id="password" name="password" className="input" placeholder="至少 8 位，含两类字符" required />
          </div>
          <div className="md:col-span-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isSuper" />
              设为超级管理员（可管理其他管理员账号）
            </label>
          </div>
          <div className="md:col-span-3">
            <button type="submit" className="btn btn-primary" disabled={createPending}>
              {createPending ? '创建中…' : '新增管理员'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="card-title">管理员列表（{admins.length}）</div>
        {toggleState.error ? <div className="alert alert-error mb-2">{toggleState.error}</div> : null}
        {toggleState.ok ? <div className="alert alert-ok mb-2">{toggleState.ok}</div> : null}
        {resetState.error ? <div className="alert alert-error mb-2">{resetState.error}</div> : null}
        {resetState.ok ? <div className="alert alert-ok mb-2">{resetState.ok}</div> : null}

        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th className="nowrap">账号</th>
                <th className="nowrap">显示名称</th>
                <th className="nowrap">状态</th>
                <th className="nowrap">权限</th>
                <th className="nowrap">最近登录</th>
                <th className="nowrap">创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((admin) => (
                <tr key={admin.id}>
                  <td className="nowrap font-medium">
                    {admin.username}
                    {admin.isSelf ? <span className="hint ml-1">（当前登录）</span> : null}
                  </td>
                  <td className="nowrap">{admin.displayName ?? '-'}</td>
                  <td className="nowrap">
                    {admin.status === 'active' ? <span className="badge badge-ok">启用</span> : <span className="badge badge-danger">已禁用</span>}
                  </td>
                  <td className="nowrap">{admin.isSuper ? '超级管理员' : '普通管理员'}</td>
                  <td className="nowrap">{admin.lastLoginAt ?? '-'}</td>
                  <td className="nowrap">{admin.createdAt}</td>
                  <td>
                    <div className="flex flex-wrap items-start gap-2">
                      <form action={toggleAction}>
                        <input type="hidden" name="adminId" value={admin.id} />
                        <ConfirmSubmit
                          className="btn btn-sm"
                          message={admin.status === 'active' ? `确定禁用「${admin.username}」吗？该账号将无法登录。` : `确定启用「${admin.username}」吗？`}
                        >
                          {admin.status === 'active' ? '禁用' : '启用'}
                        </ConfirmSubmit>
                      </form>
                      <Collapsible title="重置密码">
                        <form action={resetAction} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="adminId" value={admin.id} />
                          <div>
                            <label className="label" htmlFor={`newPassword-${admin.id}`}>
                              新密码
                            </label>
                            <input
                              id={`newPassword-${admin.id}`}
                              name="newPassword"
                              className="input max-w-[200px]"
                              placeholder="至少 8 位，含两类字符"
                              required
                            />
                          </div>
                          <ConfirmSubmit className="btn btn-primary btn-sm" message={`确定重置「${admin.username}」的密码吗？`}>
                            {resetPending ? '重置中…' : '确认重置'}
                          </ConfirmSubmit>
                        </form>
                        <p className="hint mt-1">重置后请通过安全渠道告知对方，并要求其登录后立即修改密码。</p>
                      </Collapsible>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
