import { NextResponse } from 'next/server';
import { destroyAdminSession, getAdminSession, writeAuditLog } from '@/lib/session';

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (session) {
    await writeAuditLog({ adminId: session.adminId, action: 'admin.logout', req: request });
  }
  await destroyAdminSession();
  return NextResponse.redirect(new URL('/admin/login', request.url), { status: 303 });
}
