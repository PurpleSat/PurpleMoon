import { NextRequest, NextResponse } from 'next/server';

import { checkCsrf } from '@/lib/csrf-guard';

export const runtime = 'edge';

// 严格遵守 RESTful 与安全规范，登出改变了会话状态，仅允许 POST 请求，并执行 CSRF 校验
export async function POST(request: NextRequest) {
  // 🛡️ 安全加固 (SEC-10)：防范跨站注销 (Logout CSRF)
  const csrf = checkCsrf(request, { requireJsonContentType: false });
  if (!csrf.ok) return csrf.response!;

  const response = NextResponse.json({ ok: true });
  const isProduction = process.env.NODE_ENV === 'production';
  
  const options = { 
    path: '/', 
    expires: new Date(0), // 设置过期时间为 1970 年，即立即删除
    sameSite: 'lax' as const, 
    secure: isProduction 
  };
  
  // 清除核心鉴权 Cookie (保持 HttpOnly 特性)
  response.cookies.set('auth', '', { ...options, httpOnly: true });
  
  // 清除前端 UI 状态 Cookie (客户端可访问)
  response.cookies.set('user_info', '', { ...options, httpOnly: false });
  
  return response;
}
