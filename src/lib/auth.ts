import { redirect } from 'next/navigation';
import { getAdminSession, type AdminSession } from '@/lib/session';

/** 页面级管理员校验：未登录跳转登录页 */
export async function requireAdminPage(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');
  return session;
}

/** API 级管理员校验：未登录返回 null，由调用方返回 401 */
export async function requireAdminApi(): Promise<AdminSession | null> {
  return getAdminSession();
}
