'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createTaskAction, type ActionState } from '../../task-actions';
import {
  MAX_DRAFT_AREAS,
  MAX_DRAFT_SHIFTS,
  TEMPLATES,
  createDraftFromTemplate,
  draftShiftDateCounts,
  enumerateDraftDates,
  generateRequirements,
  normalizeDraft,
  type DraftShift,
  type TaskDraft,
  type TemplateKey,
} from '@/lib/task-draft';
import { DATE_RULE_PRESETS, type DateRulePresetKey } from '@/lib/schedule-rules';
import type { CalendarEntry } from '@/lib/calendar-api';
import { isDateString } from '@/lib/date-utils';

const DRAFT_KEY = 'sched-task-draft-v1';

type CalendarYearState = {
  year: number;
  provider: string;
  fetchedAt: string;
  stale: boolean;
  unavailable: boolean;
  entries: CalendarEntry[];
  papers?: string[];
  overrides: Array<{ date: string; kind: string; name: string | null }>;
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function defaultRange(): { start: string; end: string; deadline: string } {
  const today = new Date();
  const start = new Date(today.getTime() + 86400000);
  const end = new Date(today.getTime() + 7 * 86400000);
  const deadline = new Date(today.getTime() + 5 * 86400000);
  return {
    start: localDate(start),
    end: localDate(end),
    deadline: `${localDate(deadline)}T18:00`,
  };
}

function randomPassword(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 8; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function initialDraft(): TaskDraft {
  const range = defaultRange();
  const draft = createDraftFromTemplate('evening');
  return {
    ...draft,
    dateStart: range.start,
    dateEnd: range.end,
    fillDeadline: range.deadline,
    fillPassword: randomPassword(),
  };
}

const WEEKDAY_LABELS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' },
];

export default function TaskWizard() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(createTaskAction, {});
  const [mode, setMode] = useState<'quick' | 'advanced'>('quick');
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<TaskDraft>(initialDraft);
  const [hydrated, setHydrated] = useState(false);
  const [calendarYears, setCalendarYears] = useState<CalendarYearState[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [activeShiftTab, setActiveShiftTab] = useState(0);
  const [newEntry, setNewEntry] = useState<{ date: string; kind: 'holiday' | 'workday'; name: string }>({
    date: '',
    kind: 'holiday',
    name: '',
  });
  const [showResume, setShowResume] = useState(false);

  // 恢复草稿
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { draft?: TaskDraft; mode?: 'quick' | 'advanced' };
        if (parsed.draft) {
          setShowResume(true);
          setDraft((current) => current); // 等用户选择
          (window as unknown as { __resumeDraft?: TaskDraft }).__resumeDraft = parsed.draft;
        }
      }
    } catch {
      /* ignore */
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, mode, updatedAt: Date.now() }));
    } catch {
      /* ignore */
    }
  }, [draft, mode, hydrated]);

  const years = useMemo(() => {
    if (!isDateString(draft.dateStart) || !isDateString(draft.dateEnd)) return [] as number[];
    const from = Number(draft.dateStart.slice(0, 4));
    const to = Number(draft.dateEnd.slice(0, 4));
    const list: number[] = [];
    for (let year = from; year <= to && list.length < 5; year += 1) list.push(year);
    return list;
  }, [draft.dateStart, draft.dateEnd]);

  useEffect(() => {
    if (years.length === 0) return;
    let cancelled = false;
    setCalendarLoading(true);
    setCalendarError(null);
    fetch(`/api/admin/calendar?years=${years.join(',')}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json()) as { ok?: boolean; error?: string; years?: CalendarYearState[] };
        if (cancelled) return;
        if (!response.ok || !data.ok) throw new Error(data.error ?? '读取日历失败');
        setCalendarYears(data.years ?? []);
      })
      .catch((error) => {
        if (!cancelled) setCalendarError((error as Error).message);
      })
      .finally(() => {
        if (!cancelled) setCalendarLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [years.join(',')]);

  const calendarEntries = useMemo(() => {
    const map = new Map<string, CalendarEntry>();
    for (const year of calendarYears) for (const entry of year.entries) map.set(entry.date, entry);
    for (const entry of draft.calendar?.manualEntries ?? []) map.set(entry.date, entry);
    return [...map.values()];
  }, [calendarYears, draft.calendar?.manualEntries]);

  const { draft: normalized, errors } = useMemo(() => normalizeDraft(draft), [draft]);
  const generated = useMemo(() => generateRequirements(normalized, calendarEntries), [normalized, calendarEntries]);
  const shiftDateCounts = useMemo(() => draftShiftDateCounts(normalized, calendarEntries), [normalized, calendarEntries]);
  const previewDates = useMemo(() => enumerateDraftDates(normalized, calendarEntries), [normalized, calendarEntries]);

  const update = (patch: Partial<TaskDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const applyTemplate = (key: TemplateKey) => {
    const built = createDraftFromTemplate(key);
    setDraft((current) => ({
      ...current,
      templateKey: key,
      areaCoverage: built.areaCoverage,
      maxAreasPerPerson: built.maxAreasPerPerson,
      allowSameDayMultiple: built.allowSameDayMultiple,
      shifts: built.shifts,
      overrides: [],
    }));
    setActiveShiftTab(0);
  };

  const updateShift = (index: number, patch: Partial<DraftShift>) => {
    setDraft((current) => ({
      ...current,
      shifts: current.shifts.map((shift, i) => (i === index ? { ...shift, ...patch } : shift)),
    }));
  };

  const setRulePreset = (index: number, preset: DateRulePresetKey) => {
    const presetRule = DATE_RULE_PRESETS[preset].rule;
    updateShift(index, { dateRule: { ...presetRule, includeDates: [], excludeDates: [] } });
  };

  const matchPreset = (shift: DraftShift): DateRulePresetKey | 'custom' => {
    const entries = Object.entries(DATE_RULE_PRESETS) as Array<[DateRulePresetKey, (typeof DATE_RULE_PRESETS)[DateRulePresetKey]]>;
    for (const [key, preset] of entries) {
      if (
        preset.rule.eveOfWorkday === shift.dateRule.eveOfWorkday &&
        preset.rule.excludeHolidays === shift.dateRule.excludeHolidays &&
        preset.rule.weekdays.join(',') === shift.dateRule.weekdays.join(',')
      ) {
        return key;
      }
    }
    return 'custom';
  };

  const addArea = (shiftIndex: number) => {
    setDraft((current) => {
      const shifts = current.shifts.map((shift, i) => {
        if (i !== shiftIndex || shift.areas.length >= MAX_DRAFT_AREAS) return shift;
        return {
          ...shift,
          areas: [...shift.areas, { name: `区域 ${shift.areas.length + 1}`, groupName: shift.areas[0]?.groupName ?? '默认组', defaultHeadcount: 1 }],
        };
      });
      return { ...current, shifts };
    });
  };

  const removeArea = (shiftIndex: number, areaIndex: number) => {
    setDraft((current) => ({
      ...current,
      shifts: current.shifts.map((shift, i) =>
        i === shiftIndex ? { ...shift, areas: shift.areas.filter((_, a) => a !== areaIndex) } : shift,
      ),
      overrides: current.overrides
        .filter((override) => !(override.shiftIndex === shiftIndex && override.areaIndex === areaIndex))
        .map((override) =>
          override.shiftIndex === shiftIndex && override.areaIndex > areaIndex
            ? { ...override, areaIndex: override.areaIndex - 1 }
            : override,
        ),
    }));
  };

  const addShift = () => {
    setDraft((current) => {
      if (current.shifts.length >= MAX_DRAFT_SHIFTS) return current;
      return {
        ...current,
        shifts: [
          ...current.shifts,
          {
            name: `班次 ${current.shifts.length + 1}`,
            startTime: '08:00',
            endTime: '16:00',
            dateRule: { ...DATE_RULE_PRESETS.workday.rule },
            areas: [{ name: '默认区域', groupName: '默认组', defaultHeadcount: 1 }],
          },
        ],
      };
    });
  };

  const removeShift = (index: number) => {
    setDraft((current) => ({
      ...current,
      shifts: current.shifts.filter((_, i) => i !== index),
      overrides: current.overrides
        .filter((override) => override.shiftIndex !== index)
        .map((override) =>
          override.shiftIndex > index ? { ...override, shiftIndex: override.shiftIndex - 1 } : override,
        ),
    }));
    setActiveShiftTab(0);
  };

  const headcountFor = (shiftIndex: number, areaIndex: number, date: string): string => {
    const override = draft.overrides.find(
      (item) => item.date === date && item.shiftIndex === shiftIndex && item.areaIndex === areaIndex,
    );
    if (override) return String(override.headcount);
    return String(draft.shifts[shiftIndex]?.areas[areaIndex]?.defaultHeadcount ?? 1);
  };

  const setHeadcount = (shiftIndex: number, areaIndex: number, date: string, value: string) => {
    const headcount = Math.max(0, Math.min(500, Number(value) || 0));
    setDraft((current) => {
      const others = current.overrides.filter(
        (item) => !(item.date === date && item.shiftIndex === shiftIndex && item.areaIndex === areaIndex),
      );
      return { ...current, overrides: [...others, { date, shiftIndex, areaIndex, headcount }] };
    });
  };

  const addManualCalendarEntry = async () => {
    if (!newEntry.date || !isDateString(newEntry.date)) return;
    const entry: CalendarEntry = { date: newEntry.date, kind: newEntry.kind, name: newEntry.name || undefined };
    update({
      calendar: {
        ...(draft.calendar ?? { useApi: true }),
        manualEntries: [...(draft.calendar?.manualEntries ?? []).filter((item) => item.date !== entry.date), entry],
      },
    });
    setNewEntry({ date: '', kind: 'holiday', name: '' });
    try {
      await fetch('/api/admin/calendar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: entry.date, kind: entry.kind, name: entry.name }),
      });
    } catch {
      /* 本地草稿已保存，网络失败不阻断 */
    }
  };

  const removeManualCalendarEntry = (date: string) => {
    update({
      calendar: {
        ...(draft.calendar ?? { useApi: true }),
        manualEntries: (draft.calendar?.manualEntries ?? []).filter((item) => item.date !== date),
      },
    });
  };

  const stepValid = (value: number): boolean => {
    if (value === 1) {
      return (
        Boolean(normalized.name) &&
        isDateString(normalized.dateStart) &&
        isDateString(normalized.dateEnd) &&
        normalized.dateStart <= normalized.dateEnd
      );
    }
    if (value === 2) return true;
    if (value === 3) {
      return (
        normalized.shifts.length > 0 &&
        normalized.shifts.every((shift) => shift.name && shift.areas.length > 0 && shift.areas.every((area) => area.name))
      );
    }
    if (value === 4) return generated.rows.length > 0;
    return errors.length === 0;
  };

  const canSubmit = errors.length === 0 && generated.rows.length > 0;

  const summaryLine = `共 ${generated.summary.dates} 天 · ${generated.summary.shifts} 个班次 · ${generated.summary.areas} 个区域 · 预计 ${generated.summary.totalRequired} 人次`;

  const calendarStatus = calendarLoading
    ? '正在获取节假日与调休…'
    : calendarError
      ? `日历获取失败：${calendarError}（可继续手动创建）`
      : calendarYears.length === 0
        ? '未获取日历'
        : calendarYears
            .map(
              (item) =>
                `${item.year}：${item.provider}${item.stale ? '（缓存）' : ''}${item.unavailable ? '（不可用，需手动）' : ''}`,
            )
            .join('；');

  const renderTemplateCards = () => (
    <div className="grid gap-2 md:grid-cols-2">
      {TEMPLATES.map((template) => {
        const active = draft.templateKey === template.key;
        return (
          <button
            key={template.key}
            type="button"
            onClick={() => applyTemplate(template.key)}
            className={`border p-3 text-left ${active ? 'border-brand bg-soft' : 'border-line bg-white'}`}
          >
            <div className="font-bold">{template.title}</div>
            <div className="hint mt-1">{template.description}</div>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-4">
      {showResume ? (
        <div className="alert alert-info flex flex-wrap items-center gap-2">
          发现上次未完成的草稿。
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              const saved = (window as unknown as { __resumeDraft?: TaskDraft }).__resumeDraft;
              if (saved) setDraft(saved);
              setShowResume(false);
            }}
          >
            继续上次填写
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setShowResume(false);
              window.localStorage.removeItem(DRAFT_KEY);
            }}
          >
            重新开始
          </button>
        </div>
      ) : null}

      {state.error ? <div className="alert alert-error">{state.error}</div> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            className={`btn ${mode === 'quick' ? 'btn-primary' : ''}`}
            onClick={() => setMode('quick')}
          >
            快速创建
          </button>
          <button
            type="button"
            className={`btn ${mode === 'advanced' ? 'btn-primary' : ''}`}
            onClick={() => setMode('advanced')}
          >
            详细配置
          </button>
        </div>
        <span className="hint">{mode === 'quick' ? '3 个输入即可创建，其余用推荐值' : `第 ${step} / 5 步`}</span>
      </div>

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="draft" value={JSON.stringify(draft)} />

        {mode === 'quick' ? (
          <>
            <div className="card">
              <div className="card-title">1. 基本信息</div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="label" htmlFor="quick-name">
                    任务名称 <span className="text-danger">*</span>
                  </label>
                  <input
                    id="quick-name"
                    className="input"
                    value={draft.name}
                    onChange={(event) => update({ name: event.target.value })}
                    placeholder="例如：十一月晚自习值班"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="label" htmlFor="quick-start">
                    开始日期 <span className="text-danger">*</span>
                  </label>
                  <input
                    id="quick-start"
                    type="date"
                    className="input"
                    value={draft.dateStart}
                    onChange={(event) => update({ dateStart: event.target.value })}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="quick-end">
                    结束日期 <span className="text-danger">*</span>
                  </label>
                  <input
                    id="quick-end"
                    type="date"
                    className="input"
                    value={draft.dateEnd}
                    onChange={(event) => update({ dateEnd: event.target.value })}
                  />
                </div>
                <div className="md:col-span-2 flex flex-wrap gap-2">
                  {[
                    { label: '本周', days: 7 },
                    { label: '下周', days: 7, offset: 7 },
                    { label: '两周', days: 14 },
                    { label: '一个月', days: 30 },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        const start = new Date(Date.now() + (preset.offset ?? 1) * 86400000);
                        const end = new Date(start.getTime() + (preset.days - 1) * 86400000);
                        update({ dateStart: localDate(start), dateEnd: localDate(end) });
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <details className="mt-3 border border-line p-2">
                <summary className="cursor-pointer text-sm font-medium">更多设置（截止时间、填写密码、区域模式）</summary>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="quick-deadline">
                      填写截止时间
                    </label>
                    <input
                      id="quick-deadline"
                      type="datetime-local"
                      className="input"
                      value={draft.fillDeadline}
                      onChange={(event) => update({ fillDeadline: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="quick-password">
                      填写密码
                    </label>
                    <input
                      id="quick-password"
                      className="input"
                      value={draft.fillPassword}
                      onChange={(event) => update({ fillPassword: event.target.value })}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.areaCoverage === 'shared'}
                      onChange={(event) => update({ areaCoverage: event.target.checked ? 'shared' : 'exclusive' })}
                    />
                    同组一人可兼顾多个区域
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.allowSameDayMultiple}
                      onChange={(event) => update({ allowSameDayMultiple: event.target.checked })}
                    />
                    允许同一人同日多班（时间不重叠）
                  </label>
                </div>
              </details>
            </div>

            <div className="card">
              <div className="card-title">2. 选择模板</div>
              {renderTemplateCards()}
            </div>

            <div className="card">
              <div className="card-title">3. 确认</div>
              <p className="text-sm">{summaryLine}</p>
              <p className="hint mt-1">日历：{calendarStatus}</p>
              {errors.length > 0 ? <div className="alert alert-error mt-2">{errors.slice(0, 6).join('；')}</div> : null}
              {generated.warnings.length > 0 ? (
                <div className="alert alert-info mt-2">{generated.warnings.slice(0, 4).join('；')}</div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="submit" className="btn btn-primary" disabled={pending || !canSubmit}>
                  {pending ? '创建中…' : '创建任务'}
                </button>
                <button type="button" className="btn" onClick={() => setMode('advanced')}>
                  去详细配置
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-1 border border-line bg-soft p-2">
              {['基本信息', '日历', '班次与区域', '需求预览', '确认创建'].map((title, index) => (
                <button
                  key={title}
                  type="button"
                  className={`border px-2 py-1 text-sm ${step === index + 1 ? 'border-brand bg-brand text-white' : 'border-line bg-white'}`}
                  onClick={() => setStep(index + 1)}
                >
                  {index + 1}. {title}
                </button>
              ))}
            </div>

            {step === 1 ? (
              <div className="card">
                <div className="card-title">第 1 步：基本信息</div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <label className="label">任务名称</label>
                    <input className="input" value={draft.name} onChange={(event) => update({ name: event.target.value })} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="label">任务说明</label>
                    <textarea
                      className="input h-20"
                      value={draft.description}
                      onChange={(event) => update({ description: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">开始日期</label>
                    <input type="date" className="input" value={draft.dateStart} onChange={(event) => update({ dateStart: event.target.value })} />
                  </div>
                  <div>
                    <label className="label">结束日期</label>
                    <input type="date" className="input" value={draft.dateEnd} onChange={(event) => update({ dateEnd: event.target.value })} />
                  </div>
                  <div>
                    <label className="label">填写截止时间</label>
                    <input
                      type="datetime-local"
                      className="input"
                      value={draft.fillDeadline}
                      onChange={(event) => update({ fillDeadline: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">填写密码</label>
                    <input className="input" value={draft.fillPassword} onChange={(event) => update({ fillPassword: event.target.value })} />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.areaCoverage === 'shared'}
                      onChange={(event) => update({ areaCoverage: event.target.checked ? 'shared' : 'exclusive' })}
                    />
                    同组一人可兼顾多个区域（shared）
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.allowSameDayMultiple}
                      onChange={(event) => update({ allowSameDayMultiple: event.target.checked })}
                    />
                    允许同一人同日多班（时间不重叠）
                  </label>
                  <div>
                    <label className="label">每人每时段最多兼顾区域数</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      className="input"
                      value={draft.maxAreasPerPerson}
                      onChange={(event) => update({ maxAreasPerPerson: Number(event.target.value) || 1 })}
                    />
                  </div>
                  <div>
                    <label className="label">“希望少排”默认上限（可空）</label>
                    <input
                      type="number"
                      min={0}
                      className="input"
                      value={draft.lessDefaultMax ?? ''}
                      onChange={(event) =>
                        update({ lessDefaultMax: event.target.value === '' ? null : Number(event.target.value) })
                      }
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-3">
                <div className="card">
                  <div className="card-title">第 2 步：日历（节假日与调休）</div>
                  <p className="text-sm">{calendarStatus}</p>
                  {calendarError ? <div className="alert alert-error mt-2">{calendarError}</div> : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        const url = `/api/admin/calendar?years=${years.join(',')}&refresh=1`;
                        setCalendarLoading(true);
                        fetch(url, { cache: 'no-store' })
                          .then(async (response) => {
                            const data = (await response.json()) as { ok?: boolean; error?: string; years?: CalendarYearState[] };
                            if (!response.ok || !data.ok) throw new Error(data.error ?? '刷新失败');
                            setCalendarYears(data.years ?? []);
                            setCalendarError(null);
                          })
                          .catch((error) => setCalendarError((error as Error).message))
                          .finally(() => setCalendarLoading(false));
                      }}
                      disabled={calendarLoading}
                    >
                      重新同步
                    </button>
                    <span className="hint">数据仅用于生成日期，最终会写入任务快照。</span>
                  </div>
                  <div className="mt-3">
                    <div className="section-title">今年/跨年日历明细</div>
                    <div className="max-h-52 overflow-y-auto border border-line p-2 text-sm">
                      {calendarEntries.length === 0 ? (
                        <p className="hint">暂无数据（可手动添加，或直接使用周末/星期规则）。</p>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {calendarEntries
                            .slice()
                            .sort((a, b) => a.date.localeCompare(b.date))
                            .map((entry) => (
                              <span
                                key={`${entry.date}-${entry.kind}`}
                                className={`border px-1 py-0.5 text-xs ${entry.kind === 'holiday' ? 'border-danger text-danger' : 'border-ok text-ok'}`}
                              >
                                {entry.date} {entry.kind === 'holiday' ? '休' : '班'}
                                {entry.name ? ` ${entry.name}` : ''}
                              </span>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 border border-line p-2">
                    <div className="section-title">自定义日期（优先级最高）</div>
                    <div className="flex flex-wrap items-end gap-2">
                      <input
                        type="date"
                        className="input max-w-[180px]"
                        value={newEntry.date}
                        onChange={(event) => setNewEntry((current) => ({ ...current, date: event.target.value }))}
                      />
                      <select
                        className="input max-w-[120px]"
                        value={newEntry.kind}
                        onChange={(event) =>
                          setNewEntry((current) => ({ ...current, kind: event.target.value as 'holiday' | 'workday' }))
                        }
                      >
                        <option value="holiday">放假</option>
                        <option value="workday">补班</option>
                      </select>
                      <input
                        className="input max-w-[180px]"
                        placeholder="名称（可选）"
                        value={newEntry.name}
                        onChange={(event) => setNewEntry((current) => ({ ...current, name: event.target.value }))}
                      />
                      <button type="button" className="btn btn-sm btn-primary" onClick={addManualCalendarEntry}>
                        添加
                      </button>
                    </div>
                    {(draft.calendar?.manualEntries ?? []).length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(draft.calendar?.manualEntries ?? []).map((entry) => (
                          <span key={entry.date} className="border border-brand px-1 py-0.5 text-xs">
                            {entry.date} {entry.kind === 'holiday' ? '休' : '班'}
                            <button
                              type="button"
                              className="ml-1 text-danger"
                              onClick={() => removeManualCalendarEntry(entry.date)}
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="hint mt-1">没有自定义条目。</p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="card">
                <div className="card-title">第 3 步：班次与区域</div>
                <div className="space-y-3">
                  {draft.shifts.map((shift, shiftIndex) => (
                    <div key={shiftIndex} className="border border-line p-3">
                      <div className="grid gap-2 md:grid-cols-[1fr_110px_110px_180px_auto]">
                        <div>
                          <label className="label">班次名称</label>
                          <input
                            className="input"
                            value={shift.name}
                            onChange={(event) => updateShift(shiftIndex, { name: event.target.value })}
                          />
                        </div>
                        <div>
                          <label className="label">开始</label>
                          <input
                            type="time"
                            className="input"
                            value={shift.startTime}
                            onChange={(event) => updateShift(shiftIndex, { startTime: event.target.value })}
                          />
                        </div>
                        <div>
                          <label className="label">结束</label>
                          <input
                            type="time"
                            className="input"
                            value={shift.endTime}
                            onChange={(event) => updateShift(shiftIndex, { endTime: event.target.value })}
                          />
                        </div>
                        <div>
                          <label className="label">日期规则</label>
                          <select
                            className="input"
                            value={matchPreset(shift)}
                            onChange={(event) => {
                              if (event.target.value === 'custom') return;
                              setRulePreset(shiftIndex, event.target.value as DateRulePresetKey);
                            }}
                          >
                            {(Object.keys(DATE_RULE_PRESETS) as DateRulePresetKey[]).map((key) => (
                              <option key={key} value={key}>
                                {DATE_RULE_PRESETS[key].label}
                              </option>
                            ))}
                            <option value="custom">自定义</option>
                          </select>
                        </div>
                        <div className="flex items-end">
                          <button type="button" className="btn btn-danger btn-sm" onClick={() => removeShift(shiftIndex)}>
                            删除班次
                          </button>
                        </div>
                      </div>
                      <p className="hint mt-1">{DATE_RULE_PRESETS[matchPreset(shift) as DateRulePresetKey]?.description ?? ''}</p>

                      {shift.dateRule.eveOfWorkday ? null : (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {WEEKDAY_LABELS.map((day) => (
                            <label key={day.value} className="flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={shift.dateRule.weekdays.includes(day.value)}
                                onChange={(event) => {
                                  const weekdays = event.target.checked
                                    ? [...new Set([...shift.dateRule.weekdays, day.value])].sort()
                                    : shift.dateRule.weekdays.filter((value) => value !== day.value);
                                  updateShift(shiftIndex, { dateRule: { ...shift.dateRule, weekdays } });
                                }}
                              />
                              {day.label}
                            </label>
                          ))}
                        </div>
                      )}

                      <div className="mt-3 border border-line p-2">
                        <div className="flex items-center justify-between">
                          <div className="section-title">区域（{shift.areas.length}）</div>
                          <button type="button" className="btn btn-sm" onClick={() => addArea(shiftIndex)}>
                            + 添加区域
                          </button>
                        </div>
                        <div className="mt-2 space-y-1">
                          {shift.areas.map((area, areaIndex) => (
                            <div key={areaIndex} className="grid gap-2 md:grid-cols-[1fr_1fr_100px_auto]">
                              <input
                                className="input"
                                value={area.name}
                                placeholder="区域名称"
                                onChange={(event) => {
                                  const areas = shift.areas.map((item, i) =>
                                    i === areaIndex ? { ...item, name: event.target.value } : item,
                                  );
                                  updateShift(shiftIndex, { areas });
                                }}
                              />
                              <input
                                className="input"
                                value={area.groupName}
                                placeholder="距离组"
                                onChange={(event) => {
                                  const areas = shift.areas.map((item, i) =>
                                    i === areaIndex ? { ...item, groupName: event.target.value } : item,
                                  );
                                  updateShift(shiftIndex, { areas });
                                }}
                              />
                              <input
                                type="number"
                                min={0}
                                max={500}
                                className="input"
                                value={area.defaultHeadcount}
                                onChange={(event) => {
                                  const areas = shift.areas.map((item, i) =>
                                    i === areaIndex ? { ...item, defaultHeadcount: Number(event.target.value) || 0 } : item,
                                  );
                                  updateShift(shiftIndex, { areas });
                                }}
                              />
                              <button type="button" className="btn btn-danger btn-sm" onClick={() => removeArea(shiftIndex, areaIndex)}>
                                删除
                              </button>
                            </div>
                          ))}
                        </div>
                        <p className="hint mt-1">同一距离组内，一个人可兼顾多个区域；跨组同一时段不允许兼顾。</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="btn" onClick={addShift}>
                    + 添加班次
                  </button>
                  <span className="hint">最多 {MAX_DRAFT_SHIFTS} 个班次、每班次最多 {MAX_DRAFT_AREAS} 个区域。</span>
                </div>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="card">
                <div className="card-title">第 4 步：需求预览与微调</div>
                <p className="text-sm">{summaryLine}</p>
                {generated.warnings.length > 0 ? (
                  <div className="alert alert-info mt-2">{generated.warnings.slice(0, 5).join('；')}</div>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1">
                  {draft.shifts.map((shift, index) => (
                    <button
                      key={index}
                      type="button"
                      className={`border px-2 py-1 text-sm ${activeShiftTab === index ? 'border-brand bg-brand text-white' : 'border-line bg-white'}`}
                      onClick={() => setActiveShiftTab(index)}
                    >
                      {shift.name}（{shiftDateCounts[index] ?? 0} 天）
                    </button>
                  ))}
                </div>
                {draft.shifts[activeShiftTab] ? (
                  <div className="scroll-x mt-2 max-h-[520px] overflow-y-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th className="nowrap">日期</th>
                          {draft.shifts[activeShiftTab].areas.map((area, areaIndex) => (
                            <th key={areaIndex} className="nowrap">
                              {area.name}
                              <div className="hint font-normal">{area.defaultHeadcount} 人</div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewDates.map((date) => (
                          <tr key={date}>
                            <td className="nowrap">{date}</td>
                            {draft.shifts[activeShiftTab].areas.map((area, areaIndex) => (
                              <td key={areaIndex} className="nowrap">
                                <input
                                  type="number"
                                  min={0}
                                  max={500}
                                  className="input w-16"
                                  value={headcountFor(activeShiftTab, areaIndex, date)}
                                  onChange={(event) =>
                                    setHeadcount(activeShiftTab, areaIndex, date, event.target.value)
                                  }
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                <p className="hint mt-2">
                  只保存与默认人数不同的单元格；切换班次可分别调整。填写端只会看到“本时段需 X 人”。
                </p>
              </div>
            ) : null}

            {step === 5 ? (
              <div className="card">
                <div className="card-title">第 5 步：确认创建</div>
                <table className="table">
                  <tbody>
                    <tr>
                      <th className="w-40">任务名称</th>
                      <td>{draft.name || '（未填写）'}</td>
                    </tr>
                    <tr>
                      <th>日期范围</th>
                      <td>
                        {draft.dateStart} ~ {draft.dateEnd}
                      </td>
                    </tr>
                    <tr>
                      <th>班次 / 区域</th>
                      <td>
                        {draft.shifts.length} 个班次 / {draft.shifts.reduce((sum, shift) => sum + shift.areas.length, 0)} 个区域
                      </td>
                    </tr>
                    <tr>
                      <th>预计需求</th>
                      <td>{generated.summary.totalRequired} 人次（{generated.summary.cells} 个单元格）</td>
                    </tr>
                    <tr>
                      <th>日历</th>
                      <td>{calendarStatus}</td>
                    </tr>
                  </tbody>
                </table>
                {errors.length > 0 ? <div className="alert alert-error mt-2">{errors.slice(0, 8).join('；')}</div> : null}
                {generated.warnings.length > 0 ? (
                  <div className="alert alert-info mt-2">{generated.warnings.join('；')}</div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="submit" className="btn btn-primary" disabled={pending || !canSubmit}>
                    {pending ? '创建中…' : '确认创建任务'}
                  </button>
                  <button type="button" className="btn" onClick={() => setStep(4)}>
                    返回修改
                  </button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" disabled={step <= 1} onClick={() => setStep((value) => Math.max(1, value - 1))}>
                上一步
              </button>
              <button
                type="button"
                className="btn"
                disabled={step >= 5 || !stepValid(step)}
                onClick={() => setStep((value) => Math.min(5, value + 1))}
              >
                下一步
              </button>
              {stepValid(step) ? null : <span className="hint text-danger self-center">请先完成本步必填项</span>}
              <button type="submit" className="btn btn-primary" disabled={pending || !canSubmit}>
                {pending ? '创建中…' : '直接创建'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
