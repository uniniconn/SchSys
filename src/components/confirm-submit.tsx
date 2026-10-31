'use client';

import type { ReactNode } from 'react';

/** 需要二次确认的提交按钮（禁用透明度/阴影等立体效果） */
export default function ConfirmSubmit({
  message,
  children,
  className = 'btn',
  name,
  value,
  disabled,
  title,
}: {
  message: string;
  children: ReactNode;
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={className}
      disabled={disabled}
      title={title}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
