/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthUser } from '@/lib/auth-server';
import { getConfig, invalidateConfigCache } from '@/lib/config';
import { buildAuthCookieValue, setAuthCookies } from '@/lib/cookies';

export const runtime = 'edge';

/**
 * 会话角色刷新：
 * 用户在已登录状态下被站长设为管理员时，其 cookie 中仍是旧的 'user' 角色，
 * 会被 middleware 挡在 /admin 之外。本接口按“最新配置”重新核定角色并重发 cookie。
 *
 * 安全性：角色只来自服务端配置，不信任任何请求参数；重定向目标固定，
 * 不接受外部传入，避免开放重定向。
 */
export async function GET(request: NextRequest) {
  const home = new URL('/', request.url);

  // 校验现有会话（签名、有效期、封禁/删除状态）
  const authUser = await getVerifiedAuthUser(request);
  if (!authUser) {
    return NextResponse.redirect(home);
  }

  // 站长：cookie 角色本身就是 'admin'，无需刷新
  if (authUser.username === process.env.USERNAME) {
    return NextResponse.redirect(new URL('/admin', request.url));
  }

  try {
    invalidateConfigCache(); // 避免进程内缓存滞后导致刚提权的用户仍被判为普通用户
    const config = await getConfig();
    const entry = config.UserConfig?.Users?.find(
      (u) => u.username === authUser.username
    );

    if (!entry || entry.banned || entry.role !== 'admin') {
      return NextResponse.redirect(home);
    }

    const response = NextResponse.redirect(new URL('/admin', request.url));
    const cookieValue = await buildAuthCookieValue(authUser.username, 'admin');
    setAuthCookies(response, request, cookieValue, authUser.username, 'admin');
    return response;
  } catch (err) {
    console.error('刷新会话角色失败:', err);
    return NextResponse.redirect(home);
  }
}
