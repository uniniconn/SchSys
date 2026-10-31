'use client';

import { useActionState } from 'react';
import { deleteRosterEntryAction } from './roster-actions';
import type { ActionState } from '../../task-actions';
import ConfirmSubmit from '@/components/confirm-submit';

/** 名单单条删除按钮（在服务端渲染的表格中使用） */
export default function RosterDeleteButton({ taskId, entryId, name }: { taskId: string; entryId: string; name: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(deleteRosterEntryAction, {});

  return (
    <form action={action}>
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="entryId" value={entryId} />
      <input type="hidden" name="data-action" value="delete-roster-entry" />
      <ConfirmSubmit className="btn btn-danger btn-sm" message={`确定把「${name}」从名单中删除吗？`}>
        {pending ? '删除中…' : '删除'}
      </ConfirmSubmit>
      {state.error ? <span className="hint text-danger">{state.error}</span> : null}
    </form>
  );
}
