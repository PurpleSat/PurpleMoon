import { NextRequest, NextResponse } from 'next/server';

import { clearAuthCookies } from '@/lib/cookies';
import { checkCsrf } from '@/lib/csrf-guard';

export const runtime = 'edge';

// 登出改变了会话状态，仅允许 POST 请求，并执行 CSRF 校验
export async function POST(request: NextRequest) {
  // 🛡️ 安全加固 (SEC-10)：防范跨站注销 (Logout CSRF)
  const csrf = checkCsrf(request, { requireJsonContentType: false });
  if (!csrf.ok) return csrf.response!;

  const response = NextResponse.json({ ok: true });
  clearAuthCookies(response, request);
  return response;
}
