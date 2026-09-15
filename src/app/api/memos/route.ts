import { NextRequest, NextResponse } from 'next/server';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const memos = await (db as any).storage.getMemos(authInfo.username);
    return NextResponse.json({ memos });
  } catch (error) {
    return NextResponse.json({ error: '获取失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) return NextResponse.json({ error: '未授权' }, { status: 401 });

  try {
    const { content } = await request.json();
    if (!content || !content.trim()) {
      return NextResponse.json({ error: '内容不能为空' }, { status: 400 });
    }
    await (db as any).storage.addMemo(authInfo.username, content.trim());
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: '添加失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) return NextResponse.json({ error: '未授权' }, { status: 401 });

  try {
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: '缺少ID' }, { status: 400 });
    
    await (db as any).storage.deleteMemo(authInfo.username, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}
