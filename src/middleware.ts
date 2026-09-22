/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie, verifyAuthSignature } from '@/lib/auth';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 跳过不需要认证的路径
  if (shouldSkipAuth(pathname)) {
    return NextResponse.next();
  }

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  // 如果没有设置密码，直接放行
  if (storageType === 'localstorage' && !process.env.PASSWORD) {
    return NextResponse.next();
  }

  // 从cookie获取认证信息
  const authInfo = getAuthInfoFromCookie(request);

  if (!authInfo) {
    return handleAuthFailure(request, pathname);
  }

  // 强制校验 username、signature、timestamp 和 role 是否完整
  if (!authInfo.username || !authInfo.signature || !authInfo.timestamp || !authInfo.role) {
    return handleAuthFailure(request, pathname);
  }

  // ================= 防 Cookie 伪造与重放攻击 =================
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000; // 7天的毫秒数
  if (Date.now() - authInfo.timestamp > SEVEN_DAYS_MS) {
    console.warn(`拦截到过期的 Cookie，用户: ${authInfo.username}`);
    return handleAuthFailure(request, pathname);
  }
  // =========================================================================

  // 调用 lib/auth.ts 中标准的高强度验签逻辑
  const isValidSignature = await verifyAuthSignature(
    authInfo.username,
    authInfo.timestamp,
    authInfo.role,
    authInfo.signature
  );

  // 签名验证通过
  if (isValidSignature) {
    // ================= 严格越权访问拦截 =================
    if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
      if (authInfo.role !== 'admin' && authInfo.role !== 'owner') {
        console.warn(`越权拦截: 普通用户 ${authInfo.username} 尝试访问后台 ${pathname}`);
        
        if (pathname.startsWith('/api/')) {
          return NextResponse.json({ error: '越权拦截：权限不足，仅管理员或站长可操作' }, { status: 403 });
        }
        return NextResponse.redirect(new URL('/', request.url));
      }
    }
    // ==================================================================

    return NextResponse.next();
  }

  // 签名验证失败
  console.warn(`拦截到非法篡改的 Cookie 负载，用户: ${authInfo.username}`);
  return handleAuthFailure(request, pathname);
}

// 处理认证失败的情况
function handleAuthFailure(
  request: NextRequest,
  pathname: string
): NextResponse {
  if (pathname.startsWith('/api')) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  const fullUrl = `${pathname}${request.nextUrl.search}`;
  loginUrl.searchParams.set('redirect', fullUrl);
  return NextResponse.redirect(loginUrl);
}

// 判断是否需要跳过认证的路径
function shouldSkipAuth(pathname: string): boolean {
  const skipPaths = [
    '/_next',
    '/favicon.ico',
    '/robots.txt',
    '/manifest.json',
    '/icons/',
    '/logo.png',
    '/screenshot.png',
  ];

  return skipPaths.some((path) => pathname.startsWith(path));
}

// 配置middleware匹配规则
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login|api/login|api/register|api/logout|api/cron|api/server-config).*)',
  ],
};
