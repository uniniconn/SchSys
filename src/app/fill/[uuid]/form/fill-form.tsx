'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

export type FillShift = { id: string; name: string; startTime: string; endTime: string; defaultHeadcount: number; sortOrder: number };
export type FillCell = { date: string; shiftId: string; headcount: number };
export type FillRoster = { id: string; name: string; empNo: string | null; dept: string | null };
type Choice = 'preferred' | 'backup' | 'unavailable';

type CellState = { choice: Choice | null; reason: string };

const CHOICES: Array<{ value: Choice; label: string; short: string }> = [
  { value: 'preferred', label: '首选', short: '首' },
  { value: 'backup', label: '次选', short: '次' },
  { value: 'unavailable', label: '无法', short: '无' },
];

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function weekday(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? '';
}

export default function FillForm({
  uuid,
  taskName,
  description,
  shifts,
  cells,
  roster,
  hasRoster,
  locked,
  lockedReason,
}: {
  uuid: string;
  taskName: string;
  description: string | null;
  shifts: FillShift[];
  cells: FillCell[];
  roster: FillRoster[];
  hasRoster: boolean;
  locked: boolean;
  lockedReason: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [state, setState] = useState<Record<string, CellState>>({});
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [existingInfo, setExistingInfo] = useState<string | null>(null);

  const storageKey = `sched-fill-${uuid}`;

  const dates = useMemo(() => {
    const set = new Set(cells.map((cell) => cell.date));
    return [...set].sort();
  }, [cells]);

  const cellKey = (date: string, shiftId: string) => `${date}|${shiftId}`;

  // 恢复本地草稿（防止误刷新丢失）
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { name?: string; state?: Record<string, CellState> };
      if (parsed.name) setName((current) => current || parsed.name!);
      if (parsed.state) setState((current) => (Object.keys(current).length > 0 ? current : parsed.state!));
    } catch {
      /* 忽略损坏的本地草稿 */
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ name, state }));
    } catch {
      /* 忽略写入失败（隐私模式等） */
    }
  }, [name, state, storageKey]);

  const setChoice = (date: string, shiftId: string, choice: Choice) => {
    setState((current) => {
      const key = cellKey(date, shiftId);
      const previous = current[key] ?? { choice: null, reason: '' };
      return { ...current, [key]: { choice, reason: choice === 'unavailable' ? previous.reason : '' } };
    });
  };

  const setReason = (date: string, shiftId: string, reason: string) => {
    setState((current) => {
      const key = cellKey(date, shiftId);
      const previous = current[key] ?? { choice: null, reason: '' };
      return { ...current, [key]: { ...previous, reason } };
    });
  };

  const loadExisting = useCallback(
    async (targetName: string) => {
      if (!targetName.trim()) return;
      setLoadingExisting(true);
      setExistingInfo(null);
      try {
        const response = await fetch(`/api/fill/${encodeURIComponent(uuid)}/task?name=${encodeURIComponent(targetName)}`, {
          cache: 'no-store',
        });
        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
          existing?: { name: string; updatedAt: string; selections: Array<{ date: string; shiftId: string; choice: string; reason: string | null }> } | null;
        };
        if (!response.ok || !data.ok) {
          setMessage({ kind: 'error', text: data.error ?? '读取失败，请重新输入密码' });
          return;
        }
        if (!data.existing) {
          setExistingInfo('该姓名还没有提交记录，请完成全部选择后提交。');
          return;
        }
        const next: Record<string, CellState> = {};
        for (const selection of data.existing.selections) {
          next[cellKey(selection.date, selection.shiftId)] = {
            choice: selection.choice as Choice,
            reason: selection.reason ?? '',
          };
        }
        setState((current) => {
          const merged = { ...current };
          for (const [key, value] of Object.entries(next)) merged[key] = value;
          return merged;
        });
        setExistingInfo(`已载入「${data.existing.name}」上次提交的内容（${new Date(data.existing.updatedAt).toLocaleString()}），修改后再次提交即可覆盖。`);
      } catch {
        setMessage({ kind: 'error', text: '网络错误，无法读取上次填写内容' });
      } finally {
        setLoadingExisting(false);
      }
    },
    [uuid],
  );

  const filledCount = cells.filter((cell) => state[cellKey(cell.date, cell.shiftId)]?.choice).length;
  const unavailableMissingReason = cells.filter((cell) => {
    const entry = state[cellKey(cell.date, cell.shiftId)];
    return entry?.choice === 'unavailable' && !entry.reason.trim();
  }).length;

  const nameSelection = roster.find((entry) => entry.name === name) ?? null;

  const groupedByDate = useMemo(
    () =>
      dates.map((date) => ({
        date,
        cells: shifts
          .map((shift) => {
            const cell = cells.find((item) => item.date === date && item.shiftId === shift.id);
            return cell ? { shift, cell } : null;
          })
          .filter((item): item is { shift: FillShift; cell: FillCell } => item !== null),
      })),
    [dates, shifts, cells],
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    if (!name.trim()) {
      setMessage({ kind: 'error', text: '请填写或选择姓名' });
      return;
    }
    if (hasRoster && !nameSelection) {
      setMessage({ kind: 'error', text: '请从管理员上传的名单中选择姓名' });
      return;
    }
    if (filledCount !== cells.length) {
      setMessage({ kind: 'error', text: `还有 ${cells.length - filledCount} 个“日期+班次”未选择，必须全部选择后才能提交` });
      return;
    }
    if (unavailableMissingReason > 0) {
      setMessage({ kind: 'error', text: `有 ${unavailableMissingReason} 处选择“无法排班”但未填写理由` });
      return;
    }

    setPending(true);
    try {
      const response = await fetch(`/api/fill/${encodeURIComponent(uuid)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nameSelection?.name ?? name.trim(),
          selections: cells.map((cell) => {
            const entry = state[cellKey(cell.date, cell.shiftId)];
            return { date: cell.date, shiftId: cell.shiftId, choice: entry?.choice ?? null, reason: entry?.reason ?? '' };
          }),
        }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; redirectTo?: string };
      if (!response.ok || !data.ok) {
        setMessage({ kind: 'error', text: data.error ?? '提交失败，请重试' });
        setPending(false);
        return;
      }
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        /* 忽略 */
      }
      router.replace(data.redirectTo ?? `/fill/${uuid}/success`);
      router.refresh();
    } catch {
      setMessage({ kind: 'error', text: '网络错误，提交失败' });
      setPending(false);
    }
  }

  const progressPercent = cells.length === 0 ? 0 : Math.round((filledCount / cells.length) * 100);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="card">
        <div className="card-title">1. 确认姓名</div>
        {hasRoster ? (
          <>
            <label className="label" htmlFor="name">
              从名单中选择你的姓名 <span className="text-danger">*</span>
            </label>
            <select
              id="name"
              className="input max-w-xs"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                void loadExisting(event.target.value);
              }}
              disabled={locked}
            >
              <option value="">请选择…</option>
              {roster.map((entry) => (
                <option key={entry.id} value={entry.name}>
                  {entry.name}
                  {entry.empNo ? `（${entry.empNo}）` : ''}
                  {entry.dept ? ` - ${entry.dept}` : ''}
                </option>
              ))}
            </select>
            <p className="hint mt-1">管理员已上传名单，请从名单中选择；选择后会自动载入你上次填写的内容。</p>
          </>
        ) : (
          <>
            <label className="label" htmlFor="name">
              你的姓名 <span className="text-danger">*</span>
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <input
                id="name"
                className="input max-w-xs"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="请输入真实姓名"
                disabled={locked}
              />
              <button
                type="button"
                className="btn"
                onClick={() => void loadExisting(name)}
                disabled={locked || loadingExisting || !name.trim()}
              >
                {loadingExisting ? '读取中…' : '载入我已提交的内容'}
              </button>
            </div>
            <p className="hint mt-1">管理员未上传名单，请手动填写姓名。用同一姓名再次进入可修改已提交内容。</p>
          </>
        )}
        {existingInfo ? <div className="alert alert-info mt-2">{existingInfo}</div> : null}
        {locked ? <div className="alert alert-error mt-2">{lockedReason ?? '当前已锁定，不能提交'}</div> : null}
      </div>

      <div className="card">
        <div className="card-title">2. 选择排班意愿（{taskName}）</div>
        {description ? <p className="mb-3 border border-line bg-soft p-2 text-sm">{description}</p> : null}
        <div className="mb-3 border border-line p-2 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              进度：<strong>{filledCount}</strong> / {cells.length}（{progressPercent}%）
            </span>
            {unavailableMissingReason > 0 ? (
              <span className="text-danger">有 {unavailableMissingReason} 处“无法排班”缺少理由</span>
            ) : null}
          </div>
          <div className="mt-2 h-3 w-full border border-line bg-white">
            <div className="h-2.5 bg-brand" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="hint mt-2">
            每个单元格必须三选一：<strong>首选</strong>（最希望）、<strong>次选</strong>（可以）、
            <strong>无法</strong>（不能，必须填写理由）。横向可滚动查看全部班次。
          </div>
        </div>

        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th className="nowrap">日期</th>
                {shifts.map((shift) => (
                  <th key={shift.id} className="nowrap">
                    {shift.name}
                    <div className="hint font-normal">
                      {shift.startTime}~{shift.endTime}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupedByDate.map((group) => (
                <tr key={group.date}>
                  <td className="nowrap font-medium">
                    {group.date}
                    <div className="hint font-normal">{weekday(group.date)}</div>
                  </td>
                  {shifts.map((shift) => {
                    const cell = group.cells.find((item) => item.shift.id === shift.id);
                    if (!cell) {
                      return (
                        <td key={shift.id} className="nowrap bg-soft text-ink-soft">
                          当天无此班次
                        </td>
                      );
                    }
                    const entry = state[cellKey(cell.cell.date, shift.id)] ?? { choice: null, reason: '' };
                    return (
                      <td key={shift.id} className="min-w-[210px]">
                        <div className="flex flex-wrap gap-1">
                          {CHOICES.map((choice) => {
                            const active = entry.choice === choice.value;
                            return (
                              <button
                                key={choice.value}
                                type="button"
                                disabled={locked}
                                onClick={() => setChoice(cell.cell.date, shift.id, choice.value)}
                                className={`border px-2 py-1 text-xs ${
                                  active
                                    ? choice.value === 'unavailable'
                                      ? 'border-danger bg-danger text-white'
                                      : 'border-brand bg-brand text-white'
                                    : 'border-line bg-white text-ink'
                                }`}
                              >
                                {choice.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="hint mt-1">需求 {cell.cell.headcount} 人</div>
                        {entry.choice === 'unavailable' ? (
                          <input
                            className="input mt-1"
                            placeholder="请填写无法排班理由（必填）"
                            value={entry.reason}
                            disabled={locked}
                            onChange={(event) => setReason(cell.cell.date, shift.id, event.target.value)}
                          />
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {message ? <div className={`alert ${message.kind === 'error' ? 'alert-error' : 'alert-ok'}`}>{message.text}</div> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending || locked}>
          {pending ? '提交中…' : '提交排班意愿'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setState({});
            try {
              window.localStorage.removeItem(storageKey);
            } catch {
              /* 忽略 */
            }
          }}
          disabled={pending}
        >
          清空重填
        </button>
        <span className="hint">
          提交后仍可在管理员确认前用同一姓名再次进入修改；管理员确认后即锁定。
        </span>
      </div>
    </form>
  );
}
