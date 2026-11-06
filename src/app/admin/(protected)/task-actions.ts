'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireAdminPage } from '@/lib/auth';
import { hashPassword, generateFillPassword } from '@/lib/password';
import { writeAuditLog } from '@/lib/session';
import { isDateString, diffDays } from '@/lib/date-utils';
import { normalizeDraft, generateRequirements } from '@/lib/task-draft';
import { buildCalendarSnapshot } from '@/lib/calendar-service';
import { serializeDateRule } from '@/lib/schedule-rules';

export type ActionState = { error?: string; ok?: string };

/** 创建排班任务：接收向导提交的 TaskDraft JSON，服务端权威生成需求 */
export async function createTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdminPage();
  const raw = String(formData.get('draft') ?? '').trim();
  if (!raw) return { error: '缺少任务草稿数据，请刷新页面后重试' };
  if (raw.length > 1024 * 1024) return { error: '任务配置过大，请减少日期/班次/区域数量' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: '任务草稿格式错误，请刷新页面后重试' };
  }

  const { draft, errors } = normalizeDraft(parsed);
  if (errors.length > 0) return { error: errors.slice(0, 6).join('；') };

  const years = [...new Set([Number(draft.dateStart.slice(0, 4)), Number(draft.dateEnd.slice(0, 4))])];
  const snapshot = await buildCalendarSnapshot(years, {
    weekend: draft.weekend,
    manualEntries: draft.calendar?.manualEntries,
    useApi: draft.calendar?.useApi !== false,
  });

  const generated = generateRequirements(draft, snapshot.allEntries);
  if (generated.rows.length === 0) {
    return { error: generated.warnings[0] ?? '按当前日期规则没有生成任何排班需求，请调整日期或规则' };
  }

  const plainFillPassword = draft.fillPassword || generateFillPassword();
  const fillDeadline = draft.fillDeadline ? new Date(draft.fillDeadline) : null;
  if (fillDeadline && Number.isNaN(fillDeadline.getTime())) return { error: '填写截止时间格式不正确' };

  const taskId = await prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        name: draft.name,
        description: draft.description || null,
        dateStart: draft.dateStart,
        dateEnd: draft.dateEnd,
        fillDeadline,
        fillPasswordHash: await hashPassword(plainFillPassword),
        status: 'draft',
        allowSameDayMultiple: draft.allowSameDayMultiple,
        areaCoverage: draft.areaCoverage,
        maxAreasPerPerson: draft.maxAreasPerPerson,
        lessDefaultMax: draft.lessDefaultMax ?? null,
        calendarConfig: snapshot.json,
      },
    });

    for (const [shiftIndex, shift] of draft.shifts.entries()) {
      const defaultHeadcount = Math.max(1, ...shift.areas.map((area) => area.defaultHeadcount));
      const createdShift = await tx.shift.create({
        data: {
          taskId: task.id,
          name: shift.name,
          startTime: shift.startTime,
          endTime: shift.endTime,
          defaultHeadcount,
          sortOrder: shiftIndex,
          dateRule: serializeDateRule(shift.dateRule),
        },
      });
      for (const [areaIndex, area] of shift.areas.entries()) {
        const createdArea = await tx.area.create({
          data: {
            taskId: task.id,
            shiftId: createdShift.id,
            name: area.name,
            groupName: area.groupName,
            defaultHeadcount: area.defaultHeadcount,
            sortOrder: areaIndex,
          },
        });
        const rows = generated.rows.filter(
          (row) => row.shiftIndex === shiftIndex && row.areaIndex === areaIndex,
        );
        if (rows.length > 0) {
          await tx.taskDayRequirement.createMany({
            data: rows.map((row) => ({
              taskId: task.id,
              shiftId: createdShift.id,
              areaId: createdArea.id,
              date: row.date,
              headcount: row.headcount,
            })),
          });
        }
      }
    }

    return task.id;
  });

  await writeAuditLog({
    adminId: session.adminId,
    taskId,
    action: 'task.create',
    detail: `创建任务「${draft.name}」（${draft.dateStart} ~ ${draft.dateEnd}，${draft.shifts.length} 个班次，${generated.summary.areas} 个区域，需求 ${generated.summary.totalRequired} 人次；日历来源 ${snapshot.calendar.map((item) => item.provider).join('/')}）`,
  });

  redirect(`/admin/tasks/${taskId}?created=1`);
}

