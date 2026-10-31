'use client';

import { useMemo, useState } from 'react';

export type ReasonItem = {
  date: string;
  shiftName: string;
  name: string;
  dept: string | null;
  empNo: string | null;
  reason: string;
};

/** 「无法排班」理由汇总：支持搜索、按日期/班次筛选、导出与打印 */
export default function ReasonsPanel({
  taskId,
  items,
  dates,
  shifts,
}: {
  taskId: string;
  items: ReasonItem[];
  dates: string[];
  shifts: string[];
}) {
  const [keyword, setKeyword] = useState('');
  const [date, setDate] = useState('');
  const [shift, setShift] = useState('');

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return items.filter((item) => {
      if (date && item.date !== date) return false;
      if (shift && item.shiftName !== shift) return false;
      if (!needle) return true;
      return [item.name, item.reason, item.date, item.shiftName, item.dept ?? '', item.empNo ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [items, keyword, date, shift]);

  const exportQuery = new URLSearchParams();
  if (keyword.trim()) exportQuery.set('q', keyword.trim());
  if (date) exportQuery.set('date', date);
  if (shift) exportQuery.set('shift', shift);
  const query = exportQuery.toString();

  return (
    <div className="card">
      <div className="card-title">「无法排班」理由一键汇总（{items.length} 条）</div>

      <div className="mb-3 flex flex-wrap items-end gap-2 no-print">
        <div>
          <label className="label" htmlFor="reasonKeyword">
            搜索（姓名/理由/工号/部门）
          </label>
          <input
            id="reasonKeyword"
            className="input max-w-[220px]"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="输入关键字"
          />
        </div>
        <div>
          <label className="label" htmlFor="reasonDate">
            日期
          </label>
          <select id="reasonDate" className="input max-w-[160px]" value={date} onChange={(event) => setDate(event.target.value)}>
            <option value="">全部日期</option>
            {dates.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="reasonShift">
            班次
          </label>
          <select id="reasonShift" className="input max-w-[160px]" value={shift} onChange={(event) => setShift(event.target.value)}>
            <option value="">全部班次</option>
            {shifts.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            setKeyword('');
            setDate('');
            setShift('');
          }}
        >
          重置
        </button>
        <a className="btn btn-sm" href={`/api/admin/tasks/${taskId}/reasons${query ? `?${query}&format=csv` : '?format=csv'}`}>
          导出 CSV
        </a>
        <a className="btn btn-sm" href={`/api/admin/tasks/${taskId}/reasons${query ? `?${query}&format=xlsx` : '?format=xlsx'}`}>
          导出 XLSX
        </a>
        <button type="button" className="btn btn-sm" onClick={() => window.print()}>
          打印
        </button>
      </div>

      <p className="hint mb-2">当前显示 {filtered.length} 条（导出按钮会按当前筛选条件导出）。</p>

      <div className="scroll-x">
        <table className="table">
          <thead>
            <tr>
              <th className="nowrap">日期</th>
              <th className="nowrap">班次</th>
              <th className="nowrap">姓名</th>
              <th className="nowrap">工号</th>
              <th className="nowrap">部门</th>
              <th>无法排班理由</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-ink-soft">
                  暂无可展示的理由（可能还没有人选择“无法排班”，或筛选条件过窄）。
                </td>
              </tr>
            ) : (
              filtered.map((item, index) => (
                <tr key={`${item.date}-${item.shiftName}-${item.name}-${index}`}>
                  <td className="nowrap">{item.date}</td>
                  <td className="nowrap">{item.shiftName}</td>
                  <td className="nowrap">{item.name}</td>
                  <td className="nowrap">{item.empNo ?? '-'}</td>
                  <td className="nowrap">{item.dept ?? '-'}</td>
                  <td>{item.reason || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
