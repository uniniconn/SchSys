'use client';

import { useActionState } from 'react';
import { uploadRosterAction, clearRosterAction } from './roster-actions';
import type { ActionState } from '../../task-actions';
import ConfirmSubmit from '@/components/confirm-submit';

export default function RosterPanel({
  taskId,
  rosterCount,
}: {
  taskId: string;
  rosterCount: number;
}) {
  const [uploadState, uploadAction, uploadPending] = useActionState<ActionState, FormData>(uploadRosterAction, {});
  const [clearState, clearAction, clearPending] = useActionState<ActionState, FormData>(clearRosterAction, {});

  return (
    <div className="card">
      <div className="card-title">名单核对（上传名单 / 模板下载 / 导出未填写）</div>

      {uploadState.error ? <div className="alert alert-error mb-2">{uploadState.error}</div> : null}
      {uploadState.ok ? <div className="alert alert-ok mb-2">{uploadState.ok}</div> : null}
      {clearState.error ? <div className="alert alert-error mb-2">{clearState.error}</div> : null}
      {clearState.ok ? <div className="alert alert-ok mb-2">{clearState.ok}</div> : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm">
          当前名单人数：<strong>{rosterCount}</strong>
        </span>
        <a className="btn btn-sm" href={`/api/admin/tasks/${taskId}/roster/template?format=csv`}>
          下载名单模板 (CSV)
        </a>
        <a className="btn btn-sm" href={`/api/admin/tasks/${taskId}/roster/template?format=xlsx`}>
          下载名单模板 (XLSX)
        </a>
        {rosterCount > 0 ? (
          <>
            <a className="btn btn-sm" href={`/api/admin/tasks/${taskId}/roster/unfilled?format=csv`}>
              导出未填写名单 (CSV)
            </a>
            <a className="btn btn-sm" href={`/api/admin/tasks/${taskId}/roster/unfilled?format=xlsx`}>
              导出未填写名单 (XLSX)
            </a>
          </>
        ) : null}
      </div>

      <form action={uploadAction} className="space-y-2 border border-line p-3">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="data-action" value="upload-roster" />
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="file">
              上传名单文件（CSV / XLSX）
            </label>
            <input id="file" name="file" type="file" accept=".csv,.xlsx,text/csv" className="input" />
            <p className="hint mt-1">
              固定格式：第一行表头，至少包含「姓名」列，可选「工号」「部门」列。可先下载模板再填写。
            </p>
          </div>
          <div>
            <label className="label" htmlFor="rosterText">
              或直接粘贴名单（每行一个姓名，支持 CSV 列）
            </label>
            <textarea
              id="rosterText"
              name="rosterText"
              className="input h-24"
              placeholder={'姓名,工号,部门\n张三,A001,内科\n李四,A002,外科'}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-1 text-sm">
            <input type="radio" name="mode" value="replace" defaultChecked /> 替换现有名单
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input type="radio" name="mode" value="append" /> 追加到现有名单
          </label>
          <button type="submit" className="btn btn-primary btn-sm" disabled={uploadPending}>
            {uploadPending ? '上传中…' : '上传并核对'}
          </button>
        </div>
      </form>

      {rosterCount > 0 ? (
        <form action={clearAction} className="mt-2">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="data-action" value="clear-roster" />
          <ConfirmSubmit className="btn btn-danger btn-sm" message="确定清空该任务的名单吗？（不影响已提交的填写内容）">
            {clearPending ? '处理中…' : '清空名单'}
          </ConfirmSubmit>
        </form>
      ) : null}

      <p className="hint mt-2">
        上传名单后，系统会自动标出未填写人员，并把不在名单内的提交标记为「名单外提交」。
      </p>
    </div>
  );
}
