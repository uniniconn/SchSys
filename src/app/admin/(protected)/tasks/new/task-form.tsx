'use client';

import { useMemo, useState } from 'react';
import { useActionState } from 'react';
import { createTaskAction, type ActionState } from '../../task-actions';

type ShiftRow = {
  key: number;
  name: string;
  startTime: string;
  endTime: string;
  headcount: number;
};

type Props = {
  defaultStart: string;
  defaultEnd: string;
  defaultDeadline: string;
};

function enumerateDates(start: string, end: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return [];
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  let guard = 0;
  while (cursor <= last && guard < 200) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }
  return out;
}

function weekday(date: string): string {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${date}T00:00:00Z`).getUTCDay()] ?? '';
}

export default function TaskForm({ defaultStart, defaultEnd, defaultDeadline }: Props) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(createTaskAction, {});

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dateStart, setDateStart] = useState(defaultStart);
  const [dateEnd, setDateEnd] = useState(defaultEnd);
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [fillPassword, setFillPassword] = useState('');
  const [allowSameDayMultiple, setAllowSameDayMultiple] = useState(false);
  const [shifts, setShifts] = useState<ShiftRow[]>([
    { key: 1, name: '白班', startTime: '08:00', endTime: '16:00', headcount: 2 },
    { key: 2, name: '夜班', startTime: '16:00', endTime: '23:59', headcount: 1 },
  ]);
  const [nextKey, setNextKey] = useState(3);
  /** 每个班次在各日期的需求人数覆盖值：key = `${shiftKey}|${date}` */
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const dates = useMemo(() => enumerateDates(dateStart, dateEnd), [dateStart, dateEnd]);

  const updateShift = (key: number, patch: Partial<ShiftRow>) => {
    setShifts((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const removeShift = (key: number) => {
    setShifts((rows) => rows.filter((row) => row.key !== key));
    setOverrides((current) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(current)) {
        if (!k.startsWith(`${key}|`)) next[k] = v;
      }
      return next;
    });
  };

  const addShift = () => {
    setShifts((rows) => [...rows, { key: nextKey, name: '', startTime: '08:00', endTime: '16:00', headcount: 1 }]);
    setNextKey((value) => value + 1);
  };

  const headcountFor = (shift: ShiftRow, date: string): string => {
    const override = overrides[`${shift.key}|${date}`];
    if (override !== undefined) return override;
    return String(shift.headcount);
  };

  const setHeadcount = (shift: ShiftRow, date: string, value: string) => {
    setOverrides((current) => ({ ...current, [`${shift.key}|${date}`]: value }));
  };

  /** 修改某班次的默认人数：同步刷新尚未单独调整过的单元格 */
  const changeDefaultHeadcount = (shift: ShiftRow, value: number) => {
    const next = Number.isFinite(value) ? Math.min(500, Math.max(1, Math.floor(value))) : 1;
    updateShift(shift.key, { headcount: next });
    setOverrides((current) => {
      const updated: Record<string, string> = { ...current };
      for (const date of dates) {
        const key = `${shift.key}|${date}`;
        if (updated[key] !== undefined && Number(updated[key]) === shift.headcount) {
          updated[key] = String(next);
        }
      }
      return updated;
    });
  };

  const resetRow = (shift: ShiftRow) => {
    setOverrides((current) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(current)) {
        if (!k.startsWith(`${shift.key}|`)) next[k] = v;
      }
      return next;
    });
  };

  const totalRequired = shifts.reduce(
    (sum, shift) => sum + dates.reduce((rowSum, date) => rowSum + (Number(headcountFor(shift, date)) || 0), 0),
    0,
  );

  /** 提交前的本地校验：避免把「未命名班次」等无效数据发给服务端 */
  const validateBeforeSubmit = (formData: FormData): boolean => {
    const count = Number(formData.get('shiftCount') ?? 0);
    for (let index = 0; index < count; index += 1) {
      const shiftName = String(formData.get(`shiftName_${index}`) ?? '').trim();
      const start = String(formData.get(`shiftStart_${index}`) ?? '').trim();
      const end = String(formData.get(`shiftEnd_${index}`) ?? '').trim();
      if (!shiftName) {
        window.alert(`第 ${index + 1} 个班次还没填名称，请填写后再提交（如“白班”“夜班”）。`);
        return false;
      }
      if (!start || !end) {
        window.alert(`班次「${shiftName}」的开始/结束时间不完整，请填写后再提交。`);
        return false;
      }
    }
    if (count === 0) {
      window.alert('请至少添加一个班次。');
      return false;
    }
    if (dates.length === 0) {
      window.alert('请先选择有效的任务日期范围。');
      return false;
    }
    return true;
  };

  return (
    <form
      action={formAction}
      className="space-y-4"
      onSubmit={(event) => {
        const formData = new FormData(event.currentTarget);
        if (!validateBeforeSubmit(formData)) event.preventDefault();
      }}
    >
      {state.error ? <div className="alert alert-error">{state.error}</div> : null}

      <div className="card">
        <div className="card-title">1. 任务基本信息</div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="label" htmlFor="name">
              任务名称 <span className="text-danger">*</span>
            </label>
            <input
              id="name"
              name="name"
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：2026 年 3 月门诊排班"
              required
            />
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="description">
              任务说明
            </label>
            <textarea
              id="description"
              name="description"
              className="input h-20"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="填写说明、注意事项、联系方式等（会展示在填写页顶部）"
            />
          </div>
          <div>
            <label className="label" htmlFor="dateStart">
              任务开始日期 <span className="text-danger">*</span>
            </label>
            <input
              id="dateStart"
              name="dateStart"
              type="date"
              className="input"
              value={dateStart}
              onChange={(event) => setDateStart(event.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="dateEnd">
              任务结束日期 <span className="text-danger">*</span>
            </label>
            <input
              id="dateEnd"
              name="dateEnd"
              type="date"
              className="input"
              value={dateEnd}
              onChange={(event) => setDateEnd(event.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="fillDeadline">
              填写截止时间
            </label>
            <input
              id="fillDeadline"
              name="fillDeadline"
              type="datetime-local"
              className="input"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
            />
            <p className="hint mt-1">超过截止时间后用户将无法提交或修改（管理员仍可操作）。</p>
          </div>
          <div>
            <label className="label" htmlFor="fillPassword">
              填写密码
            </label>
            <input
              id="fillPassword"
              name="fillPassword"
              className="input"
              value={fillPassword}
              onChange={(event) => setFillPassword(event.target.value)}
              placeholder="留空则自动生成随机密码"
            />
            <p className="hint mt-1">至少 4 位；密码以哈希方式存储，忘记后可在任务详情页重置。</p>
          </div>
          <div className="md:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="allowSameDayMultiple"
                checked={allowSameDayMultiple}
                onChange={(event) => setAllowSameDayMultiple(event.target.checked)}
              />
              允许同一人同一天安排多个班次（仅当班次时间完全不重叠时生效）
            </label>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">2. 班次设置</div>
        <div className="space-y-2">
          {/* 服务端按“第几个班次”解析，因此这里使用稳定的位置下标，而不是 React 行 key。
          否则删除某一行后（例如只剩第 2 行），提交的字段名会与解析位置错位，班次会丢失。 */}
      {shifts.map((shift, index) => (
        <div key={shift.key} className="grid gap-2 border border-line p-2 md:grid-cols-[1fr_120px_120px_110px_auto]">
          <div>
            <label className="label">班次名称</label>
            <input
              className="input"
              name={`shiftName_${index}`}
              value={shift.name}
              onChange={(event) => updateShift(shift.key, { name: event.target.value })}
              placeholder="例如：白班"
            />
          </div>
          <div>
            <label className="label">开始时间</label>
            <input
              className="input"
              type="time"
              name={`shiftStart_${index}`}
              value={shift.startTime}
              onChange={(event) => updateShift(shift.key, { startTime: event.target.value })}
            />
          </div>
          <div>
            <label className="label">结束时间</label>
            <input
              className="input"
              type="time"
              name={`shiftEnd_${index}`}
              value={shift.endTime}
              onChange={(event) => updateShift(shift.key, { endTime: event.target.value })}
            />
          </div>
          <div>
            <label className="label">默认人数</label>
            <input
              className="input"
              type="number"
              min={1}
              max={500}
              name={`shiftHeadcount_${index}`}
              value={shift.headcount}
              onChange={(event) => changeDefaultHeadcount(shift, Number(event.target.value))}
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => removeShift(shift.key)}
              disabled={shifts.length <= 1}
              title={shifts.length <= 1 ? '至少保留一个班次' : '删除该班次'}
            >
              删除
            </button>
          </div>
          {/* 位置下标即解析顺序 */}
          <input type="hidden" name={`shiftId_${index}`} value={index} />
        </div>
      ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn" onClick={addShift} disabled={shifts.length >= 20}>
            + 添加班次
          </button>
          <span className="hint">最多 20 个班次。班次名称、时间可自定义，人数可在下方按天单独调整。</span>
        </div>
        <input type="hidden" name="shiftCount" value={shifts.length} />
      </div>

      <div className="card">
        <div className="card-title">3. 每日每班次所需人数（可按天单独调整）</div>
        {dates.length === 0 ? (
          <p className="text-sm text-danger">请先选择有效的任务日期范围。</p>
        ) : (
          <>
            <p className="hint mb-2">
              默认使用班次的默认人数；直接修改单元格即可按天调整。合计需求 {totalRequired} 人次，
              共 {dates.length} 天 × {shifts.length} 个班次。不同日期可使用不同班次组合：把某天某班次人数设为 0 即表示该天不需要该班次。
            </p>
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th className="nowrap">日期</th>
                    {shifts.map((shift) => (
                      <th key={shift.key} className="nowrap">
                        {shift.name || '(未命名班次)'}
                        <div className="hint font-normal">
                          {shift.startTime}~{shift.endTime}
                        </div>
                      </th>
                    ))}
                    <th className="nowrap">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {dates.map((date) => (
                    <tr key={date}>
                      <td className="nowrap font-medium">
                        {date}
                        <div className="hint font-normal">{weekday(date)}</div>
                      </td>
                      {shifts.map((shift, index) => (
                        <td key={shift.key} className="nowrap">
                          <input
                            className="input w-20"
                            type="number"
                            min={0}
                            max={500}
                            name={`req_${index}_${date}`}
                            value={headcountFor(shift, date)}
                            onChange={(event) => setHeadcount(shift, date, event.target.value)}
                          />
                        </td>
                      ))}
                      <td className="nowrap">
                        <span className="hint">修改单元格即可</span>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="nowrap bg-soft font-bold">整列重置</td>
                    {shifts.map((shift) => (
                      <td key={shift.key} className="nowrap">
                        <button type="button" className="btn btn-sm" onClick={() => resetRow(shift)}>
                          恢复默认({shift.headcount})
                        </button>
                      </td>
                    ))}
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? '创建中…' : '创建任务（草稿）'}
        </button>
        <span className="hint self-center">
          创建后进入任务详情页，可发布任务并获取专属填写链接与填写密码。
        </span>
      </div>
    </form>
  );
}
