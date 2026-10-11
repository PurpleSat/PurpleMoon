/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthUser } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';
import { checkCsrf } from '@/lib/csrf-guard';
import { db } from '@/lib/db';
import { parseRecordKey } from '@/lib/validation';

export interface SkipConfig {
  enable: boolean;
  intro_time: number;
  outro_time: number;
}

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    // 🛡️ 安全修复 (SEC-02, SEC-04)：强制服务端签名与状态有效性重验
    const authUser = await getVerifiedAuthUser(request);
    if (!authUser || !authUser.username) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const config = await getConfig();
    if (authUser.username !== process.env.USERNAME) {
      const user = config.UserConfig.Users.find(
        (u) => u.username === authUser.username
      );
      if (!user) {
        return NextResponse.json({ error: '用户不存在' }, { status: 401 });
      }
      if (user.banned) {
        return NextResponse.json({ error: '用户已被封禁' }, { status: 401 });
      }
    }

    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const id = searchParams.get('id');

    if (source && id) {
      const skipConfig = await db.getSkipConfig(authUser.username, source, id);
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
  const csrf = checkCsrf(request);
  if (!csrf.ok) return csrf.response!;

  try {
    // 🛡️ 安全修复 (SEC-02, SEC-04)：强制服务端签名与状态有效性重验
    const authUser = await getVerifiedAuthUser(request);
    if (!authUser || !authUser.username) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const adminConfig = await getConfig();
    if (authUser.username !== process.env.USERNAME) {
      const user = adminConfig.UserConfig.Users.find(
        (u) => u.username === authUser.username
      );
      if (!user) {
        return NextResponse.json({ error: '用户不存在' }, { status: 401 });
      }
      if (user.banned) {
        return NextResponse.json({ error: '用户已被封禁' }, { status: 401 });
      }
    }

    const body = await request.json().catch(() => null);
    const { key, config } = (body || {}) as { key?: unknown; config?: any };

    if (!key || !config || typeof config !== 'object') {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const parsedKey = parseRecordKey(key);
    if (!parsedKey) {
      return NextResponse.json({ error: '无效的key格式' }, { status: 400 });
    }
    const { source, id } = parsedKey;

    const clampTime = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(Math.max(n, 0), 86400) : 0;
    };
    const skipConfig: SkipConfig = {
      enable: Boolean(config.enable),
      intro_time: clampTime(config.intro_time),
      outro_time: clampTime(config.outro_time),
    };

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
  const csrf = checkCsrf(request, { requireJsonContentType: false });
  if (!csrf.ok) return csrf.response!;

  try {
    // 🛡️ 安全修复 (SEC-02, SEC-04)：强制服务端签名与状态有效性重验
    const authUser = await getVerifiedAuthUser(request);
    if (!authUser || !authUser.username) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const adminConfig = await getConfig();
    if (authUser.username !== process.env.USERNAME) {
      const user = adminConfig.UserConfig.Users.find(
        (u) => u.username === authUser.username
      );
      if (!user) {
        return NextResponse.json({ error: '用户不存在' }, { status: 401 });
      }
      if (user.banned) {
        return NextResponse.json({ error: '用户已被封禁' }, { status: 401 });
      }
    }

    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (!key) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const [source, id] = key.split('+');
    if (!source || !id) {
      return NextResponse.json({ error: '无效的key格式' }, { status: 400 });
    }

    await db.deleteSkipConfig(authUser.username, source, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('删除跳过片头片尾配置失败:', error);
    return NextResponse.json(
      { error: '删除跳过片头片尾配置失败' },
      { status: 500 }
    );
  }
}
