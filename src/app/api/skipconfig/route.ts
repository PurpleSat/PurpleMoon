/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthUser } from '@/lib/auth-server';
import { readLimitedJson } from '@/lib/cookies';
import { checkCsrf } from '@/lib/csrf-guard';
import { db } from '@/lib/db';
import { rejectIfLocalStorageMode } from '@/lib/storage-mode';
import { parseRecordKey } from '@/lib/validation';

export interface SkipConfig {
  enable: boolean;
  intro_time: number;
  outro_time: number;
}

export const runtime = 'edge';

const MAX_SKIP_CONFIGS_PER_USER = 1000;

export async function GET(request: NextRequest) {
  const localModeReject = rejectIfLocalStorageMode();
  if (localModeReject) return localModeReject;

  try {
    const authUser = await getVerifiedAuthUser(request);
    if (!authUser || !authUser.username) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const id = searchParams.get('id');

    if (source && id) {
      const parsedKey = parseRecordKey(`${source}+${id}`);
      if (!parsedKey) {
        return NextResponse.json({ error: '无效的参数格式' }, { status: 400 });
      }
      const skipConfig = await db.getSkipConfig(
        authUser.username,
        parsedKey.source,
        parsedKey.id
      );
      return NextResponse.json(skipConfig);
    } else {
      const configs = await db.getAllSkipConfigs(authUser.username);
      return NextResponse.json(configs);
    }
  } catch (error) {
    console.error('获取跳过片头片尾配置失败:', error);
    return NextResponse.json(
      { error: '获取跳过片头片尾配置失败' },
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
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const parsedBody = await readLimitedJson(request, 16 * 1024);
    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
    }
    const { key, config } = (parsedBody.data || {}) as {
      key?: unknown;
      config?: any;
    };

    if (!key || !config || typeof config !== 'object') {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const parsedKey = parseRecordKey(key);
    if (!parsedKey) {
      return NextResponse.json({ error: '无效的key格式' }, { status: 400 });
    }
    const { source, id } = parsedKey;

    const MAX_SECONDS = 86400;
    const toNumber = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const skipConfig: SkipConfig = {
      enable: Boolean(config.enable),
      intro_time: Math.min(Math.max(toNumber(config.intro_time), 0), MAX_SECONDS),
      outro_time: Math.max(Math.min(toNumber(config.outro_time), 0), -MAX_SECONDS),
    };

    if (!(await db.getSkipConfig(authUser.username, source, id))) {
      const existing = await db.getAllSkipConfigs(authUser.username);
      if (Object.keys(existing).length >= MAX_SKIP_CONFIGS_PER_USER) {
        return NextResponse.json(
          { error: `片头片尾配置已达上限（${MAX_SKIP_CONFIGS_PER_USER} 条），请先清理` },
          { status: 400 }
        );
      }
    }

    await db.setSkipConfig(authUser.username, source, id, skipConfig);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('保存跳过片头片尾配置失败:', error);
    return NextResponse.json(
      { error: '保存跳过片头片尾配置失败' },
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
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (!key) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const parsedKey = parseRecordKey(key);
    if (!parsedKey) {
      return NextResponse.json({ error: '无效的key格式' }, { status: 400 });
    }

    await db.deleteSkipConfig(authUser.username, parsedKey.source, parsedKey.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('删除跳过片头片尾配置失败:', error);
    return NextResponse.json(
      { error: '删除跳过片头片尾配置失败' },
      { status: 500 }
    );
  }
}
