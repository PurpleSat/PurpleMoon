/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getVerifiedAuthUser } from '@/lib/auth-server';
import { checkCsrf } from '@/lib/csrf-guard';
import { db } from '@/lib/db';

export const runtime = 'edge';

// 最大保存条数
const HISTORY_LIMIT = 20;

// ==========================================
// 🛡️ 结构防线 (Zod Schema)
// ==========================================
const searchHistorySchema = z.object({
  // 严格限制关键字长度为 1~100 字符，防止存入巨大的垃圾数据
  keyword: z.string().trim().min(1, '关键字不能为空').max(100, '关键字长度不能超过100字符'),
});

// ==========================================
// 🛡️ 物理防线：限制请求体体积
// ==========================================
async function parseSafeBody(request: NextRequest, maxSizeKB: number) {
  const text = await request.text();
  if (text.length > maxSizeKB * 1024) throw new Error('Payload Too Large');
  if (!text.trim()) throw new Error('Empty Body');
  return JSON.parse(text);
}

// ------------------------------------------

export async function GET(request: NextRequest) {
  try {
    // 🛡️ 安全修复 (SEC-02, SEC-04)：强制服务端签名与状态有效性重验
    const authUser = await getVerifiedAuthUser(request);
    if (!authUser || !authUser.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const history = await db.getSearchHistory(authUser.username);
    return NextResponse.json(history, { status: 200 });
  } catch (err) {
    console.error('获取搜索历史失败', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // 🛡️ 安全修复 (SEC-10)：CSRF 纵深防御
  const csrf = checkCsrf(request);
  if (!csrf.ok) return csrf.response!;

  try {
    // 🛡️ 安全修复 (SEC-02, SEC-04)：强制服务端签名与状态有效性重验
    const authUser = await getVerifiedAuthUser(request);
    if (!authUser || !authUser.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 物理防御：搜索关键字的请求体极小，限制为 10KB
    const rawBody = await parseSafeBody(request, 10);

    // 结构防御：Zod 强校验
    const parsed = searchHistorySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { keyword } = parsed.data;

    await db.addSearchHistory(authUser.username, keyword);

    const history = await db.getSearchHistory(authUser.username);
    return NextResponse.json(history.slice(0, HISTORY_LIMIT), { status: 200 });
  } catch (err: any) {
    if (err.message === 'Payload Too Large') {
      return NextResponse.json({ error: '请求体过大' }, { status: 413 });
    }
    console.error('添加搜索历史失败', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  // 🛡️ 安全修复 (SEC-10)：该接口走 query string、无请求体
  const csrf = checkCsrf(request, { requireJsonContentType: false });
  if (!csrf.ok) return csrf.response!;

  try {
    // 🛡️ 安全修复 (SEC-02, SEC-04)：强制服务端签名与状态有效性重验
    const authUser = await getVerifiedAuthUser(request);
    if (!authUser || !authUser.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const kw = searchParams.get('keyword')?.trim();

    await db.deleteSearchHistory(authUser.username, kw || undefined);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('删除搜索历史失败', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
