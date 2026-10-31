import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { signToken, verifyToken } from '@/lib/token';
import { clientIp } from '@/lib/rate-limit';

export const ADMIN_COOKIE = 'sched_admin';
export const FILL_COOKIE = 'sched_fill';

function adminTtlSeconds(): number {
  const hours = Number(process.env.SESSION_TTL_HOURS ?? 12);
  return (Number.isFinite(hours) && hours > 0 ? hours : 12) * 3600;
}

function fillTtlSeconds(): number {
  const hours = Number(process.env.FILL_SESSION_TTL_HOURS ?? 12);
  return (Number.isFinite(hours) && hours > 0 ? hours : 12) * 3600;
}

function cookieSecure(): boolean {
  return process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
}

export type AdminSession = { adminId: string; username: string; isSuper: boolean };

export type FillSession = { taskId: string; secret: string };

/* ------------------------------- 管理员会话 ------------------------------- */

export async function createAdminSession(admin: { id: string; username: string; isSuper: boolean }) {
  const token = signToken({ adminId: admin.id, username: admin.username, isSuper: admin.isSuper }, adminTtlSeconds());
  const store = await cookies();
  store.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    path: '/',
    maxAge: adminTtlSeconds(),
  });
}

export async function destroyAdminSession() {
  const store = await cookies();
  store.set(ADMIN_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: cookieSecure(), path: '/', maxAge: 0 });
}

/** 读取并校验管理员会话（会检查账号是否仍存在且未被禁用） */
export async function getAdminSession(): Promise<AdminSession | null> {
  const store = await cookies();
  const payload = verifyToken<AdminSession>(store.get(ADMIN_COOKIE)?.value);
  if (!payload?.adminId) return null;
  const admin = await prisma.admin.findUnique({
    where: { id: payload.adminId },
    select: { id: true, username: true, isSuper: true, status: true },
  });
  if (!admin || admin.status !== 'active') return null;
  return { adminId: admin.id, username: admin.username, isSuper: admin.isSuper };
}

/* ------------------------------- 填写端凭证 ------------------------------- */

export async function createFillSession(taskId: string, secret: string) {
  const token = signToken({ taskId, secret }, fillTtlSeconds());
  const store = await cookies();
  store.set(FILL_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    path: '/',
    maxAge: fillTtlSeconds(),
  });
}

export async function readFillSession(): Promise<FillSession | null> {
  const store = await cookies();
  const payload = verifyToken<FillSession>(store.get(FILL_COOKIE)?.value);
  if (!payload?.taskId || !payload.secret) return null;
  return { taskId: payload.taskId, secret: payload.secret };
}

/* --------------------------------- 审计日志 -------------------------------- */

export async function writeAuditLog(input: {
  adminId?: string | null;
  taskId?: string | null;
  action: string;
  detail?: string | null;
  req?: Request;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        adminId: input.adminId ?? null,
        taskId: input.taskId ?? null,
        action: input.action,
        detail: input.detail ?? null,
        ipAddress: input.req ? clientIp(input.req.headers) : null,
      },
    });
  } catch {
    // 审计日志失败不应阻断主流程
  }
}
