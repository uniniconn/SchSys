import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { findTaskByToken } from '@/lib/fill';

/** 填写端姓名回填：检查某姓名是否已提交过（用于提示“已提交，可再次修改”） */
export async function GET(_request: Request, context: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await context.params;
  const task = await findTaskByToken(uuid);
  if (!task) return NextResponse.json({ ok: false, error: '链接无效' }, { status: 404 });

  const submissions = await prisma.submission.findMany({
    where: { taskId: task.id },
    select: { name: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });

  return NextResponse.json({
    ok: true,
    count: submissions.length,
    names: submissions.map((submission) => submission.name),
  });
}
