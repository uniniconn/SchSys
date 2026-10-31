import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ensureInitialized } from '@/lib/bootstrap';
import './globals.css';

export const metadata: Metadata = {
  title: '排班系统',
  description: '排班任务发布、意愿收集与自动匹配排班系统',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // 首次启动自动创建初始管理员（幂等）
  await ensureInitialized();

  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
