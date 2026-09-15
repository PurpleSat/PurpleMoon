/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';

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

  // localstorage模式：在middleware中完成验证 (单用户模式，拥有密码即拥有所有权限)
  if (storageType === 'localstorage') {
    if (!authInfo.password || authInfo.password !== process.env.PASSWORD) {
      return handleAuthFailure(request, pathname);
    }
    return NextResponse.next();
  }

  // 其他模式（数据库/Redis/D1）：严格验证防篡改签名
  // 【安全升级 1】：强制校验 username、signature、timestamp 和 role 是否完整
  if (!authInfo.username || !authInfo.signature || !authInfo.timestamp || !authInfo.role) {
    return handleAuthFailure(request, pathname);
  }

  // ================= 防 Cookie 伪造与重放攻击 (修复漏洞 6) =================
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000; // 7天的毫秒数
  // 此时暂不信任 authInfo.timestamp，先做初步过滤。只有下方验签通过，证明时间戳未被篡改，此次校验才算定论
  if (Date.now() - authInfo.timestamp > SEVEN_DAYS_MS) {
    console.warn(`拦截到过期的 Cookie，用户: ${authInfo.username}`);
    return handleAuthFailure(request, pathname);
  }
  // =========================================================================

  // 验证签名
  // ================= 密钥安全隔离 (修复漏洞 2) =================
  // 优先使用独立的 AUTH_SECRET 进行验签，防御对登录密码的反向破解
  const signingKey = process.env.AUTH_SECRET || process.env.PASSWORD || '';
  // =============================================================

  // 【核心安全升级】：将 timestamp 和 role 加入签名负载，与 login/route.ts 签发逻辑完美对齐
  const payloadToVerify = `${authInfo.username}:${authInfo.timestamp}:${authInfo.role}`;

  const isValidSignature = await verifySignature(
    payloadToVerify,
    authInfo.signature,
    signingKey
  );

  // 签名验证通过
  if (isValidSignature) {
    
    // ================= 严格越权访问拦截 (修复漏洞 1) =================
    // 拦截所有试图访问 /admin 和 /api/admin 的非站长用户
    if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
      // 【安全升级】：由于签名机制的保障，这里的 role 字段是绝对可信的
      if (authInfo.role !== 'admin') {
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

  // 签名验证失败 (代表用户篡改了 username、timestamp 或 role 的值)
  console.warn(`拦截到非法篡改的 Cookie 负载，用户: ${authInfo.username}`);
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
    console.error('签名验证过程出错:', error);
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