/** 供普通 <form action> 使用的包装（向导里用 useActionState，新手引导用这个） */
export async function createTaskFromDraftAction(formData: FormData): Promise<void> {
  await createTaskAction({}, formData);
}

/** 更新任务基础信息 */
export async function updateTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdminPage();
  const taskId = String(formData.get('taskId') ?? '');
  if (!taskId) return { error: '缺少任务 ID' };

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return { error: '任务不存在' };

  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const deadlineRaw = String(formData.get('fillDeadline') ?? '').trim();
  const allowSameDayMultiple = formData.get('allowSameDayMultiple') === 'on';

  if (!name) return { error: '请填写任务名称' };
  let fillDeadline: Date | null = null;
  if (deadlineRaw) {
    const parsed = new Date(deadlineRaw);
    if (Number.isNaN(parsed.getTime())) return { error: '填写截止时间格式不正确' };
    fillDeadline = parsed;
  }

  const areaCoverage = formData.get('areaCoverage') === 'exclusive' ? 'exclusive' : 'shared';
  const maxAreasRaw = Number(formData.get('maxAreasPerPerson') ?? 2);
  const maxAreasPerPerson = Number.isFinite(maxAreasRaw) ? Math.min(10, Math.max(1, Math.floor(maxAreasRaw))) : 2;
  const lessMaxRaw = String(formData.get('lessDefaultMax') ?? '').trim();
  const lessDefaultMax = lessMaxRaw ? Math.max(0, Math.min(365, Math.floor(Number(lessMaxRaw)))) : null;

  await prisma.task.update({
    where: { id: taskId },
    data: {
      name,
      description: description || null,
      fillDeadline,
      allowSameDayMultiple,
      areaCoverage,
      maxAreasPerPerson,
      lessDefaultMax: Number.isNaN(lessDefaultMax as number) ? null : lessDefaultMax,
    },
  });

  await writeAuditLog({
    adminId: session.adminId,
    taskId,
    action: 'task.update',
    detail: `更新任务信息：${name}`,
  });

  revalidatePath(`/admin/tasks/${taskId}`);
  return { ok: '任务信息已保存' };
}

/** 发布任务（生成填写链接 UUID + 设置填写密码） */
export async function publishTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdminPage();
  const taskId = String(formData.get('taskId') ?? '');
  const newPassword = String(formData.get('fillPassword') ?? '').trim();
  if (!taskId) return { error: '缺少任务 ID' };

  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { _count: { select: { shifts: true } } } });
  if (!task) return { error: '任务不存在' };
  if (task._count.shifts === 0) return { error: '请先为任务添加班次' };
  if (newPassword && newPassword.length < 4) return { error: '填写密码至少 4 位' };

  // publicToken 默认为 UUID，确保唯一且不可枚举
  const token = task.publicToken || crypto.randomUUID();

  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: task.status === 'draft' ? 'published' : task.status,
      publicToken: token,
      ...(newPassword ? { fillPasswordHash: await hashPassword(newPassword) } : {}),
    },
  });

  await writeAuditLog({
    adminId: session.adminId,
    taskId,
    action: 'task.publish',
    detail: newPassword ? '发布任务并重设填写密码' : '发布任务',
  });

  revalidatePath(`/admin/tasks/${taskId}`);
  return { ok: newPassword ? `已发布，填写密码已更新为：${newPassword}` : '任务已发布，填写链接已生成' };
}

/** 重置填写密码 */
export async function resetFillPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdminPage();
  const taskId = String(formData.get('taskId') ?? '');
  const custom = String(formData.get('newFillPassword') ?? '').trim();
  if (!taskId) return { error: '缺少任务 ID' };
  if (custom && custom.length < 4) return { error: '填写密码至少 4 位' };

  const plain = custom || generateFillPassword();
  await prisma.task.update({ where: { id: taskId }, data: { fillPasswordHash: await hashPassword(plain) } });
  await writeAuditLog({ adminId: session.adminId, taskId, action: 'task.fill_password.reset', detail: '重置填写密码' });

  revalidatePath(`/admin/tasks/${taskId}`);
  return { ok: `填写密码已重置为：${plain}（请立即复制并告知填写人）` };
}
