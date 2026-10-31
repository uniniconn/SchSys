'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireAdminPage } from '@/lib/auth';
import { hashPassword, generateFillPassword, validatePasswordStrength } from '@/lib/password';
import { writeAuditLog } from '@/lib/session';
import { enumerateDates, isDateString, isTimeString, diffDays } from '@/lib/date-utils';

export type ActionState = { error?: string; ok?: string };

function readShifts(formData: FormData): Array<{ id: string; name: string; startTime: string; endTime: string; defaultHeadcount: number }> {
  const count = Number(formData.get('shiftCount') ?? 0);
  const shifts: Array<{ id: string; name: string; startTime: string; endTime: string; defaultHeadcount: number }> = [];
  // 表单使用位置下标命名（shiftName_0 / shiftName_1 …），与前端渲染顺序一致。
  // 只有当整行控件都不存在时才视为“结构不完整”，避免把只填了一半的行静默丢弃。
  for (let i = 0; i < count; i += 1) {
    const nameValue = formData.get(`shiftName_${i}`);
    const startValue = formData.get(`shiftStart_${i}`);
    const endValue = formData.get(`shiftEnd_${i}`);
    const headcountValue = formData.get(`shiftHeadcount_${i}`);

    if (nameValue === null && startValue === null && endValue === null && headcountValue === null) {
      throw new ShiftValidationError(`第 ${i + 1} 个班次的提交数据不完整，请刷新页面后重新填写`);
    }

    const name = String(nameValue ?? '').trim();
    const startTime = String(startValue ?? '').trim();
    const endTime = String(endValue ?? '').trim();
    const defaultHeadcount = Number(headcountValue ?? 1);
    if (!name && !startTime && !endTime) continue; // 完全空行忽略
    shifts.push({
      id: String(formData.get(`shiftId_${i}`) ?? `s${i}`),
      name,
      startTime,
      endTime,
      defaultHeadcount: Number.isFinite(defaultHeadcount) && defaultHeadcount > 0 ? Math.floor(defaultHeadcount) : 1,
    });
  }
  return shifts;
}

/** 表单结构不完整（与普通业务校验错误区分开，便于给出更准确的提示；'use server' 文件只能导出异步函数，故不导出） */
class ShiftValidationError extends Error {}

function validateShifts(shifts: Array<{ name: string; startTime: string; endTime: string; defaultHeadcount: number }>): string | null {
  if (shifts.length === 0) return '请至少添加一个班次（需要填写班次名称、开始与结束时间）';
  if (shifts.length > 20) return '班次数量不能超过 20 个';
  const names = new Set<string>();
  for (const shift of shifts) {
    if (!shift.name) return '班次名称不能为空';
    if (shift.name.length > 30) return `班次名称过长：${shift.name}`;
    if (names.has(shift.name)) return `班次名称重复：${shift.name}`;
    names.add(shift.name);
    if (!isTimeString(shift.startTime)) return `班次「${shift.name}」开始时间格式应为 HH:mm`;
    if (!isTimeString(shift.endTime)) return `班次「${shift.name}」结束时间格式应为 HH:mm`;
    if (shift.defaultHeadcount < 1 || shift.defaultHeadcount > 500) return `班次「${shift.name}」所需人数应在 1~500 之间`;
  }
  return null;
}

/** 创建排班任务（草稿） */
export async function createTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdminPage();

  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const dateStart = String(formData.get('dateStart') ?? '').trim();
  const dateEnd = String(formData.get('dateEnd') ?? '').trim();
  const deadlineRaw = String(formData.get('fillDeadline') ?? '').trim();
  const fillPassword = String(formData.get('fillPassword') ?? '').trim();
  const allowSameDayMultiple = formData.get('allowSameDayMultiple') === 'on';

  if (!name) return { error: '请填写任务名称' };
  if (name.length > 100) return { error: '任务名称不能超过 100 个字符' };
  if (!isDateString(dateStart) || !isDateString(dateEnd)) return { error: '请选择有效的任务日期范围' };
  if (dateStart > dateEnd) return { error: '开始日期不能晚于结束日期' };
  if (diffDays(dateStart, dateEnd) > 120) return { error: '日期范围不能超过 120 天' };

  const dates = enumerateDates(dateStart, dateEnd, 200);
  if (dates.length === 0) return { error: '任务日期范围无效' };

  let shifts: Array<{ id: string; name: string; startTime: string; endTime: string; defaultHeadcount: number }>;
  try {
    shifts = readShifts(formData);
  } catch (error) {
    if (error instanceof ShiftValidationError) return { error: error.message };
    return { error: '解析班次数据失败，请刷新页面后重试' };
  }
  const shiftError = validateShifts(shifts);
  if (shiftError) return { error: shiftError };

  if (fillPassword && fillPassword.length < 4) return { error: '填写密码至少 4 位' };

  const plainFillPassword = fillPassword || generateFillPassword();

  let fillDeadline: Date | null = null;
  if (deadlineRaw) {
    const parsed = new Date(deadlineRaw);
    if (Number.isNaN(parsed.getTime())) return { error: '填写截止时间格式不正确' };
    fillDeadline = parsed;
  }

  // 每日/每班次需求人数：优先读取矩阵值，缺省使用班次默认人数
  const requirementRows: Array<{ date: string; shiftIndex: number; headcount: number }> = [];
  for (let s = 0; s < shifts.length; s += 1) {
    for (const date of dates) {
      const raw = formData.get(`req_${s}_${date}`);
      const value = raw === null ? shifts[s].defaultHeadcount : Number(raw);
      const headcount = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : shifts[s].defaultHeadcount;
      requirementRows.push({ date, shiftIndex: s, headcount });
    }
  }

  const taskId = await prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        name,
        description: description || null,
        dateStart,
        dateEnd,
        fillDeadline,
        fillPasswordHash: await hashPassword(plainFillPassword),
        status: 'draft',
        allowSameDayMultiple,
      },
    });

    for (const [index, shift] of shifts.entries()) {
      const created = await tx.shift.create({
        data: {
          taskId: task.id,
          name: shift.name,
          startTime: shift.startTime,
          endTime: shift.endTime,
          defaultHeadcount: shift.defaultHeadcount,
          sortOrder: index,
        },
      });
      const rows = requirementRows.filter((row) => row.shiftIndex === index);
      if (rows.length > 0) {
        await tx.taskDayRequirement.createMany({
          data: rows.map((row) => ({ taskId: task.id, shiftId: created.id, date: row.date, headcount: row.headcount })),
        });
      }
    }

    return task.id;
  });

  await writeAuditLog({
    adminId: session.adminId,
    taskId,
    action: 'task.create',
    detail: `创建任务「${name}」（${dateStart} ~ ${dateEnd}，${shifts.length} 个班次）`,
  });

  // 创建后跳转详情页提示（填写密码不在 URL 中传递，避免写入浏览器历史与访问日志）
  redirect(`/admin/tasks/${taskId}?created=1`);
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

  await prisma.task.update({
    where: { id: taskId },
    data: { name, description: description || null, fillDeadline, allowSameDayMultiple },
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
