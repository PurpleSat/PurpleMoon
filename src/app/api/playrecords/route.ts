/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthUser } from '@/lib/auth-server';
import { readLimitedJson } from '@/lib/cookies';
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
    const authUser = await getVerifiedAuthUser(request);
    if (!authUser || !authUser.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsedBody = await readLimitedJson(request, 32 * 1024);
    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
    }
    const { key, record } = (parsedBody.data || {}) as {
      key?: unknown;
      record?: unknown;
    };

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
    const authUser = await getVerifiedAuthUser(request);
    if (!authUser || !authUser.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const username = authUser.username;
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      const parsedKey = parseRecordKey(key);
      if (!parsedKey) {
        return NextResponse.json(
          { error: 'Invalid key format' },
          { status: 400 }
        );
      }

      await db.deletePlayRecord(username, parsedKey.source, parsedKey.id);
    } else {
      const all = await db.getAllPlayRecords(username);
      await Promise.all(
        Object.keys(all).map(async (k) => {
          const parsed = parseRecordKey(k);
          if (parsed) await db.deletePlayRecord(username, parsed.source, parsed.id);
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
