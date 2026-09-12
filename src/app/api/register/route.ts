/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'edge';

// 读取存储类型环境变量，默认 localstorage
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'd1'
    | undefined) || 'localstorage';

// =========== 防刷机制 (Rate Limiter) ===========
// 利用 Edge Isolate 级别的全局变量存储 IP 访问频率
const rateLimitMap = new Map<string, { count: number; timestamp: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const limitData = rateLimitMap.get(ip);

  // 修复 TS 编译报错：改用 forEach 遍历，完美兼容低版本编译目标
  rateLimitMap.forEach((value, key) => {
    if (now - value.timestamp > 60000) rateLimitMap.delete(key);
  });

  if (limitData && now - limitData.timestamp < 60000) {
    if (limitData.count >= 5) return false; // 注册限流：每分钟 5 次
    limitData.count++;
  } else {
    rateLimitMap.set(ip, { count: 1, timestamp: now });
  }
  return true;
}
// ==============================================

// 生成签名
async function generateSignature(
  data: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  // 导入密钥
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // 生成签名
  const signature = await crypto.subtle.sign('HMAC', key, messageData);

  // 转换为十六进制字符串
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// 生成认证Cookie（带签名）
async function generateAuthCookie(username: string): Promise<string> {
  const authData: any = {
    username,
    timestamp: Date.now(),
  };

  // 修复漏洞：优先使用独立的 AUTH_SECRET 作为签名密钥，隔离系统登录密码
  const signingKey = process.env.AUTH_SECRET || process.env.PASSWORD || '';
  if (!process.env.AUTH_SECRET) {
    console.warn('警告: 未配置 AUTH_SECRET，当前 Cookie 签名面临被暴力破解的风险');
  }

  const signature = await generateSignature(username, signingKey);
  authData.signature = signature;

  return encodeURIComponent(JSON.stringify(authData));
}

export async function POST(req: NextRequest) {
  try {
    // 1. IP 频率限制拦截 (提取 Cloudflare 传递的真实 IP)
    const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'unknown_ip';
    if (!checkRateLimit(ip)) {
      return NextResponse.json({ error: '请求过于频繁，请 1 分钟后再试' }, { status: 429 });
    }

    // localstorage 模式下不支持注册
    if (STORAGE_TYPE === 'localstorage') {
      return NextResponse.json(
        { error: '当前模式不支持注册' },
        { status: 400 }
      );
    }

    const config = await getConfig();
    // 校验是否开放注册
    if (!config.UserConfig.AllowRegister) {
      return NextResponse.json({ error: '当前未开放注册' }, { status: 400 });
    }

    const { username, password, inviteCode } = await req.json();

    // ================= 强制邀请码校验 =================
    const requireInviteCode = process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true';
    const validInviteCode = process.env.VALID_INVITE_CODE || 'moon2026';

    if (requireInviteCode) {
      if (!inviteCode || typeof inviteCode !== 'string') {
        return NextResponse.json({ error: '系统已开启邀请制，必须填写邀请码才可注册' }, { status: 400 });
      }
      if (inviteCode !== validInviteCode) {
        return NextResponse.json({ error: '邀请码错误或已失效' }, { status: 403 });
      }
    }
    // ==================================================

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    // 检查是否和管理员重复
    if (username === process.env.USERNAME) {
      return NextResponse.json({ error: '用户已存在' }, { status: 400 });
    }

    try {
      // 检查用户是否已存在
      const exist = await db.checkUserExist(username);
      if (exist) {
        return NextResponse.json({ error: '用户已存在' }, { status: 400 });
      }

      await db.registerUser(username, password);


      // 注册成功，设置认证cookie
      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie(username);
      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天过期

      response.cookies.set('auth', cookieValue, {
        path: '/',
        expires,
        sameSite: 'lax', // 改为 lax 以支持 PWA
        httpOnly: false, // PWA 需要客户端可访问
        secure: false, // 根据协议自动设置
      });

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
