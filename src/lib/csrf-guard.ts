/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

export interface CsrfCheckResult {
  ok: boolean;
  response?: NextResponse;
}

export function checkCsrf(
  request: NextRequest,
  options: { requireJsonContentType?: boolean } = {}
): CsrfCheckResult {
  const { requireJsonContentType = true } = options;
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');

  if (origin) {
    try {
      if (new URL(origin).host !== host) {
        console.warn(`[CSRF 拦截] 接口 ${request.nextUrl.pathname} 遇到异常的 Origin: ${origin}`);
        return {
          ok: false,
          response: NextResponse.json(
            { error: 'Forbidden: Invalid Origin' },
            { status: 403 }
          ),
        };
      }
    } catch {
      // Origin 头格式非法，视为可疑请求一并拦截
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Forbidden: Invalid Origin' },
          { status: 403 }
        ),
      };
    }
  }

  if (requireJsonContentType) {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Unsupported Media Type: must be application/json' },
          { status: 415 }
        ),
      };
    }
  }

  return { ok: true };
}
