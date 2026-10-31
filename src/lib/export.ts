import { NextResponse } from 'next/server';
import { buildCsv } from '@/lib/csv';
import { buildXlsx, type SheetData } from '@/lib/xlsx';

export type ExportFormat = 'csv' | 'xlsx' | 'json';

export function parseFormat(value: string | null, fallback: ExportFormat = 'csv'): ExportFormat {
  if (value === 'xlsx' || value === 'csv' || value === 'json') return value;
  return fallback;
}

function timestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function asciiFallback(name: string): string {
  return name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '');
}

/** 生成下载响应（CSV 带 UTF-8 BOM，兼容 Excel 直接打开中文） */
export async function downloadResponse(options: {
  format: ExportFormat;
  fileName: string;
  headers: string[];
  rows: Array<Array<string | number | null>>;
  sheets?: SheetData[];
  json?: unknown;
}): Promise<NextResponse> {
  const { format, fileName } = options;

  if (format === 'json') {
    return NextResponse.json(options.json ?? { ok: true, rows: options.rows });
  }

  const fullName = `${fileName}-${timestamp()}`;
  const encoded = encodeURIComponent(`${fullName}.${format}`);
  const contentDisposition = `attachment; filename="${asciiFallback(fullName)}.${format}"; filename*=UTF-8''${encoded}`;

  if (format === 'xlsx') {
    const sheets: SheetData[] =
      options.sheets && options.sheets.length > 0
        ? options.sheets
        : [{ name: '数据', rows: [options.headers, ...options.rows], headerRow: true }];
    const buffer = await buildXlsx(sheets);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': contentDisposition,
        'Cache-Control': 'no-store',
      },
    });
  }

  const csv = buildCsv([options.headers, ...options.rows]);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': contentDisposition,
      'Cache-Control': 'no-store',
    },
  });
}
