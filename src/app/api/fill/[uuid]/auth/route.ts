import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/password';
import { createFillSession } from '@/lib/session';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { fail, ok } from '@/lib/http';
import { findTaskByToken, fillSecret, fillLocked } from '@/lib/fill';

/** 用户输入任务密码，换取填写通行凭证（HttpOnly Cookie） */
export async function POST(request: Request, context: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await context.params;
  const ip = clientIp(request.headers);

  let body: { password?: string };
  try {
    body = (await request.json()) as { password?: string };
  } catch {
    return fail('请求格式错误');
  }
  const password = (body.password ?? '').trim();
  if (!password) return fail('请输入填写密码');

  const task = await findTaskByToken(uuid);
  if (!task) return fail('填写链接无效或已被删除', 404);

  const locked = fillLocked(task);
  // 已确认/超时也允许进入查看（只读），但不能提交

  // 密码尝试限流（按 IP + 任务）
  const attemptKey = `fill-pwd:${task.id}:${ip}`;
  const maxAttempts = Number(process.env.FILL_PASSWORD_MAX_ATTEMPTS ?? 10) || 10;
  const windowSeconds = Number(process.env.FILL_PASSWORD_WINDOW ?? 300) || 300;
  const attempt = rateLimit(attemptKey, maxAttempts, windowSeconds);
  if (!attempt.allowed) {
    return fail(`密码错误次数过多，请 ${attempt.retryAfterSeconds} 秒后再试`, 429);
  }

  const record = await prisma.task.findUnique({ where: { id: task.id }, select: { fillPasswordHash: true } });
  const valid = record ? await verifyPassword(password, record.fillPasswordHash) : false;
  if (!valid) {
    return fail('填写密码错误', 401, { remaining: attempt.remaining });
  }

  if (record) {
    await createFillSession(task.id, fillSecret(task.id, record.fillPasswordHash));
  }

  return ok({
    redirectTo: `/fill/${uuid}/form`,
    taskName: task.name,
    locked: locked.locked,
  });
}

export async function GET() {
  return NextResponse.json({ ok: false, error: '请使用 POST 校验密码' }, { status: 405 });
}
