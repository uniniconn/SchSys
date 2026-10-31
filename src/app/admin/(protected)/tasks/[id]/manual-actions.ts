'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminPage } from '@/lib/auth';
import {
  addManualAssignment,
  clearManualAssignments,
  removeAssignment,
  updateAssignmentNote,
} from '@/lib/manual-adjust';
import type { ActionState } from '../../task-actions';

export type ManualAdjustState = ActionState & { warning?: string; assignmentId?: string };

function touchTask(taskId: string) {
  revalidatePath(`/admin/tasks/${taskId}`);
  revalidatePath(`/admin/tasks/${taskId}/result`);
  revalidatePath('/admin/dashboard');
}

/** 手动添加人员到某个「日期 + 班次」 */
export async function addManualAssignmentAction(_prev: ActionState, formData: FormData): Promise<ManualAdjustState> {
  const session = await requireAdminPage();
  const taskId = String(formData.get('taskId') ?? '').trim();
  const result = await addManualAssignment({
    taskId,
    date: String(formData.get('date') ?? '').trim(),
    shiftId: String(formData.get('shiftId') ?? '').trim(),
    submissionId: String(formData.get('submissionId') ?? '').trim(),
    note: String(formData.get('note') ?? ''),
    adminId: session.adminId,
  });
  touchTask(taskId);
  return { ok: result.ok, error: result.error, warning: result.warning, assignmentId: result.assignmentId };
}

/** 移除某条排班记录（自动匹配或手动添加的都可以移除） */
export async function removeAssignmentAction(_prev: ActionState, formData: FormData): Promise<ManualAdjustState> {
  const session = await requireAdminPage();
  const taskId = String(formData.get('taskId') ?? '').trim();
  const result = await removeAssignment({
    taskId,
    assignmentId: String(formData.get('assignmentId') ?? '').trim(),
    adminId: session.adminId,
  });
  touchTask(taskId);
  return { ok: result.ok, error: result.error };
}

/** 修改某条排班记录的调整说明 */
export async function updateAssignmentNoteAction(_prev: ActionState, formData: FormData): Promise<ManualAdjustState> {
  const session = await requireAdminPage();
  const taskId = String(formData.get('taskId') ?? '').trim();
  const result = await updateAssignmentNote({
    taskId,
    assignmentId: String(formData.get('assignmentId') ?? '').trim(),
    note: String(formData.get('note') ?? ''),
    adminId: session.adminId,
  });
  touchTask(taskId);
  return { ok: result.ok, error: result.error };
}

/** 清空全部手动添加的记录（保留自动匹配结果） */
export async function clearManualAssignmentsAction(_prev: ActionState, formData: FormData): Promise<ManualAdjustState> {
  const session = await requireAdminPage();
  const taskId = String(formData.get('taskId') ?? '').trim();
  const result = await clearManualAssignments({ taskId, adminId: session.adminId });
  touchTask(taskId);
  return { ok: result.ok, error: result.error };
}
