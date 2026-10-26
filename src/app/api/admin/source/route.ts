/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthUser } from '@/lib/auth-server';
import { getConfig, withConfigConflictRetry } from '@/lib/config';
import { readLimitedJson } from '@/lib/cookies';
import { checkCsrf } from '@/lib/csrf-guard';
import { getStorage } from '@/lib/db';
import { checkUpstreamUrlSafety } from '@/lib/ssrf-guard';
import { IStorage } from '@/lib/types';
import { getUserGroupDef, removeSourceKeyFromGroups } from '@/lib/user-groups';

export const runtime = 'edge';

type Action = 'add' | 'disable' | 'enable' | 'delete' | 'sort';

interface BaseBody {
  action?: Action;
}

const SOURCE_KEY_RE = /^[a-zA-Z0-9_-]{1,50}$/;

export async function POST(request: NextRequest) {
  const csrf = checkCsrf(request);
  if (!csrf.ok) return csrf.response;

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行管理员配置',
      },
      { status: 400 }
    );
  }

  try {
    // 🛡️ 安全修复 (SEC-02, SEC-04, SEC-NEW-07)：强制管理员签名与实时角色校验
    const authUser = await getVerifiedAuthUser(request, { requiredRole: 'admin' });
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authUser.username;

    const parsedBody = await readLimitedJson(request, 64 * 1024);
    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
    }
    const body = parsedBody.data as BaseBody & Record<string, any>;
    const { action } = body || {};

    const ACTIONS: Action[] = ['add', 'disable', 'enable', 'delete', 'sort'];
    if (!username || !action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    return await withConfigConflictRetry(async () => {
      const adminConfig = await getConfig();
      const storage: IStorage | null = getStorage();

      if (username !== process.env.USERNAME) {
        const userEntry = adminConfig.UserConfig.Users.find(
          (u) => u.username === username
        );
        if (!userEntry || userEntry.role !== 'admin') {
          return NextResponse.json({ error: '权限不足' }, { status: 401 });
        }
        // 🛡️ 安全加固 (SEC-NEW-01)：受限分组的管理员不可修改全局视频源配置
        const groupDef = getUserGroupDef(adminConfig, username);
        if (groupDef && !groupDef.allSources) {
          return NextResponse.json(
            { error: '当前管理员所属分组受限，仅拥有全部源权限的管理员或站长可管理全局视频源' },
            { status: 403 }
          );
        }
      }

      switch (action) {
        case 'add': {
          const { key, name, api, detail } = body as {
            key?: unknown;
            name?: unknown;
            api?: unknown;
            detail?: unknown;
          };
          if (
            typeof key !== 'string' ||
            typeof name !== 'string' ||
            typeof api !== 'string' ||
            !key.trim() ||
            !name.trim() ||
            !api.trim()
          ) {
            return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
          }

          const cleanKey = key.trim();
          const cleanName = name.trim();
          const cleanApi = api.trim();
          const cleanDetail = typeof detail === 'string' ? detail.trim() : '';

          if (!SOURCE_KEY_RE.test(cleanKey)) {
            return NextResponse.json(
              { error: '资源站 Key 仅允许字母、数字、下划线与连字符（1~50 字符）' },
              { status: 400 }
            );
          }
          if (cleanName.length > 100) {
            return NextResponse.json(
              { error: '资源站名称不能超过 100 字符' },
              { status: 400 }
            );
          }

          const apiSafety = checkUpstreamUrlSafety(cleanApi);
          if (!apiSafety.ok) {
            return NextResponse.json(
              { error: `资源站 API 地址不合法：${apiSafety.reason}` },
              { status: 400 }
            );
          }
          if (cleanDetail) {
            const detailSafety = checkUpstreamUrlSafety(cleanDetail);
            if (!detailSafety.ok) {
              return NextResponse.json(
                { error: `资源站详情地址不合法：${detailSafety.reason}` },
                { status: 400 }
              );
            }
          }

          if (adminConfig.SourceConfig.some((s) => s.key === cleanKey)) {
            return NextResponse.json({ error: '该源已存在' }, { status: 400 });
          }
          adminConfig.SourceConfig.push({
            key: cleanKey,
            name: cleanName,
            api: cleanApi,
            detail: cleanDetail || undefined,
            from: 'custom',
            disabled: false,
          });
          break;
        }
        case 'disable': {
          const { key } = body as { key?: string };
          if (!key || typeof key !== 'string')
            return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
          const entry = adminConfig.SourceConfig.find((s) => s.key === key);
          if (!entry)
            return NextResponse.json({ error: '源不存在' }, { status: 404 });
          entry.disabled = true;
          break;
        }
        case 'enable': {
          const { key } = body as { key?: string };
          if (!key || typeof key !== 'string')
            return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
          const entry = adminConfig.SourceConfig.find((s) => s.key === key);
          if (!entry)
            return NextResponse.json({ error: '源不存在' }, { status: 404 });
          entry.disabled = false;
          break;
        }
        case 'delete': {
          const { key } = body as { key?: string };
          if (!key || typeof key !== 'string')
            return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
          const idx = adminConfig.SourceConfig.findIndex((s) => s.key === key);
          if (idx === -1)
            return NextResponse.json({ error: '源不存在' }, { status: 404 });
          const entry = adminConfig.SourceConfig[idx];
          if (entry.from === 'config') {
            return NextResponse.json({ error: '该源不可删除' }, { status: 400 });
          }
          adminConfig.SourceConfig.splice(idx, 1);
          removeSourceKeyFromGroups(adminConfig, key);
          break;
        }
        case 'sort': {
          const { order } = body as { order?: string[] };
          if (!Array.isArray(order)) {
            return NextResponse.json(
              { error: '排序列表格式错误' },
              { status: 400 }
            );
          }
          const map = new Map(adminConfig.SourceConfig.map((s) => [s.key, s]));
          const newList: typeof adminConfig.SourceConfig = [];
          order.forEach((k) => {
            if (typeof k !== 'string') return;
            const item = map.get(k);
            if (item) {
              newList.push(item);
              map.delete(k);
            }
          });
          adminConfig.SourceConfig.forEach((item) => {
            if (map.has(item.key)) newList.push(item);
          });
          adminConfig.SourceConfig = newList;
          break;
        }
        default:
          return NextResponse.json({ error: '未知操作' }, { status: 400 });
      }

      if (storage && typeof (storage as any).setAdminConfig === 'function') {
        await (storage as any).setAdminConfig(adminConfig);
      }

      return NextResponse.json(
        { ok: true },
        {
          headers: {
            'Cache-Control': 'no-store',
          },
        }
      );
    });
  } catch (error) {
    console.error('视频源管理操作失败:', error);
    return NextResponse.json(
      {
        error: '视频源管理操作失败',
      },
      { status: 500 }
    );
  }
}
