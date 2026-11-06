'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createTaskFromDraftAction } from '../task-actions';
import { createDraftFromTemplate } from '@/lib/task-draft';

const KEY = 'sched-onboarding-dismissed-v1';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dateAfter(days: number): string {
  const date = new Date(Date.now() + days * 86400000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export default function OnboardingCard() {
  const [dismissed, setDismissed] = useState(false);
  const [sampleDraft, setSampleDraft] = useState('');

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  useEffect(() => {
    const draft = createDraftFromTemplate('evening');
    setSampleDraft(
      JSON.stringify({
        ...draft,
        name: '示例任务：晚自习值班',
        description: '由新手引导创建的示例任务，可随时删除',
        dateStart: dateAfter(1),
        dateEnd: dateAfter(7),
        fillDeadline: `${dateAfter(5)}T18:00`,
        fillPassword: 'demo1234',
      }),
    );
  }, []);

  if (dismissed) return null;

  return (
    <div className="card border-brand">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="card-title mb-0 border-0 pb-0">新手引导：从 0 到发布只需四步</div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            setDismissed(true);
            try {
              window.localStorage.setItem(KEY, '1');
            } catch {
              /* ignore */
            }
          }}
        >
          不再显示
        </button>
      </div>
      <ol className="mt-3 grid gap-2 text-sm md:grid-cols-4">
        <li className="border border-line p-2">
          <div className="font-bold">1. 创建任务</div>
          <p className="hint">名称 + 日期 + 模板，3 项即可；日历自动获取。</p>
          <Link className="underline" href="/admin/tasks/new">
            去创建
          </Link>
        </li>
        <li className="border border-line p-2">
          <div className="font-bold">2. 发布并复制链接</div>
          <p className="hint">在任务详情页发布，复制链接与填写密码。</p>
          <span className="hint">任务详情 → 填写链接与密码</span>
        </li>
        <li className="border border-line p-2">
          <div className="font-bold">3. 等待填写</div>
          <p className="hint">查看已填/未填、名单核对与无法排班理由。</p>
          <span className="hint">任务详情 → 填写情况</span>
        </li>
        <li className="border border-line p-2">
          <div className="font-bold">4. 截止确认并匹配</div>
          <p className="hint">确认后自动匹配，可手动调整与导出。</p>
          <span className="hint">任务详情 → 自动匹配</span>
        </li>
      </ol>
      <form action={createTaskFromDraftAction} className="mt-3">
        <input type="hidden" name="draft" value={sampleDraft} />
        <button type="submit" className="btn btn-sm" disabled={!sampleDraft}>
          一键创建示例任务（7 天晚自习，含 3 个区域）
        </button>
        <span className="hint ml-2">创建后可直接删除，不影响正式数据。</span>
      </form>
    </div>
  );
}
