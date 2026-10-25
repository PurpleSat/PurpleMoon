/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { UserGroupDef } from '@/lib/admin.types';
import { getVerifiedAuthUser } from '@/lib/auth-server';
import { getConfig, withConfigConflictRetry } from '@/lib/config';
import { readLimitedJson } from '@/lib/cookies';
import { checkCsrf } from '@/lib/csrf-guard';
import { getStorage } from '@/lib/db';
import { migrateInviteCodesOnGroupDelete } from '@/lib/invite';
import { IStorage } from '@/lib/types';
import {
  LEGACY_GROUP_A,
  LEGACY_GROUP_B,
  MAX_GROUPS,
  migrateGroupConfig,
  sanitizeSourceKeys,
  validateGroupName,
} from '@/lib/user-groups';

export const runtime = 'edge';

const ACTIONS = [
  'enableGroups',
  'createGroup',
  'updateGroup',
  'deleteGroup',
  'setDefaultGroup',
  'setUserGroup',
] as const;
type Action = (typeof ACTIONS)[number];

function newGroupId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return 'g_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const bad = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });

export async function POST(request: NextRequest) {
  const csrf = checkCsrf(request);
  if (!csrf.ok) return csrf.response!;

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return bad('不支持本地存储进行管理员配置');
  }

  try {
    const authUser = await getVerifiedAuthUser(request, { requiredRole: 'owner' });
    if (!authUser || authUser.username !== process.env.USERNAME) {
      return bad('仅站长可管理用户分组', 401);
    }

    const parsedBody = await readLimitedJson(request, 32 * 1024);
    if (!parsedBody.ok) return bad(parsedBody.error, parsedBody.status);
    const body = parsedBody.data;
    const action = body?.action as Action | undefined;
    if (!action || !ACTIONS.includes(action)) return bad('参数格式错误');

    return await withConfigConflictRetry(async () => {
      const adminConfig = await getConfig();
      const storage: IStorage | null = getStorage();
      const users = adminConfig.UserConfig.Users;

      if (action === 'enableGroups') {
        const migrated = migrateGroupConfig(adminConfig);
        if (migrated) {
          adminConfig.GroupConfig = migrated;
        } else {
          const enabledKeys = adminConfig.SourceConfig.filter((s) => !s.disabled).map(
            (s) => s.key
          );
          adminConfig.GroupConfig = {
            Groups: [
              { id: LEGACY_GROUP_A, name: 'A 组', allSources: true, sourceKeys: [] },
              {
                id: LEGACY_GROUP_B,
                name: 'B 组',
                allSources: false,
                sourceKeys: enabledKeys,
              },
            ],
            DefaultRegisterGroupId: LEGACY_GROUP_B,
          };
          users.forEach((u) => {
            if (u.role !== 'owner' && !u.group) u.group = LEGACY_GROUP_A;
          });
        }
      } else {
        const gc = migrateGroupConfig(adminConfig);
        if (!gc) return bad('请先启用分组功能');
        adminConfig.GroupConfig = gc;
        const groups = gc.Groups as UserGroupDef[];

        if (action === 'createGroup') {
          if (groups.length >= MAX_GROUPS) return bad(`最多只能创建 ${MAX_GROUPS} 个分组`);
          const nameRes = validateGroupName(body.name, groups);
          if (!nameRes.ok) return bad(nameRes.error);
          const allSources = Boolean(body.allSources);
          const keys = allSources ? [] : sanitizeSourceKeys(adminConfig, body.sourceKeys ?? []);
          if (!keys) return bad('资源站列表无效（包含不存在的资源站）');
          groups.push({ id: newGroupId(), name: nameRes.name, allSources, sourceKeys: keys });
        } else if (action === 'updateGroup') {
          const g = groups.find((x) => x.id === body.id);
          if (!g) return bad('分组不存在', 404);
          if (body.name !== undefined) {
            const nameRes = validateGroupName(body.name, groups, g.id);
            if (!nameRes.ok) return bad(nameRes.error);
            g.name = nameRes.name;
          }
          if (body.allSources !== undefined) g.allSources = Boolean(body.allSources);
          if (body.sourceKeys !== undefined) {
            const keys = sanitizeSourceKeys(adminConfig, body.sourceKeys);
            if (!keys) return bad('资源站列表无效（包含不存在的资源站）');
            g.sourceKeys = keys;
          }
        } else if (action === 'deleteGroup') {
          const g = groups.find((x) => x.id === body.id);
          if (!g) return bad('分组不存在', 404);
          if (groups.length <= 1) return bad('至少需要保留一个分组');
          const members = users.filter((u) => u.group === g.id);
          const isDefault = gc.DefaultRegisterGroupId === g.id;
          const moveTo = groups.find((x) => x.id === body.moveToGroupId && x.id !== g.id);
          if ((members.length > 0 || isDefault) && !moveTo) {
            return bad(
              `请选择迁移目标分组：该分组有 ${members.length} 名用户${
                isDefault ? '，且是默认注册分组' : ''
              }`
            );
          }
          if (moveTo) {
            members.forEach((u) => {
              u.group = moveTo.id;
            });
            if (isDefault) gc.DefaultRegisterGroupId = moveTo.id;
          }
          gc.Groups = groups.filter((x) => x.id !== g.id);
          // 同步迁移绑定到该已删除分组的邀请码，避免产生悬空分组 id
          const fallbackGroupId =
            moveTo?.id ??
            (gc.DefaultRegisterGroupId && gc.DefaultRegisterGroupId !== g.id
              ? gc.DefaultRegisterGroupId
              : gc.Groups[0].id);
          migrateInviteCodesOnGroupDelete(adminConfig, g.id, fallbackGroupId);
        } else if (action === 'setDefaultGroup') {
          if (!groups.some((x) => x.id === body.id)) return bad('分组不存在', 404);
          gc.DefaultRegisterGroupId = body.id;
        } else if (action === 'setUserGroup') {
          const { targetUsername, groupId } = body;
          if (typeof targetUsername !== 'string' || typeof groupId !== 'string') {
            return bad('参数格式错误');
          }
          if (!groups.some((x) => x.id === groupId)) return bad('分组不存在', 404);
          const target = users.find((u) => u.username === targetUsername);
          if (!target) return bad('目标用户不存在', 404);
          if (target.role === 'owner' || targetUsername === process.env.USERNAME) {
            return bad('站长不受分组限制，无法设置分组');
          }
          target.group = groupId;
        }
      }

      if (storage && typeof (storage as any).setAdminConfig === 'function') {
        await (storage as any).setAdminConfig(adminConfig);
      }
      return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    });
  } catch (error) {
    console.error('用户分组操作失败:', error);
    return NextResponse.json(
      { error: '用户分组操作失败' },
      { status: 500 }
    );
  }
}
