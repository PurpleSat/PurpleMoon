/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getClientIp } from '@/lib/client-ip';
import { getConfig } from '@/lib/config';
import { buildAuthCookieValue, setAuthCookies } from '@/lib/cookies';
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

// 🛡️ 结构防线 (SEC-07)：严格校验注册入参格式
const registerSchema = z.object({
  username: z
    .string({ required_error: '用户名不能为空' })
    .trim()
    .min(3, '用户名长度不能少于3个字符')
    .max(32, '用户名长度不能超过32个字符')
    .regex(/^[a-zA-Z0-9_-]+$/, '用户名仅允许包含字母、数字、下划线及连字符'),
  password: z
    .string({ required_error: '密码不能为空' })
    .min(6, '密码长度不能少于6位')
    .max(100, '密码长度不能超过100位'),
  inviteCode: z.string().trim().optional(),
});

// =========== 防刷机制 (Rate Limiter) ===========
const localRateLimitMap = new Map<string, { count: number; timestamp: number }>();

function checkLocalRateLimit(key: string): boolean {
  const now = Date.now();
  const limitData = localRateLimitMap.get(key);

  localRateLimitMap.forEach((value, k) => {
    if (now - value.timestamp > 60000) localRateLimitMap.delete(k);
  });

  if (limitData && now - limitData.timestamp < 60000) {
    if (limitData.count >= 5) return false;
    limitData.count++;
  } else {
    localRateLimitMap.set(key, { count: 1, timestamp: now });
  }
  return true;
}

async function checkRateLimit(ip: string): Promise<boolean> {
  if (STORAGE_TYPE === 'localstorage') {
    return checkLocalRateLimit(ip);
  }

  try {
    const key = `rate_limit:register:${ip}`;
    return await db.checkRateLimit(key, 5, 60000);
  } catch (err) {
    console.error('全局限流检查异常，安全降级至内存限流:', err);
    return checkLocalRateLimit(ip);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    if (!(await checkRateLimit(ip))) {
      return NextResponse.json({ error: '请求过于频繁，请 1 分钟后再试' }, { status: 429 });
    }

    if (STORAGE_TYPE === 'localstorage') {
      return NextResponse.json(
        { error: '当前模式不支持注册' },
        { status: 400 }
      );
    }

    const config = await getConfig();
    if (!config.UserConfig.AllowRegister) {
      return NextResponse.json({ error: '当前未开放注册' }, { status: 400 });
    }

    const rawBody = await req.json().catch(() => ({}));
    const parseResult = registerSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0].message },
        { status: 400 }
      );
    }

    const { username, password, inviteCode } = parseResult.data;

    // ================= 强制邀请码校验 (Fail Closed) =================
    const requireInviteCode =
      process.env.REQUIRE_INVITE_CODE !== undefined
        ? process.env.REQUIRE_INVITE_CODE === 'true'
        : process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true';
    const validInviteCode = process.env.VALID_INVITE_CODE;

    if (requireInviteCode) {
      if (!validInviteCode) {
        console.error('严重的配置错误: 系统开启了邀请注册机制，但未在环境变量中配置 VALID_INVITE_CODE');
        return NextResponse.json({ error: '系统配置异常：注册通道暂时关闭，请联系管理员' }, { status: 500 });
      }

      if (!inviteCode || typeof inviteCode !== 'string') {
        return NextResponse.json({ error: '系统已开启邀请制，必须填写邀请码才可注册' }, { status: 400 });
      }

      if (!timingSafeEqual(inviteCode, validInviteCode)) {
        return NextResponse.json({ error: '邀请码错误或已失效' }, { status: 403 });
      }
    }
    // ================================================================

    if (username === process.env.USERNAME) {
      return NextResponse.json({ error: '用户已存在' }, { status: 400 });
    }

    try {
      const exist = await db.checkUserExist(username);
      if (exist) {
        return NextResponse.json({ error: '用户已存在' }, { status: 400 });
      }

      await db.registerUser(username, password);

      const response = NextResponse.json({ ok: true });
      const cookieValue = await buildAuthCookieValue(username, 'user');
      setAuthCookies(response, req, cookieValue, username, 'user');

      return response;
    } catch (err) {
      console.error('数据库注册失败', err);
      return NextResponse.json({ error: '数据库错误' }, { status: 500 });
    }
  } catch (error) {
    console.error('注册接口异常', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
