'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';

/** 可折叠面板（纯色背景 + 边框，无动画过渡、无阴影） */
export default function Collapsible({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-line">
      <button
        type="button"
        className="flex w-full items-center justify-between bg-soft px-3 py-2 text-left text-sm font-bold"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span>{title}</span>
        <span className="text-xs font-normal text-ink-soft">{open ? '收起 ▲' : '展开 ▼'}</span>
      </button>
      {open ? <div className="border-t border-line p-3">{children}</div> : null}
    </div>
  );
}
