import CalendarSettings from './calendar-settings';
import { requireAdminPage } from '@/lib/auth';

export const metadata = { title: '节假日日历 - 排班系统' };

export default async function CalendarPage() {
  await requireAdminPage();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">节假日日历</h1>
        <p className="hint">
          用于生成排班日期：默认从公共接口同步节假日与调休，可在此自定义覆盖；自定义优先级最高，并会写入任务创建时的快照。
        </p>
      </div>
      <CalendarSettings />
    </div>
  );
}
