'use client';

import { useCallback, useEffect, useState } from 'react';

type Entry = { date: string; kind: string; name?: string };
type YearState = {
  year: number;
  provider: string;
  fetchedAt: string;
  stale: boolean;
  unavailable: boolean;
  entries: Entry[];
  papers?: string[];
  overrides: Array<{ date: string; kind: string; name: string | null }>;
};

export default function CalendarSettings() {
  const now = new Date().getFullYear();
  const [year, setYear] = useState(now);
  const [data, setData] = useState<YearState | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [form, setForm] = useState({ date: '', kind: 'holiday', name: '' });
  const [csv, setCsv] = useState('');

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setMessage(null);
      try {
        const response = await fetch(`/api/admin/calendar?year=${year}${refresh ? '&refresh=1' : ''}`, { cache: 'no-store' });
        const payload = (await response.json()) as { ok?: boolean; error?: string; years?: YearState[] };
        if (!response.ok || !payload.ok) throw new Error(payload.error ?? '读取失败');
        setData(payload.years?.[0] ?? null);
      } catch (error) {
        setMessage({ kind: 'error', text: (error as Error).message });
      } finally {
        setLoading(false);
      }
    },
    [year],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const submitEntry = async () => {
    if (!form.date) {
      setMessage({ kind: 'error', text: '请选择日期' });
      return;
    }
    const response = await fetch('/api/admin/calendar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: form.date, kind: form.kind, name: form.name }),
    });
    const payload = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      setMessage({ kind: 'error', text: payload.error ?? '保存失败' });
      return;
    }
    setMessage({ kind: 'ok', text: `已保存 ${form.date}` });
    setForm({ date: '', kind: 'holiday', name: '' });
    await load(false);
  };

  const removeOverride = async (date: string) => {
    if (!window.confirm(`确定删除 ${date} 的自定义日历吗？`)) return;
    const response = await fetch(`/api/admin/calendar?date=${encodeURIComponent(date)}`, { method: 'DELETE' });
    if (!response.ok) {
      setMessage({ kind: 'error', text: '删除失败' });
      return;
    }
    await load(false);
  };

  const importCsv = async () => {
    const rows = csv
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    let okCount = 0;
    const errors: string[] = [];
    for (const row of rows) {
      const [date, kindRaw, name] = row.split(',').map((item) => item.trim());
      const kind = kindRaw === 'workday' || kindRaw === '班' || kindRaw === '补班' ? 'workday' : 'holiday';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
        errors.push(row);
        continue;
      }
      const response = await fetch('/api/admin/calendar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date, kind, name }),
      });
      if (response.ok) okCount += 1;
      else errors.push(row);
    }
    setMessage({
      kind: errors.length > 0 ? 'error' : 'ok',
      text: `导入成功 ${okCount} 条${errors.length > 0 ? `；失败 ${errors.length} 条：${errors.slice(0, 3).join(' | ')}` : ''}`,
    });
    setCsv('');
    await load(false);
  };

  const exportCsv = () => {
    if (!data) return;
    const lines = ['date,kind,name'];
    for (const entry of data.entries) {
      lines.push(`${entry.date},${entry.kind},${entry.name ?? ''}`);
    }
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `calendar-${year}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {message ? <div className={`alert ${message.kind === 'error' ? 'alert-error' : 'alert-ok'}`}>{message.text}</div> : null}

      <div className="card">
        <div className="card-title">同步状态</div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="calendar-year">
              年份
            </label>
            <select
              id="calendar-year"
              className="input max-w-[140px]"
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
            >
              {Array.from({ length: 6 }, (_, index) => now - 1 + index).map((value) => (
                <option key={value} value={value}>
                  {value} 年
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn" onClick={() => void load(true)} disabled={loading}>
            {loading ? '同步中…' : '重新同步'}
          </button>
          <button type="button" className="btn" onClick={exportCsv} disabled={!data}>
            导出 CSV
          </button>
        </div>
        <p className="hint mt-2">
          数据来源：{data?.provider ?? '-'}
          {data?.fetchedAt ? `（抓取于 ${new Date(data.fetchedAt).toLocaleString()}）` : ''}
          {data?.stale ? '　⚠ 使用缓存（接口暂不可用）' : ''}
          {data?.unavailable ? '　⚠ 接口不可用，请手动补充' : ''}
        </p>
        {data?.papers && data.papers.length > 0 ? (
          <p className="hint">
            官方来源：
            {data.papers.map((paper) => (
              <a key={paper} className="mr-2 underline" href={paper} target="_blank" rel="noreferrer">
                {paper.slice(0, 60)}…
              </a>
            ))}
          </p>
        ) : null}
      </div>

      <div className="card">
        <div className="card-title">自定义日期（优先级最高）</div>
        <div className="flex flex-wrap items-end gap-2">
          <input
            type="date"
            className="input max-w-[170px]"
            value={form.date}
            onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
          />
          <select
            className="input max-w-[110px]"
            value={form.kind}
            onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value }))}
          >
            <option value="holiday">放假</option>
            <option value="workday">补班</option>
          </select>
          <input
            className="input max-w-[200px]"
            placeholder="名称（可选）"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
          <button type="button" className="btn btn-primary" onClick={submitEntry}>
            保存
          </button>
        </div>
        <p className="hint mt-2">例：把某天设为“放假”，晚自习规则会自动跳过它；设为“补班”则视为工作日。</p>
      </div>

      <div className="card">
        <div className="card-title">年度日历明细（{data?.entries.length ?? 0} 条）</div>
        <div className="scroll-x max-h-[420px] overflow-y-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="nowrap">日期</th>
                <th className="nowrap">类型</th>
                <th className="nowrap">名称</th>
                <th className="nowrap">来源</th>
                <th className="nowrap">操作</th>
              </tr>
            </thead>
            <tbody>
              {(data?.entries ?? []).map((entry) => {
                const isOverride = (data?.overrides ?? []).some((item) => item.date === entry.date);
                return (
                  <tr key={entry.date}>
                    <td className="nowrap">{entry.date}</td>
                    <td className="nowrap">{entry.kind === 'holiday' ? '放假' : '补班'}</td>
                    <td className="nowrap">{entry.name ?? '-'}</td>
                    <td className="nowrap">{isOverride ? '自定义' : '接口/缓存'}</td>
                    <td className="nowrap">
                      {isOverride ? (
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => removeOverride(entry.date)}>
                          删除自定义
                        </button>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                );
              })}
              {(data?.entries.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={5} className="text-ink-soft">
                    暂无数据，可点击“重新同步”或手动添加。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-title">批量导入 CSV</div>
        <p className="hint">格式：每行 <code>日期,类型,名称</code>，类型填 <code>holiday</code> 或 <code>workday</code>（也支持“休/班”）。</p>
        <textarea
          className="input mt-2 h-24"
          placeholder={'2026-10-01,holiday,国庆\n2026-10-10,workday,国庆后补班'}
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
        />
        <div className="mt-2">
          <button type="button" className="btn btn-primary" onClick={importCsv} disabled={!csv.trim()}>
            导入
          </button>
        </div>
      </div>
    </div>
  );
}
