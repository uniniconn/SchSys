// 首次启动 / 手动执行时的种子脚本：
// 1. 创建初始管理员（已存在则跳过，不会覆盖密码）
// 2. 支持通过 SEED_DEMO=1 生成演示任务与填写数据，便于本地体验
import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt as scryptCb, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const PARAMS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, 64, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

const prisma = new PrismaClient();

async function seedAdmin() {
  const username = (process.env.INITIAL_ADMIN_USERNAME || 'admin').trim();
  const password = process.env.INITIAL_ADMIN_PASSWORD || 'Admin@12345';
  const displayName = process.env.INITIAL_ADMIN_DISPLAY_NAME || '系统管理员';

  const existing = await prisma.admin.findUnique({ where: { username } });
  if (existing) {
    console.log(`ℹ️  管理员 ${username} 已存在，跳过创建`);
    return existing;
  }
  const admin = await prisma.admin.create({
    data: { username, passwordHash: await hashPassword(password), displayName, isSuper: true, status: 'active' },
  });
  console.log(`✅ 已创建初始管理员：${username}（密码：${password}）—— 登录后请立即修改密码`);
  return admin;
}

function dateStr(offsetDays) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function seedDemo(admin) {
  const existing = await prisma.task.findFirst({ where: { name: '演示任务：周末值班' } });
  if (existing) {
    console.log('ℹ️  演示任务已存在，跳过');
    return;
  }
  const start = dateStr(1);
  const end = dateStr(3);
  const dates = [start, dateStr(2), end];

  const task = await prisma.task.create({
    data: {
      name: '演示任务：周末值班',
      description: '演示数据，可直接删除。',
      dateStart: start,
      dateEnd: end,
      fillPasswordHash: await hashPassword('demo1234'),
      publicToken: randomUUID(),
      status: 'published',
      shifts: {
        create: [
          { name: '白班', startTime: '08:00', endTime: '16:00', defaultHeadcount: 2, sortOrder: 0 },
          { name: '夜班', startTime: '16:00', endTime: '23:59', defaultHeadcount: 1, sortOrder: 1 },
        ],
      },
    },
    include: { shifts: true },
  });

  for (const date of dates) {
    for (const shift of task.shifts) {
      await prisma.taskDayRequirement.create({
        data: { taskId: task.id, shiftId: shift.id, date, headcount: shift.defaultHeadcount },
      });
    }
  }

  const names = ['张三', '李四', '王五', '赵六', '钱七'];
  for (const [index, name] of names.entries()) {
    const submission = await prisma.submission.create({
      data: {
        taskId: task.id,
        name,
        nameKey: name.toLowerCase(),
        onRoster: false,
        status: 'submitted',
      },
    });
    for (const date of dates) {
      for (const [shiftIndex, shift] of task.shifts.entries()) {
        const seed = (index + shiftIndex + date.charCodeAt(9)) % 5;
        const choice = seed === 0 ? 'unavailable' : seed === 1 ? 'backup' : 'preferred';
        await prisma.selection.create({
          data: {
            submissionId: submission.id,
            taskId: task.id,
            shiftId: shift.id,
            date,
            choice,
            reason: choice === 'unavailable' ? '已有其他安排' : null,
          },
        });
      }
    }
  }

  console.log(`✅ 已创建演示任务，填写链接：/fill/${task.publicToken}  填写密码：demo1234`);
}

async function main() {
  const admin = await seedAdmin();
  if (process.env.SEED_DEMO === '1' && admin) await seedDemo(admin);
}

main()
  .catch((error) => {
    console.error('❌ 种子脚本失败：', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
