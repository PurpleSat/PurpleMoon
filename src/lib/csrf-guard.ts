/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

export type CsrfCheckResult =
  | { ok: true; response?: undefined }
  | { ok: false; response: NextResponse };

export function checkCsrf(
  request: NextRequest,
  options: { requireJsonContentType?: boolean } = {}
): CsrfCheckResult {
  const { requireJsonContentType = true } = options;
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');

  // 🛡️ 安全加固 (SEC-NEW-04)：优先校验 Fetch Metadata 请求头，拦截显式跨站请求
  const secFetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (secFetchSite && secFetchSite === 'cross-site') {
    console.warn(`[CSRF 拦截] 接口 ${request.nextUrl.pathname} 遇到 cross-site 请求`);
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Forbidden: Cross-Site Request' },
        { status: 403 }
      ),
    };
  }

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
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Forbidden: Invalid Origin' },
          { status: 403 }
        ),
      };
    }
  } else {
    // 🛡️ 安全加固 (SEC-10)：当 Origin 头缺失时，兜底校验 Referer 头的主机名一致性
    const referer = request.headers.get('referer');
    if (referer) {
      try {
        if (new URL(referer).host !== host) {
          console.warn(`[CSRF 拦截] 接口 ${request.nextUrl.pathname} 遇到异常的 Referer: ${referer}`);
          return {
            ok: false,
            response: NextResponse.json(
              { error: 'Forbidden: Invalid Referer' },
              { status: 403 }
            ),
          };
        }
      } catch {
        return {
          ok: false,
          response: NextResponse.json(
            { error: 'Forbidden: Invalid Referer' },
            { status: 403 }
          ),
        };
      }
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
