/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getClientIp } from '@/lib/client-ip';
import { getConfig } from '@/lib/config';
import { buildAuthCookieValue, clearAuthCookies, setAuthCookies } from '@/lib/cookies';
import { db } from '@/lib/db';
import { timingSafeEqual } from '@/lib/password';

export const runtime = 'edge';

// 读取存储类型环境变量，默认 localstorage
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'd1'
    | undefined) || 'localstorage';

// =========== 防刷机制 (Rate Limiter) ===========
const localRateLimitMap = new Map<string, { count: number; timestamp: number }>();

function checkLocalRateLimit(ip: string): boolean {
  const now = Date.now();
  const limitData = localRateLimitMap.get(ip);

  localRateLimitMap.forEach((value, key) => {
    if (now - value.timestamp > 60000) localRateLimitMap.delete(key);
  });

  if (limitData && now - limitData.timestamp < 60000) {
    if (limitData.count >= 10) return false;
    limitData.count++;
  } else {
    localRateLimitMap.set(ip, { count: 1, timestamp: now });
  }
  return true;
}

async function checkRateLimit(req: NextRequest): Promise<boolean> {
  const ip = getClientIp(req);

  if (STORAGE_TYPE === 'localstorage') {
    return checkLocalRateLimit(ip);
  }

  try {
    const key = `rate_limit:login:${ip}`;
    return await db.checkRateLimit(key, 10, 60000);
  } catch (err) {
    console.error('分布式限流存储异常，已安全降级至本地内存限流:', err);
    return checkLocalRateLimit(ip);
  }
}

// =========== 按账号限流 ===========
// 仅按 IP 限流时，攻击者轮换 IP（或直连公网时伪造 X-Forwarded-For）即可对单个账号无限次猜密码。
// 这里再叠加“按账号”的上限：15 分钟内同一用户名最多 20 次尝试（大小写不敏感），登录成功即清零。
// 20 次 > 单 IP 每分钟 10 次的上限，普通用户输错几次不受影响；
// 代价是攻击者可短时间内让某账号暂时无法登录（锁定仅 15 分钟，且已登录的会话不受影响）。
const ACCOUNT_LIMIT = 20;
const ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
const localAccountMap = new Map<string, { count: number; resetAt: number }>();

function accountKey(username: string): string {
  return `rate_limit:login_acct:${username.toLowerCase()}`;
}

function checkLocalAccountLimit(key: string): boolean {
  const now = Date.now();
  localAccountMap.forEach((v, k) => {
    if (now > v.resetAt) localAccountMap.delete(k);
  });
  const cur = localAccountMap.get(key);
  if (!cur) {
    localAccountMap.set(key, { count: 1, resetAt: now + ACCOUNT_WINDOW_MS });
    return true;
  }
  cur.count++;
  return cur.count <= ACCOUNT_LIMIT;
}

async function checkAccountRateLimit(username: string): Promise<boolean> {
  const key = accountKey(username);
  try {
    return await db.checkRateLimit(key, ACCOUNT_LIMIT, ACCOUNT_WINDOW_MS);
  } catch (err) {
    console.error('账号限流存储异常，已降级至本地内存限流:', err);
    return checkLocalAccountLimit(key);
  }
}

async function resetAccountRateLimit(username: string): Promise<void> {
  const key = accountKey(username);
  localAccountMap.delete(key);
  try {
    await db.resetRateLimit(key);
  } catch (err) {
    console.error('清除账号限流计数失败（计数将自然过期）:', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await checkRateLimit(req))) {
      return NextResponse.json({ error: '尝试登录过于频繁，请 1 分钟后再试' }, { status: 429 });
    }

    if (STORAGE_TYPE === 'localstorage') {
      const envPassword = process.env.PASSWORD;

      if (!envPassword) {
        const response = NextResponse.json({ ok: true });
        clearAuthCookies(response, req);
        return response;
      }

      const { password } = await req.json();
      if (typeof password !== 'string') {
        return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
      }

      if (!timingSafeEqual(password, envPassword)) {
        return NextResponse.json(
          { ok: false, error: '密码错误' },
          { status: 401 }
        );
      }

      const response = NextResponse.json({ ok: true });
      const cookieValue = await buildAuthCookieValue('admin', 'admin');
      setAuthCookies(response, req, cookieValue, 'admin', 'admin');

      return response;
    }

    const { username, password } = await req.json();

    if (!username || typeof username !== 'string' || username.length > 64) {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string' || password.length > 200) {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    // 按账号限流：对任意用户名（含不存在的）一视同仁，不泄露账号是否存在
    if (!(await checkAccountRateLimit(username))) {
      return NextResponse.json(
        { error: '该账号尝试登录过于频繁，请 15 分钟后再试' },
        { status: 429 }
      );
    }

    const ownerUsername = process.env.USERNAME || '';
    const ownerPassword = process.env.PASSWORD || '';
    if (
      timingSafeEqual(username, ownerUsername) &&
      timingSafeEqual(password, ownerPassword)
    ) {
      const response = NextResponse.json({ ok: true });
      const cookieValue = await buildAuthCookieValue(username, 'admin');
      setAuthCookies(response, req, cookieValue, username, 'admin');
      await resetAccountRateLimit(username);

      return response;
    } else if (username === process.env.USERNAME) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    try {
      const pass = await db.verifyUser(username, password);
      if (!pass) {
        return NextResponse.json(
          { error: '用户名或密码错误' },
          { status: 401 }
        );
      }

      // 先校验密码再提示封禁，避免未认证者借此探测任意用户名是否存在/被封禁
      const config = await getConfig();
      const user = config.UserConfig.Users.find((u) => u.username === username);
      if (user && user.banned) {
        return NextResponse.json({ error: '用户被封禁' }, { status: 401 });
      }

      // 会话角色必须以配置中的最新角色为准：被站长设置为管理员的用户，
      // 登录时应下发 'admin' 角色（与站长 cookie 约定一致），否则 middleware
      // 会因 cookie 角色为 'user' 而把其从 /admin 重定向回首页。
      // 注意：getConfig 可能有进程内缓存，查不到时不做降级以外的假设。
      const sessionRole = user && user.role === 'admin' ? 'admin' : 'user';

      const response = NextResponse.json({ ok: true });
      const cookieValue = await buildAuthCookieValue(username, sessionRole);
      setAuthCookies(response, req, cookieValue, username, sessionRole);
      await resetAccountRateLimit(username);

      return response;
    } catch (err) {
      console.error('数据库验证失败', err);
      return NextResponse.json({ error: '数据库错误' }, { status: 500 });
    }
  } catch (error) {
    console.error('登录接口异常', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
