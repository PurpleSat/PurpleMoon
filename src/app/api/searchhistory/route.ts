/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getVerifiedAuthUser } from '@/lib/auth-server';
import { readLimitedJson } from '@/lib/cookies';
import { checkCsrf } from '@/lib/csrf-guard';
import { db } from '@/lib/db';
import { rejectIfLocalStorageMode } from '@/lib/storage-mode';

export const runtime = 'edge';

// 最大保存条数（前后端统一为 20）
const HISTORY_LIMIT = 20;

const searchHistorySchema = z.object({
  keyword: z.string().trim().min(1, '关键字不能为空').max(100, '关键字长度不能超过100字符'),
});

export async function GET(request: NextRequest) {
  const localModeReject = rejectIfLocalStorageMode();
  if (localModeReject) return localModeReject;

  try {
    const authUser = await getVerifiedAuthUser(request);
    if (!authUser || !authUser.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const history = await db.getSearchHistory(authUser.username);
    return NextResponse.json(history.slice(0, HISTORY_LIMIT), { status: 200 });
  } catch (err) {
    console.error('获取搜索历史失败', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const localModeReject = rejectIfLocalStorageMode();
  if (localModeReject) return localModeReject;

  const csrf = checkCsrf(request);
  if (!csrf.ok) return csrf.response!;

  try {
    const authUser = await getVerifiedAuthUser(request);
    if (!authUser || !authUser.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsedBody = await readLimitedJson(request, 10 * 1024);
    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
    }

    const parsed = searchHistorySchema.safeParse(parsedBody.data);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { keyword } = parsed.data;

    await db.addSearchHistory(authUser.username, keyword);

    const history = await db.getSearchHistory(authUser.username);
    return NextResponse.json(history.slice(0, HISTORY_LIMIT), { status: 200 });
  } catch (err: any) {
    console.error('添加搜索历史失败', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const localModeReject = rejectIfLocalStorageMode();
  if (localModeReject) return localModeReject;

  const csrf = checkCsrf(request, { requireJsonContentType: false });
  if (!csrf.ok) return csrf.response!;

  try {
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
