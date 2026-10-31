'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireAdminPage } from '@/lib/auth';
import { writeAuditLog } from '@/lib/session';
import { parseRosterFile, parseRosterRows, normalizeName, type RosterRow } from '@/lib/roster';
import { parseCsv } from '@/lib/csv';
import type { ActionState } from '../../task-actions';

/** 上传名单（CSV / XLSX），支持替换或追加 */
export async function uploadRosterAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdminPage();
  const taskId = String(formData.get('taskId') ?? '');
  const mode = String(formData.get('mode') ?? 'replace');
  const text = String(formData.get('rosterText') ?? '').trim();
  const file = formData.get('file');

  if (!taskId) return { error: '缺少任务 ID' };
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true, name: true } });
  if (!task) return { error: '任务不存在' };

  let parsed: { entries: RosterRow[]; errors: string[] } | null = null;

  if (file instanceof File && file.size > 0) {
    if (file.size > 5 * 1024 * 1024) return { error: '文件过大（上限 5MB）' };
    const buffer = Buffer.from(await file.arrayBuffer());
    parsed = await parseRosterFile(file.name, buffer);
  } else if (text) {
    parsed = parseRosterRows(parseCsv(text));
  }

  if (!parsed) return { error: '请选择要上传的 CSV/XLSX 文件，或直接粘贴名单内容' };
  if (parsed.entries.length === 0) {
    return { error: parsed.errors.join('；') || '未解析到有效名单' };
  }

  const rows = parsed.entries.map((entry) => ({
    taskId,
    name: entry.name,
    empNo: entry.empNo ?? null,
    dept: entry.dept ?? null,
    nameKey: normalizeName(entry.name),
  }));

  // 去重（同一文件内重复姓名）
  const unique = new Map<string, (typeof rows)[number]>();
  for (const row of rows) unique.set(row.nameKey, row);
  const finalRows = [...unique.values()];

  await prisma.$transaction(async (tx) => {
    if (mode === 'replace') {
      await tx.rosterEntry.deleteMany({ where: { taskId } });
    }
    await tx.rosterEntry.deleteMany({ where: { taskId, nameKey: { in: finalRows.map((row) => row.nameKey) } } });
    await tx.rosterEntry.createMany({ data: finalRows });
    // 同步提交记录中的名单归属标记
    const submissionKeys = await tx.submission.findMany({ where: { taskId }, select: { id: true, nameKey: true } });
    const rosterKeys = new Set(finalRows.map((row) => row.nameKey));
    for (const submission of submissionKeys) {
      const onRoster = rosterKeys.has(submission.nameKey);
      await tx.submission.update({ where: { id: submission.id }, data: { onRoster } });
    }
  });

  await writeAuditLog({
    adminId: session.adminId,
    taskId,
    action: 'task.roster.upload',
    detail: `${mode === 'replace' ? '替换' : '追加'}名单 ${finalRows.length} 条${
      parsed.errors.length > 0 ? `（提示：${parsed.errors.slice(0, 3).join('；')}）` : ''
    }`,
  });

  revalidatePath(`/admin/tasks/${taskId}`);

  const warning = parsed.errors.length > 0 ? ` 提示：${parsed.errors.slice(0, 2).join('；')}` : '';
  return {
    ok: `${mode === 'replace' ? '已替换' : '已追加'}名单，共 ${finalRows.length} 人。${warning}`,
  };
}

/** 清空名单 */
export async function clearRosterAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdminPage();
  const taskId = String(formData.get('taskId') ?? '');
  if (!taskId) return { error: '缺少任务 ID' };

  await prisma.$transaction([
    prisma.rosterEntry.deleteMany({ where: { taskId } }),
    prisma.submission.updateMany({ where: { taskId }, data: { onRoster: false } }),
  ]);

  await writeAuditLog({ adminId: session.adminId, taskId, action: 'task.roster.clear', detail: '清空名单' });
  revalidatePath(`/admin/tasks/${taskId}`);
  return { ok: '名单已清空' };
}

/** 删除单条名单记录 */
export async function deleteRosterEntryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdminPage();
  const taskId = String(formData.get('taskId') ?? '');
  const entryId = String(formData.get('entryId') ?? '');
  if (!taskId || !entryId) return { error: '参数缺失' };

  const entry = await prisma.rosterEntry.findUnique({ where: { id: entryId } });
  if (!entry) return { error: '名单记录不存在' };

  await prisma.$transaction([
    prisma.rosterEntry.delete({ where: { id: entryId } }),
    prisma.submission.updateMany({ where: { taskId, nameKey: entry.nameKey }, data: { onRoster: false } }),
  ]);

  await writeAuditLog({ adminId: session.adminId, taskId, action: 'task.roster.delete', detail: `删除名单：${entry.name}` });
  revalidatePath(`/admin/tasks/${taskId}`);
  return { ok: `已从名单中删除：${entry.name}` };
}
