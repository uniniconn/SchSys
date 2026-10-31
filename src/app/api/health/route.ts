import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/** 健康检查（供 Docker HEALTHCHECK / 负载均衡探针使用） */
export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    return NextResponse.json({
      ok: true,
      status: 'healthy',
      database: 'up',
      latencyMs: Date.now() - startedAt,
      time: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        status: 'degraded',
        database: 'down',
        error: (error as Error).message,
        time: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
