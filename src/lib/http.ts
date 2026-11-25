import { NextResponse } from 'next/server';
import { ApiError, messageOf } from './errors';

/** 全局请求体上限（备份导入这类大 payload 用）。 */
export const MAX_BODY = 8 * 1024 * 1024;
/**
 * 单个同步 push 的上限。ops 最多 500 条，正常请求远小于 2MB；
 * 收紧到 2MB 可以更早拒绝异常大包，backup/import 仍沿用 MAX_BODY。
 * 阈值集中在本文件，路由通过 readJson(req, maxBytes) 按需收紧。
 */
export const MAX_SYNC_BODY = 2 * 1024 * 1024;

export function json(data: unknown, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(data, { status, headers });
}

export function fail(err: unknown) {
  if (err instanceof ApiError) {
    return json({ ok: false, error: err.code, message: messageOf(err.code) }, err.status, err.headers);
  }
  console.error('[api] unhandled', err);
  return json({ ok: false, error: 'internal_error', message: messageOf('internal_error') }, 500);
}

export async function readJson(req: Request, maxBytes = MAX_BODY): Promise<Record<string, unknown>> {
  let raw = '';
  try { raw = await req.text(); } catch { throw new ApiError(400, 'invalid_json'); }
  if (raw.length > maxBytes) throw new ApiError(413, 'payload_too_large');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw new ApiError(400, 'invalid_json');
  }
}

export function requireName(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._-]{1,64}$/.test(value)) {
    throw new ApiError(400, 'bad_' + field);
  }
  return value;
}

export function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get('x-forwarded-proto');
  return proto === 'https' || new URL(req.url).protocol === 'https:';
}
