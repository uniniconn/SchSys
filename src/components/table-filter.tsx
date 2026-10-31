'use client';

import { useState } from 'react';

type Props = {
  /** 左侧栏显示的键（如姓名 / 日期） */
  readonly?: boolean;
  className?: string;
};

/**
 * 纯前端筛选/搜索输入框：通过 data 属性驱动同容器内的表格行显隐。
 * 用于「无法排班理由汇总」的搜索与筛选（无需刷新页面）。
 */
export default function TableFilter({
  targetId,
  fields,
  placeholder = '输入关键字搜索…',
}: {
  targetId: string;
  fields: string[];
  placeholder?: string;
}) {
  const [keyword, setKeyword] = useState('');

  const apply = (value: string) => {
    setKeyword(value);
    const table = document.getElementById(targetId);
    if (!table) return;
    const needle = value.trim().toLowerCase();
    const rows = table.querySelectorAll<HTMLTableRowElement>('tbody tr');
    rows.forEach((row) => {
      const haystack = fields
        .map((field) => row.getAttribute(`data-${field}`) ?? '')
        .join(' ')
        .toLowerCase();
      row.style.display = !needle || haystack.includes(needle) ? '' : 'none';
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 no-print">
      <input
        className="input max-w-xs"
        value={keyword}
        placeholder={placeholder}
        onChange={(event) => apply(event.target.value)}
      />
      {keyword ? (
        <button type="button" className="btn btn-sm" onClick={() => apply('')}>
          清除
        </button>
      ) : null}
    </div>
  );
}

export type { Props };
