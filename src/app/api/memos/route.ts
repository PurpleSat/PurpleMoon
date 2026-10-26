/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getVerifiedAuthUser } from '@/lib/auth-server';
import { readLimitedJson } from '@/lib/cookies';
import { checkCsrf } from '@/lib/csrf-guard';
import { db } from '@/lib/db';
import { rejectIfLocalStorageMode } from '@/lib/storage-mode';

export const runtime = 'edge';

const postSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, '内容不能为空')
    .max(500, '内容超长，最多允许 500 个字符'),
});

const deleteSchema = z.object({
  id: z.union([
    z.string().min(1, '缺少ID').max(100, 'ID 长度异常'),
    z.number(),
  ]),
});

export async function GET(request: NextRequest) {
  const localModeReject = rejectIfLocalStorageMode();
  if (localModeReject) return localModeReject;

  const authUser = await getVerifiedAuthUser(request);
  if (!authUser || !authUser.username) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const isAdmin = authUser.role === 'admin' || authUser.role === 'owner';
    const memos = await db.getMemos(authUser.username, isAdmin);
    return NextResponse.json({ memos });
  } catch (error) {
    console.error('获取便签失败:', error);
    return NextResponse.json({ error: '获取失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const localModeReject = rejectIfLocalStorageMode();
  if (localModeReject) return localModeReject;

  const csrf = checkCsrf(request);
  if (!csrf.ok) return csrf.response;

  const authUser = await getVerifiedAuthUser(request);
  if (!authUser || !authUser.username) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const parsedBody = await readLimitedJson(request, 50 * 1024);
    if (!parsedBody.ok) {
      return NextResponse.json(
        { error: parsedBody.error },
        { status: parsedBody.status }
      );
    }

    const rawData = parsedBody.data as Record<string, unknown> | null;
    if (!rawData || typeof rawData.content !== 'string') {
      return NextResponse.json({ error: '内容不能为空' }, { status: 400 });
    }

    const parsed = postSchema.safeParse(rawData);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { content } = parsed.data;

    await db.addMemo(authUser.username, content);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('添加便签失败:', error);

    const isRateLimited = error?.message?.includes('频繁') || error?.status === 429;
    if (isRateLimited) {
      return NextResponse.json(
        { error: '发布过于频繁，10 分钟内最多只能发布 2 条留言。' },
        { status: 429 }
      );
    }

    const isValidation =
      error?.message?.includes('不能为空') || error?.message?.includes('不能超过');
    if (isValidation) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // 🛡️ 安全修复 (SEC-NEW-09)：内部存储异常返回 500 通用提示，不向客户端暴露底层错误详情
    return NextResponse.json(
      { error: '添加失败，请稍后重试' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const localModeReject = rejectIfLocalStorageMode();
  if (localModeReject) return localModeReject;

  const csrf = checkCsrf(request);
  if (!csrf.ok) return csrf.response;

  const authUser = await getVerifiedAuthUser(request);
  if (!authUser || !authUser.username) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const parsedBody = await readLimitedJson(request, 10 * 1024);
    if (!parsedBody.ok) {
      return NextResponse.json(
        { error: parsedBody.error },
        { status: parsedBody.status }
      );
    }

    const rawData = parsedBody.data as Record<string, unknown> | null;
    if (!rawData || rawData.id === undefined || rawData.id === null) {
      return NextResponse.json({ error: '缺少ID' }, { status: 400 });
    }

    const parsed = deleteSchema.safeParse(rawData);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { id } = parsed.data;
    const memoId = Number(id);

    if (!Number.isFinite(memoId)) {
      return NextResponse.json({ error: '无效的便签 ID 格式' }, { status: 400 });
    }

    const isAdmin = authUser.role === 'admin' || authUser.role === 'owner';
    const deleted = await db.deleteMemo(authUser.username, memoId, isAdmin);
    if (!deleted) {
      return NextResponse.json(
        { error: '未找到该便签，或你无权删除它' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('删除便签失败:', error);
    return NextResponse.json(
      { error: '删除失败，请稍后重试' },
      { status: 500 }
    );
  }
}
