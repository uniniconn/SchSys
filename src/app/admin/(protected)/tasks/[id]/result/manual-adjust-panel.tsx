'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  addManualAssignmentAction,
  clearManualAssignmentsAction,
  removeAssignmentAction,
  updateAssignmentNoteAction,
} from '../manual-actions';
import type { CalendarPerson } from '@/lib/result';

export type ManualRow = {
  date: string;
  shiftId: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  areaId: string;
  areaName: string;
  groupName: string;
  headcount: number;
  people: CalendarPerson[];
};

type Candidate = {
  id: string;
  name: string;
  empNo: string | null;
  dept: string | null;
  onRoster: boolean;
  choice: 'preferred' | 'backup' | 'unavailable' | 'none';
  reason: string | null;
  assignedHere: boolean;
  sameDayOther: boolean;
  slotAreas: number;
  eligible: boolean;
};

const CHOICE_LABEL: Record<Candidate['choice'], string> = {
  preferred: '首选',
  backup: '次选',
  unavailable: '无法排班',
  none: '无选择',
};

const SOURCE_TEXT: Record<string, string> = {
  preferred: '首选',
  backup: '次选',
  manual: '手动',
};

function sourceBadge(person: CalendarPerson): string {
  const base = SOURCE_TEXT[person.source] ?? person.source;
  return person.manual ? `手动·${base}` : base;
}

