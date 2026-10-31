import { redirect } from 'next/navigation';

/** 站点根路径：不做任何前台展示，直接跳转管理员登录（前台无普通用户入口） */
export default function HomePage() {
  redirect('/admin/login');
}
