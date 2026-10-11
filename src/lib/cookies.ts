/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { signAuthPayload } from '@/lib/auth';

const SESSION_DAYS = 7;

/**
 * 判断本次请求是否应下发 Secure Cookie。
 *
 * - COOKIE_SECURE=true / false 可显式覆盖（适用于任何反向代理场景）。
 * - 生产环境默认：请求实际经由 HTTPS（x-forwarded-proto 或请求协议）才加 Secure。
 *   以前无条件加 Secure，导致通过 http://IP:3000 直连（README 的 Docker 示例）时
 *   浏览器丢弃 Cookie，表现为“登录成功但立刻被踢回登录页”。
 */
export function isSecureRequest(request: NextRequest): boolean {
  const override = (process.env.COOKIE_SECURE || '').trim().toLowerCase();
  if (override === 'true') return true;
  if (override === 'false') return false;
  if (process.env.NODE_ENV !== 'production') return false;

  const forwarded = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  if (forwarded) return forwarded === 'https';
  return request.nextUrl.protocol === 'https:';
}

export async function buildAuthCookieValue(
  username: string,
  role: string
): Promise<string> {
  const timestamp = Date.now();
  const signature = await signAuthPayload(username, timestamp, role);
  return encodeURIComponent(
    JSON.stringify({ username, role, timestamp, signature })
  );
}

/** 同时下发 HttpOnly 的签名会话 Cookie 与仅供 UI 展示的 user_info Cookie */
export function setAuthCookies(
  response: NextResponse,
  request: NextRequest,
  authValue: string,
  username: string,
  role: string
) {
  const secure = isSecureRequest(request);
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  response.cookies.set('auth', authValue, {
    path: '/',
    expires,
    sameSite: 'lax',
    httpOnly: true,
    secure,
  });
  response.cookies.set(
    'user_info',
    encodeURIComponent(JSON.stringify({ username, role })),
    { path: '/', expires, sameSite: 'lax', httpOnly: false, secure }
  );
}

export function clearAuthCookies(response: NextResponse, request: NextRequest) {
  const secure = isSecureRequest(request);
  const opts = {
    path: '/',
    expires: new Date(0),
    sameSite: 'lax' as const,
    secure,
  };
  response.cookies.set('auth', '', { ...opts, httpOnly: true });
  response.cookies.set('user_info', '', { ...opts, httpOnly: false });
}

/** 读取体积受限的 JSON 请求体，避免超大请求占用内存/CPU */
export async function readLimitedJson(
  request: NextRequest,
  maxBytes = 8 * 1024
): Promise<{ ok: true; data: any } | { ok: false; status: number; error: string }> {
  const declared = Number(request.headers.get('content-length') || '0');
  if (declared > maxBytes) {
    return { ok: false, status: 413, error: '请求体过大' };
  }
  try {
    const text = await request.text();
    if (text.length > maxBytes) {
      return { ok: false, status: 413, error: '请求体过大' };
    }
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: '请求格式错误' };
  }
}
