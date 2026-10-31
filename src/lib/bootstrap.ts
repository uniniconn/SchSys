import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { hashPassword } from './password-core';

/**
 * 应用启动时的初始化：
 *  - 首次启动自动创建初始管理员（INITIAL_ADMIN_USERNAME / INITIAL_ADMIN_PASSWORD）
 *  - 通过 globalThis 缓存，避免开发模式热重载重复执行
 */
const globalForInit = globalThis as unknown as { __schedInit?: Promise<void> };

async function runInit(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const username = (process.env.INITIAL_ADMIN_USERNAME || 'admin').trim();
    const password = process.env.INITIAL_ADMIN_PASSWORD || 'Admin@12345';
    const displayName = process.env.INITIAL_ADMIN_DISPLAY_NAME || '系统管理员';

    const existing = await prisma.admin.findUnique({ where: { username } });
    if (!existing) {
      await prisma.admin.create({
        data: {
          id: randomUUID(),
          username,
          passwordHash: await hashPassword(password),
          displayName,
          isSuper: true,
          status: 'active',
        },
      });
      // 使用 console.warn 以便在 Docker 日志中清晰可见
      console.warn(`[init] 已创建初始管理员账号：${username}（请登录后立即修改密码）`);
    }
  } catch (error) {
    console.error('[init] 初始化管理员失败：', (error as Error).message);
  } finally {
    await prisma.$disconnect();
  }
}

/** 幂等初始化，重复调用只执行一次 */
export function ensureInitialized(): Promise<void> {
  if (!globalForInit.__schedInit) {
    globalForInit.__schedInit = runInit();
  }
  return globalForInit.__schedInit;
}
