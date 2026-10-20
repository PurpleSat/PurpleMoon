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

// =========== 登录失败防护（S-01 / S-03）===========
// 旧实现的两个缺口：
//  1) 本地存储模式只有“按 IP”限流，而没有任何前置代理时 IP 可由客户端通过 X-Forwarded-For 伪造，
//     站长密码可被无限次猜测；
//  2) 数据库模式下“按账号”限流只看用户名：任何人用 21 次请求就能把站长账号锁 15 分钟，且可持续重复。
// 现在拆成两层：
//  - 账号 + IP：同一来源对同一账号 15 分钟内最多 20 次。攻击者从自己的 IP 只能锁住“自己对该账号”的尝试，
//    不会影响站长从自己的 IP 登录；
//  - 账号总量上限（不区分 IP）：15 分钟内最多 ACCOUNT_CEILING 次，兜底防止“轮换 IP 的分布式猜密码”。
//    登录成功会清零这两个计数。
//  本地存储模式没有用户名，把固定账号 admin 当作账号，同样适用。
// 说明：账号总量上限被打满时，该账号 15 分钟内无法登录——这是对抗“可伪造 IP 的暴力破解”必须付出的代价；
// 生产环境请置于反向代理之后并设置 TRUST_* 变量，让 IP 不可伪造。
const PAIR_LIMIT = 20;
const ACCOUNT_CEILING = STORAGE_TYPE === 'localstorage' ? 60 : 200;
const ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
const localCounters = new Map<string, { count: number; resetAt: number }>();

function normalizeAccount(username: string): string {
  // 截断长度：避免攻击者用超长/海量不同的用户名制造无限多的限流键
  return username.toLowerCase().slice(0, 64);
}

function pairKey(username: string, ip: string): string {
  return `rate_limit:login_pair:${normalizeAccount(username)}:${ip}`;
}

function accountKey(username: string): string {
  return `rate_limit:login_acct:${normalizeAccount(username)}`;
}

function checkLocalCounter(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  localCounters.forEach((v, k) => {
    if (now > v.resetAt) localCounters.delete(k);
  });
  // 本地计数表也要有上限，防止被海量不同键撑爆内存
  if (localCounters.size > 10000 && !localCounters.has(key)) return true;
  const cur = localCounters.get(key);
  if (!cur) {
    localCounters.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  cur.count++;
  return cur.count <= limit;
}

async function checkKeyLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  if (STORAGE_TYPE === 'localstorage') return checkLocalCounter(key, limit, windowMs);
  try {
    return await db.checkRateLimit(key, limit, windowMs);
  } catch (err) {
    console.error('登录限流存储异常，已降级至本地内存限流:', err);
    return checkLocalCounter(key, limit, windowMs);
  }
}

/** 返回 false 表示应拒绝（429） */
async function checkLoginAttemptLimits(username: string, ip: string): Promise<boolean> {
  if (!(await checkKeyLimit(pairKey(username, ip), PAIR_LIMIT, ACCOUNT_WINDOW_MS))) return false;
  return checkKeyLimit(accountKey(username), ACCOUNT_CEILING, ACCOUNT_WINDOW_MS);
}

async function resetLoginAttemptLimits(username: string, ip: string): Promise<void> {
  for (const key of [pairKey(username, ip), accountKey(username)]) {
    localCounters.delete(key);
    if (STORAGE_TYPE === 'localstorage') continue;
    try {
      await db.resetRateLimit(key);
    } catch (err) {
      console.error('清除登录限流计数失败（计数将自然过期）:', err);
    }
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

      if (!(await checkLoginAttemptLimits('admin', getClientIp(req)))) {
        return NextResponse.json(
          { error: '尝试登录过于频繁，请 15 分钟后再试' },
          { status: 429 }
        );
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
      await resetLoginAttemptLimits('admin', getClientIp(req));

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
    const clientIp = getClientIp(req);
    if (!(await checkLoginAttemptLimits(username, clientIp))) {
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
      await resetLoginAttemptLimits(username, clientIp);

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
      await resetLoginAttemptLimits(username, clientIp);

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
