/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { signAuthPayload, verifyAuthSignature } from '@/lib/auth';

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

// ---------------------------------------------------------------------------
// 设备信任 Cookie（防“伪造 IP 刷满账号上限把本人锁在门外”）
//
// 登录成功后给该设备下发一个签名 Cookie；之后同一设备登录时，账号级总上限不再拦截它
// （“账号+IP”桶与单 IP 限流仍然生效）。没有该 Cookie 的暴力破解仍被账号级上限挡住。
// ---------------------------------------------------------------------------
const DEVICE_TRUST_DAYS = 30;
const DEVICE_TRUST_ROLE = 'devtrust';

function normalizeTrustAccount(username: string): string {
  return username.toLowerCase().slice(0, 64);
}

function deviceTrustCookieName(username: string): string {
  const hex = Array.from(new TextEncoder().encode(normalizeTrustAccount(username)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `dt_${hex}`;
}

function deviceTrustSigner(username: string): string {
  // 与会话 Cookie 的签名内容隔离：用户名带 devtrust| 前缀、角色固定为 devtrust
  return `devtrust|${normalizeTrustAccount(username)}`;
}

export async function setDeviceTrustCookie(
  response: NextResponse,
  request: NextRequest,
  username: string
): Promise<void> {
  const timestamp = Date.now();
  const signature = await signAuthPayload(
    deviceTrustSigner(username),
    timestamp,
    DEVICE_TRUST_ROLE
  );
  response.cookies.set(
    deviceTrustCookieName(username),
    `${timestamp}.${signature}`,
    {
      path: '/',
      expires: new Date(timestamp + DEVICE_TRUST_DAYS * 24 * 60 * 60 * 1000),
      sameSite: 'lax',
      httpOnly: true,
      secure: isSecureRequest(request),
    }
  );
}

export async function hasDeviceTrust(
  request: NextRequest,
  username: string
): Promise<boolean> {
  const raw = request.cookies.get(deviceTrustCookieName(username))?.value;
  if (!raw) return false;
  const dot = raw.indexOf('.');
  if (dot <= 0) return false;
  const timestamp = Number(raw.slice(0, dot));
  const signature = raw.slice(dot + 1);
  if (!Number.isFinite(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const age = Date.now() - timestamp;
  if (age < 0 || age > DEVICE_TRUST_DAYS * 24 * 60 * 60 * 1000) return false;
  return verifyAuthSignature(
    deviceTrustSigner(username),
    timestamp,
    DEVICE_TRUST_ROLE,
    signature
  );
}
