'use client';

export default function PrintButton() {
  return (
    <button type="button" className="btn btn-primary" onClick={() => window.print()}>
      打印排班表
    </button>
  );
}
