import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/password';
import { createAdminSession, writeAuditLog } from '@/lib/session';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { fail, ok } from '@/lib/http';

export async function POST(request: Request) {
  const ip = clientIp(request.headers);
  const limit = rateLimit(`admin-login:${ip}`, 10, 300);
  if (!limit.allowed) {
    return fail(`尝试过于频繁，请 ${limit.retryAfterSeconds} 秒后再试`, 429);
  }

  let body: { username?: string; password?: string };
  try {
    body = (await request.json()) as { username?: string; password?: string };
  } catch {
    return fail('请求格式错误');
  }

  const username = (body.username ?? '').trim();
  const password = body.password ?? '';
  if (!username || !password) return fail('请输入账号和密码');

  const admin = await prisma.admin.findUnique({ where: { username } });
  if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
    await writeAuditLog({ action: 'admin.login.failed', detail: `账号：${username}`, req: request });
    return fail('账号或密码错误', 401);
  }
  if (admin.status !== 'active') {
    return fail('该账号已被禁用，请联系超级管理员', 403);
  }

  await createAdminSession({ id: admin.id, username: admin.username, isSuper: admin.isSuper });
  await prisma.admin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
  await writeAuditLog({ adminId: admin.id, action: 'admin.login', detail: `账号：${username}`, req: request });

  return ok({ redirectTo: '/admin/dashboard' });
}

export async function GET() {
  return NextResponse.json({ ok: false, error: '请使用 POST 登录' }, { status: 405 });
}
