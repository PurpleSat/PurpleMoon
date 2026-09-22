/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { resetConfig } from '@/lib/config';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  // ==========================================
  // 🛡️ CSRF 纵深防御第一道防线：Origin 校验
  // ==========================================
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  // 如果请求带有 Origin 且与当前主机的 host 不匹配，直接拦截
  if (origin && new URL(origin).host !== host) {
    console.warn(`[CSRF 拦截] 配置重置接口遇到异常的 Origin: ${origin}`);
    return NextResponse.json({ error: 'Forbidden: Invalid Origin' }, { status: 403 });
  }

  // ==========================================
  // 🛡️ CSRF 纵深防御第二道防线：Content-Type 校验
  // 跨站表单 (<form>) 无法伪造 application/json，这会强制触发浏览器预检 (OPTIONS)
  // ==========================================
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ error: 'Unsupported Media Type: must be application/json' }, { status: 415 });
  }

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行管理员配置',
      },
      { status: 400 }
    );
  }

  // ==========================================
  // 🛡️ 权限校验
  // ==========================================
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const username = authInfo.username;

  if (username !== process.env.USERNAME) {
    return NextResponse.json({ error: '仅支持站长重置配置' }, { status: 401 });
  }

  // ==========================================
  // 核心逻辑执行
  // ==========================================
  try {
    await resetConfig();

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store', // 管理员配置不缓存
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: '重置管理员配置失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}

// 🛡️ 明确拒绝 GET 请求，防止从浏览器地址栏直接访问或被 <a> 标签跨站触发
export async function GET() {
  return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405 });
}
