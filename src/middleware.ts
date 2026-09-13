/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // 1. 获取请求的路径
  const { pathname } = request.nextUrl;

  // 2. 边缘节点高速嗅探 HTTP Cookie 中的凭证
  // Middleware 运行在服务端，无法读取 localStorage，必须通过 Cookie 鉴权
  const hasToken = 
    request.cookies.has('token') || 
    request.cookies.has('user_token') || 
    request.cookies.has('session') ||
    request.cookies.has('user');

  // 3. 如果没有凭证，直接在边缘节点进行 307 重定向拦截
  if (!hasToken) {
    const loginUrl = new URL('/login', request.url);
    // 携带 callbackUrl，方便登录后跳回解析页
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 4. 验证通过，放行请求
  return NextResponse.next();
}

// 配置匹配器：告诉 Next.js 只有访问 /parser 时才触发此中间件
export const config = {
  matcher: [
    '/parser/:path*',
    // 如果未来你想保护播放页，可以取消下面这行的注释
    // '/play/:path*', 
  ],
};

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

  // localstorage模式：在middleware中完成验证
  if (storageType === 'localstorage') {
    if (!authInfo.password || authInfo.password !== process.env.PASSWORD) {
      return handleAuthFailure(request, pathname);
    }
    return NextResponse.next();
  }

  // 其他模式：只验证签名
  // 检查是否有用户名（非localStorage模式下密码不存储在cookie中）
  if (!authInfo.username || !authInfo.signature) {
    return handleAuthFailure(request, pathname);
  }

  // ================= 防 Cookie 伪造与重放攻击 (修复漏洞 6) =================
  if (authInfo.timestamp) {
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000; // 7天的毫秒数
    if (Date.now() - authInfo.timestamp > SEVEN_DAYS_MS) {
      console.warn(`拦截到过期的 Cookie，用户: ${authInfo.username}`);
      return handleAuthFailure(request, pathname);
    }
  }
  // =========================================================================

  // 验证签名（如果存在）
  if (authInfo.signature) {
    // ================= 密钥安全隔离 (修复漏洞 2) =================
    // 优先使用独立的 AUTH_SECRET 进行验签，防御对登录密码的反向破解
    const signingKey = process.env.AUTH_SECRET || process.env.PASSWORD || '';
    // =============================================================

    const isValidSignature = await verifySignature(
      authInfo.username,
      authInfo.signature,
      signingKey
    );

    // 签名验证通过
    if (isValidSignature) {
      
      // ================= 严格越权访问拦截 (修复漏洞 1) =================
      // 拦截所有试图访问 /admin 和 /api/admin 的非站长用户
      if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
        if (authInfo.username !== process.env.USERNAME) {
          console.warn(`越权拦截: 普通用户 ${authInfo.username} 尝试访问后台 ${pathname}`);
          
          if (pathname.startsWith('/api/')) {
            // 如果是 API 请求，直接返回 403 权限拒绝
            return NextResponse.json({ error: '越权拦截：权限不足，仅站长可操作' }, { status: 403 });
          }
          // 如果是页面请求，将其强制踢回首页
          return NextResponse.redirect(new URL('/', request.url));
        }
      }
      // ==================================================================

      return NextResponse.next();
    }
  }

  // 签名验证失败或不存在签名
  return handleAuthFailure(request, pathname);
}

// 验证签名
async function verifySignature(
  data: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  try {
    // 导入密钥
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // 将十六进制字符串转换为Uint8Array
    const signatureBuffer = new Uint8Array(
      signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
    );

    // 验证签名
    return await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBuffer,
      messageData
    );
  } catch (error) {
    console.error('签名验证失败:', error);
    return false;
  }
}

// 处理认证失败的情况
function handleAuthFailure(
  request: NextRequest,
  pathname: string
): NextResponse {
  // 如果是 API 路由，返回 401 状态码
  if (pathname.startsWith('/api')) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // 否则重定向到登录页面
  const loginUrl = new URL('/login', request.url);
  // 保留完整的URL，包括查询参数
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
