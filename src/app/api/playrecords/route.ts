/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthUser } from '@/lib/auth-server';
import { checkCsrf } from '@/lib/csrf-guard';
import { db } from '@/lib/db';
import { rejectIfLocalStorageMode } from '@/lib/storage-mode';
import { parsePlayRecord, parseRecordKey } from '@/lib/validation';

export const runtime = 'edge';

const MAX_PLAY_RECORDS_PER_USER = 500;

export async function GET(request: NextRequest) {
  const localModeReject = rejectIfLocalStorageMode();
  if (localModeReject) return localModeReject;

  try {
    // 🛡️ 安全修复 (SEC-02, SEC-04)：强制服务端签名与状态有效性重验
    const authUser = await getVerifiedAuthUser(request);
    if (!authUser || !authUser.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const records = await db.getAllPlayRecords(authUser.username);
    return NextResponse.json(records, { status: 200 });
  } catch (err) {
    console.error('获取播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const localModeReject = rejectIfLocalStorageMode();
  if (localModeReject) return localModeReject;

  const csrf = checkCsrf(request);
  if (!csrf.ok) return csrf.response!;

  try {
    // 🛡️ 安全修复 (SEC-02, SEC-04)：强制服务端签名与状态有效性重验
    const authUser = await getVerifiedAuthUser(request);
    if (!authUser || !authUser.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const { key, record } = (body || {}) as { key?: unknown; record?: unknown };

    if (!key || !record) {
      return NextResponse.json(
        { error: 'Missing key or record' },
        { status: 400 }
      );
    }

    const parsedKey = parseRecordKey(key);
    if (!parsedKey) {
      return NextResponse.json(
        { error: 'Invalid key format' },
        { status: 400 }
      );
    }
    const parsedRecord = parsePlayRecord(record);
    if (!parsedRecord.ok) {
      return NextResponse.json({ error: parsedRecord.error }, { status: 400 });
    }
    const { source, id } = parsedKey;
    const finalRecord = parsedRecord.data;

    // 🛡️ S-07：每用户记录条数上限。更新已有记录（播放中频繁保存）不受影响，只有新增时才统计总数。
    if (!(await db.getPlayRecord(authUser.username, source, id))) {
      const existing = await db.getAllPlayRecords(authUser.username);
      if (Object.keys(existing).length >= MAX_PLAY_RECORDS_PER_USER) {
        return NextResponse.json(
          { error: `播放记录已达上限（${MAX_PLAY_RECORDS_PER_USER} 条），请先清理` },
          { status: 400 }
        );
      }
    }

    await db.savePlayRecord(authUser.username, source, id, finalRecord);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('保存播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const localModeReject = rejectIfLocalStorageMode();
  if (localModeReject) return localModeReject;

  const csrf = checkCsrf(request, { requireJsonContentType: false });
  if (!csrf.ok) return csrf.response!;

  try {
    // 🛡️ 安全修复 (SEC-02, SEC-04)：强制服务端签名与状态有效性重验
    const authUser = await getVerifiedAuthUser(request);
    if (!authUser || !authUser.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const username = authUser.username;
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      // 如果提供了 key，删除单条播放记录
      const [source, id] = key.split('+');
      if (!source || !id) {
        return NextResponse.json(
          { error: 'Invalid key format' },
          { status: 400 }
        );
      }

      await db.deletePlayRecord(username, source, id);
    } else {
      // 未提供 key，则清空全部播放记录
      const all = await db.getAllPlayRecords(username);
      await Promise.all(
        Object.keys(all).map(async (k) => {
          const [s, i] = k.split('+');
          if (s && i) await db.deletePlayRecord(username, s, i);
        })
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('删除播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