export default function ManualAdjustPanel({
  taskId,
  rows,
  manualCount,
}: {
  taskId: string;
  rows: ManualRow[];
  manualCount: number;
}) {
  const router = useRouter();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Record<string, Candidate[]>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Record<string, { kind: 'ok' | 'error' | 'warn'; text: string }>>({});
  const [globalMessage, setGlobalMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const rowKey = (row: ManualRow) => `${row.date}|${row.shiftId}|${row.areaId}`;

  const setRowMessage = (key: string, message: { kind: 'ok' | 'error' | 'warn'; text: string } | null) => {
    setMessages((current) => {
      const next = { ...current };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });
  };

  async function loadCandidates(row: ManualRow) {
    const key = rowKey(row);
    setLoadingKey(key);
    setRowMessage(key, null);
    try {
      const response = await fetch(
        `/api/admin/tasks/${encodeURIComponent(taskId)}/candidates?date=${encodeURIComponent(row.date)}&shiftId=${encodeURIComponent(row.shiftId)}&areaId=${encodeURIComponent(row.areaId)}`,
        { cache: 'no-store' },
      );
      const data = (await response.json()) as { ok?: boolean; error?: string; items?: Candidate[] };
      if (!response.ok || !data.ok) {
        setRowMessage(key, { kind: 'error', text: data.error ?? '读取候选人失败' });
        return;
      }
      setCandidates((current) => ({ ...current, [key]: data.items ?? [] }));
    } catch {
      setRowMessage(key, { kind: 'error', text: '网络错误，读取候选人失败' });
    } finally {
      setLoadingKey(null);
    }
  }

  async function handleAdd(row: ManualRow) {
    const key = rowKey(row);
    const submissionId = selected[key];
    if (!submissionId) {
      setRowMessage(key, { kind: 'error', text: '请选择要添加的人员' });
      return;
    }
    setBusy(true);
    const formData = new FormData();
    formData.set('taskId', taskId);
    formData.set('date', row.date);
    formData.set('shiftId', row.shiftId);
    formData.set('areaId', row.areaId);
    formData.set('submissionId', submissionId);
    formData.set('note', note[key] ?? '');
    const result = await addManualAssignmentAction({}, formData);
    setBusy(false);
    if (result.error) {
      setRowMessage(key, { kind: 'error', text: result.error });
      return;
    }
    setRowMessage(key, {
      kind: result.warning ? 'warn' : 'ok',
      text: result.warning ? `${result.ok}。注意：${result.warning}` : (result.ok ?? '已添加'),
    });
    setSelected((current) => ({ ...current, [key]: '' }));
    setNote((current) => ({ ...current, [key]: '' }));
    setOpenKey(null);
    router.refresh();
  }

  async function handleRemove(row: ManualRow, person: CalendarPerson) {
    const key = rowKey(row);
    if (!window.confirm(`确定把「${person.name}」从 ${row.date} ${row.shiftName} 中移除吗？`)) return;
    setBusy(true);
    const formData = new FormData();
    formData.set('taskId', taskId);
    formData.set('assignmentId', person.assignmentId);
    const result = await removeAssignmentAction({}, formData);
    setBusy(false);
    if (result.error) setRowMessage(key, { kind: 'error', text: result.error });
    else setRowMessage(key, { kind: 'ok', text: result.ok ?? '已移除' });
    router.refresh();
  }

  async function handleNote(row: ManualRow, person: CalendarPerson) {
    const key = rowKey(row);
    const nextNote = window.prompt('修改该条排班的调整说明（留空表示清空）：', person.note ?? '');
    if (nextNote === null) return;
    setBusy(true);
    const formData = new FormData();
    formData.set('taskId', taskId);
    formData.set('assignmentId', person.assignmentId);
    formData.set('note', nextNote);
    const result = await updateAssignmentNoteAction({}, formData);
    setBusy(false);
    if (result.error) setRowMessage(key, { kind: 'error', text: result.error });
    else setRowMessage(key, { kind: 'ok', text: result.ok ?? '说明已保存' });
    router.refresh();
  }

  async function handleClearManual() {
    if (!window.confirm(`确定清空全部 ${manualCount} 条手动添加的排班记录吗？（自动匹配的结果保留）`)) return;
    setBusy(true);
    const formData = new FormData();
    formData.set('taskId', taskId);
    const result = await clearManualAssignmentsAction({}, formData);
    setBusy(false);
    setGlobalMessage(result.error ? { kind: 'error', text: result.error } : { kind: 'ok', text: result.ok ?? '已清空' });
    router.refresh();
  }

  return (
    <div className="card" id="manual-adjust">
      <div className="card-title">
        手动调整排班（自动匹配后可人工增删人员）{manualCount > 0 ? `　已手动调整 ${manualCount} 条` : ''}
      </div>

      <p className="hint mb-3">
        每条调整会<strong>立即保存</strong>并记入操作日志。硬性规则：标记为“无法排班”的人员不能被安排；
        超员、同日多班等冲突会给出提示但仍可保存（由管理员判断）。
        <br />
        注意：重新执行“自动匹配排班”会用新结果覆盖这些手动调整。
      </p>

      {globalMessage ? (
        <div className={`alert ${globalMessage.kind === 'error' ? 'alert-error' : 'alert-ok'} mb-3`}>
          {globalMessage.text}
        </div>
      ) : null}

      {manualCount > 0 ? (
        <div className="mb-3 no-print">
          <button type="button" className="btn btn-sm btn-danger" onClick={handleClearManual} disabled={busy}>
            清空手动添加的记录（{manualCount} 条）
          </button>
        </div>
      ) : null}

      <div className="scroll-x">
        <table className="table">
          <thead>
            <tr>
              <th className="nowrap">日期</th>
              <th className="nowrap">班次</th>
              <th className="nowrap">区域 / 组</th>
              <th className="nowrap">需求 / 已排</th>
              <th>已安排人员</th>
              <th className="nowrap">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-ink-soft">
                  当前任务没有需要排班的「日期 + 班次 + 区域」。
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const key = rowKey(row);
                const message = messages[key];
                const isOpen = openKey === key;
                const list = candidates[key] ?? [];
                const canAddMore = list.some((item) => item.eligible);
                return (
                  <tr key={key}>
                    <td className="nowrap align-top">{row.date}</td>
                    <td className="nowrap align-top">
                      {row.shiftName}
                      <div className="hint">
                        {row.startTime}~{row.endTime}
                      </div>
                    </td>
                    <td className="nowrap align-top">
                      {row.areaName}
                      <div className="hint">{row.groupName}</div>
                    </td>
                    <td className="nowrap align-top">
                      <span className={row.people.length < row.headcount ? 'text-danger font-bold' : ''}>
                        {row.people.length} / {row.headcount}
                      </span>
                      {row.people.length > row.headcount ? (
                        <div className="hint text-danger">超员 {row.people.length - row.headcount} 人</div>
                      ) : null}
                    </td>
                    <td className="align-top">
                      {row.people.length === 0 ? (
                        <span className="text-danger">尚未安排（缺口 {row.headcount} 人）</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {row.people.map((person) => (
                            <span key={person.assignmentId} className="inline-flex items-center gap-1 border border-line px-1.5 py-0.5">
                              <span>{person.name}</span>
                              <span className={`hint ${person.manual ? 'text-brand' : ''}`}>{sourceBadge(person)}</span>
                              {person.note ? <span className="hint" title={person.note}>＊</span> : null}
                              <button
                                type="button"
                                className="hint underline"
                                title="编辑调整说明"
                                onClick={() => handleNote(row, person)}
                                disabled={busy}
                              >
                                说明
                              </button>
                              <button
                                type="button"
                                className="text-danger"
                                title="移除该人员"
                                onClick={() => handleRemove(row, person)}
                                disabled={busy}
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      {message ? (
                        <div
                          className={`alert mt-1 ${
                            message.kind === 'error' ? 'alert-error' : message.kind === 'warn' ? 'alert-info' : 'alert-ok'
                          }`}
                        >
                          {message.text}
                        </div>
                      ) : null}
                    </td>
                    <td className="align-top nowrap">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          if (isOpen) {
                            setOpenKey(null);
                            return;
                          }
                          setOpenKey(key);
                          if (!candidates[key]) void loadCandidates(row);
                        }}
                        disabled={busy}
                      >
                        {isOpen ? '收起' : '添加人员'}
                      </button>
                      {isOpen ? (
                        <div className="mt-2 border border-line p-2">
                          {loadingKey === key ? (
                            <p className="hint">正在读取候选人…</p>
                          ) : list.length === 0 ? (
                            <p className="hint">该任务还没有任何填写记录，无法添加人员。</p>
                          ) : (
                            <div className="space-y-2">
                              <label className="label" htmlFor={`candidate-${key}`}>
                                选择人员（按意愿排序）
                              </label>
                              <select
                                id={`candidate-${key}`}
                                className="input max-w-[320px]"
                                value={selected[key] ?? ''}
                                onChange={(event) => setSelected((current) => ({ ...current, [key]: event.target.value }))}
                              >
                                <option value="">请选择…</option>
                                {list.map((item) => (
                                  <option key={item.id} value={item.id} disabled={!item.eligible}>
                                    {item.name}
                                    {item.dept ? `（${item.dept}）` : ''} · {CHOICE_LABEL[item.choice]}
                                    {item.assignedHere ? ' · 已在该区域' : ''}
                                    {!item.assignedHere && item.slotAreas > 0 ? ` · 本时段已兼顾 ${item.slotAreas} 个区域` : ''}
                                    {!item.assignedHere && item.sameDayOther ? ' · 同日已有班次' : ''}
                                    {item.choice === 'unavailable' ? ' · 禁止安排' : ''}
                                  </option>
                                ))}
                              </select>
                              <input
                                className="input max-w-[320px]"
                                placeholder="调整说明（可选，如：原定人员请假，临时调整）"
                                value={note[key] ?? ''}
                                onChange={(event) => setNote((current) => ({ ...current, [key]: event.target.value }))}
                              />
                              {!canAddMore ? <p className="hint text-danger">没有可添加的人员（都已在班次中或标记为无法排班）。</p> : null}
                              <div className="flex gap-2">
                                <button type="button" className="btn btn-primary btn-sm" onClick={() => handleAdd(row)} disabled={busy}>
                                  {busy ? '保存中…' : '确认添加'}
                                </button>
                                <button type="button" className="btn btn-sm" onClick={() => setOpenKey(null)} disabled={busy}>
                                  取消
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
