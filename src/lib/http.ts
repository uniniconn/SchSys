import { NextResponse } from 'next/server';

export function json<T>(data: T, init?: number | ResponseInit) {
  const responseInit = typeof init === 'number' ? { status: init } : init;
  return NextResponse.json(data as object, responseInit);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export function ok(data: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: true, ...data });
}

/** 从 BASE_URL 或请求头推导站点根地址（用于生成填写链接） */
export function resolveBaseUrl(headers?: Headers): string {
  const configured = process.env.BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (headers) {
    const host = headers.get('x-forwarded-host') ?? headers.get('host');
    if (host) {
      const proto = headers.get('x-forwarded-proto') ?? 'http';
      return `${proto}://${host}`;
    }
  }
  return 'http://localhost:3000';
}

export function fillUrl(token: string, headers?: Headers): string {
  return `${resolveBaseUrl(headers)}/fill/${token}`;
}
