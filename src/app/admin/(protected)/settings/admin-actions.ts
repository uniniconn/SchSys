'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireAdminPage } from '@/lib/auth';
import { hashPassword, validatePasswordStrength, verifyPassword } from '@/lib/password';
import { writeAuditLog } from '@/lib/session';
import type { ActionState } from '../task-actions';

/** 修改自己的密码（需验证当前密码） */
export async function changeOwnPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdminPage();
  const current = String(formData.get('currentPassword') ?? '');
  const next = String(formData.get('newPassword') ?? '');
  const confirm = String(formData.get('confirmPassword') ?? '');

  if (!current || !next) return { error: '请填写当前密码与新密码' };
  if (next !== confirm) return { error: '两次输入的新密码不一致' };

  const strength = validatePasswordStrength(next);
  if (strength) return { error: strength };

  const admin = await prisma.admin.findUnique({ where: { id: session.adminId } });
  if (!admin) return { error: '账号不存在' };
  if (!(await verifyPassword(current, admin.passwordHash))) return { error: '当前密码不正确' };
  if (await verifyPassword(next, admin.passwordHash)) return { error: '新密码不能与当前密码相同' };

  await prisma.admin.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(next) } });
  await writeAuditLog({ adminId: admin.id, action: 'admin.password.change', detail: '修改本人密码' });

  revalidatePath('/admin/settings/password');
  return { ok: '密码已修改，请使用新密码重新登录（下次登录生效）。' };
}

/** 新增管理员账号 */
export async function createAdminAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdminPage();
  const username = String(formData.get('username') ?? '').trim();
  const displayName = String(formData.get('displayName') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const isSuper = formData.get('isSuper') === 'on';

  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    return { error: '账号需为 3~32 位字母、数字、下划线、点或短横线' };
  }
  const strength = validatePasswordStrength(password);
  if (strength) return { error: strength };

  const existing = await prisma.admin.findUnique({ where: { username } });
  if (existing) return { error: `账号已存在：${username}` };

  const admin = await prisma.admin.create({
    data: {
      username,
      passwordHash: await hashPassword(password),
      displayName: displayName || null,
      status: 'active',
      isSuper,
    },
  });

  await writeAuditLog({
    adminId: session.adminId,
    action: 'admin.create',
    detail: `新增管理员：${username}${isSuper ? '（超级管理员）' : ''}`,
  });

  revalidatePath('/admin/settings/admins');
  return { ok: `已新增管理员：${username}` , };
}

/** 启用 / 禁用管理员 */
export async function toggleAdminStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdminPage();
  const adminId = String(formData.get('adminId') ?? '');
  if (!adminId) return { error: '缺少管理员 ID' };
  if (adminId === session.adminId) return { error: '不能禁用自己的账号' };

  const admin = await prisma.admin.findUnique({ where: { id: adminId } });
  if (!admin) return { error: '账号不存在' };

  const nextStatus = admin.status === 'active' ? 'disabled' : 'active';
  await prisma.admin.update({ where: { id: adminId }, data: { status: nextStatus } });
  await writeAuditLog({
    adminId: session.adminId,
    action: nextStatus === 'active' ? 'admin.enable' : 'admin.disable',
    detail: `${nextStatus === 'active' ? '启用' : '禁用'}管理员：${admin.username}`,
  });

  revalidatePath('/admin/settings/admins');
  return { ok: `已${nextStatus === 'active' ? '启用' : '禁用'}：${admin.username}` };
}

/** 重置其他管理员密码 */
export async function resetAdminPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdminPage();
  const adminId = String(formData.get('adminId') ?? '');
  const newPassword = String(formData.get('newPassword') ?? '');
  if (!adminId) return { error: '缺少管理员 ID' };

  const strength = validatePasswordStrength(newPassword);
  if (strength) return { error: strength };

  const admin = await prisma.admin.findUnique({ where: { id: adminId } });
  if (!admin) return { error: '账号不存在' };

  await prisma.admin.update({ where: { id: adminId }, data: { passwordHash: await hashPassword(newPassword) } });
  await writeAuditLog({
    adminId: session.adminId,
    action: 'admin.password.reset',
    detail: `重置管理员密码：${admin.username}`,
  });

  revalidatePath('/admin/settings/admins');
  return { ok: `已重置 ${admin.username} 的密码` };
}
