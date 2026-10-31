'use client';

import { useActionState } from 'react';
import CopyButton from '@/components/copy-button';
import { publishTaskAction, resetFillPasswordAction, type ActionState } from '../../task-actions';

export default function FillLinkPanel({
  taskId,
  publicToken,
  baseUrl,
  published,
  showPasswordBox,
}: {
  taskId: string;
  publicToken: string;
  baseUrl: string;
  published: boolean;
  showPasswordBox: boolean;
}) {
  const [publishState, publishAction, publishPending] = useActionState<ActionState, FormData>(publishTaskAction, {});
  const [resetState, resetAction, resetPending] = useActionState<ActionState, FormData>(resetFillPasswordAction, {});

  const url = `${baseUrl.replace(/\/+$/, '')}/fill/${publicToken}`;

  return (
    <div className="card">
      <div className="card-title">填写链接与密码</div>

      {publishState.error ? <div className="alert alert-error mb-2">{publishState.error}</div> : null}
      {publishState.ok ? <div className="alert alert-ok mb-2">{publishState.ok}</div> : null}
      {resetState.error ? <div className="alert alert-error mb-2">{resetState.error}</div> : null}
      {resetState.ok ? <div className="alert alert-ok mb-2">{resetState.ok}</div> : null}

      {showPasswordBox ? (
        <div className="alert alert-info mb-2">
          任务已创建。填写密码已使用你设置的密码；若你留空了密码，系统已自动生成——请点击下方「重置填写密码」获取一个新密码并复制告知填写人。
        </div>
      ) : null}

      <table className="table">
        <tbody>
          <tr>
            <th className="w-32">填写链接</th>
            <td>
              <div className="flex flex-wrap items-center gap-2">
                <code className="border border-line px-1 break-all">{url}</code>
                <CopyButton text={url} label="复制链接" />
                <a className="btn btn-sm" href={`/fill/${publicToken}`} target="_blank" rel="noreferrer">
                  打开
                </a>
              </div>
              <div className="hint mt-1">链接使用 UUID，不可被枚举猜测；转发给填写人即可。</div>
            </td>
          </tr>
          <tr>
            <th>发布状态</th>
            <td>{published ? <span className="badge badge-ok">已发布</span> : <span className="badge">草稿（未发布）</span>}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-3 flex flex-wrap items-start gap-4">
        <form action={publishAction} className="border border-line p-3">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="data-action" value="publish" />
          <p className="mb-2 text-sm font-bold">{published ? '重新发布 / 重设密码' : '发布任务'}</p>
          <label className="label" htmlFor="fillPassword">
            新的填写密码（可留空）
          </label>
          <input id="fillPassword" name="fillPassword" className="input max-w-xs" placeholder="留空则保持原密码" />
          <div className="mt-2">
            <button type="submit" className="btn btn-primary btn-sm" disabled={publishPending}>
              {publishPending ? '处理中…' : published ? '保存发布设置' : '发布并生成链接'}
            </button>
          </div>
        </form>

        <form action={resetAction} className="border border-line p-3">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="data-action" value="reset-fill-password" />
          <p className="mb-2 text-sm font-bold">重置填写密码</p>
          <label className="label" htmlFor="newFillPassword">
            自定义新密码（可留空自动生成）
          </label>
          <input id="newFillPassword" name="newFillPassword" className="input max-w-xs" placeholder="留空自动生成 8 位随机密码" />
          <div className="mt-2">
            <button type="submit" className="btn btn-sm" disabled={resetPending}>
              {resetPending ? '处理中…' : '重置密码'}
            </button>
          </div>
          <p className="hint mt-1">重置后旧密码立即失效，已进入的用户需要重新输入密码。</p>
        </form>
      </div>
    </div>
  );
}
