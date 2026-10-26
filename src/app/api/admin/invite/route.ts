/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthUser } from '@/lib/auth-server';
import {
  getConfig,
  invalidateConfigCache,
  withConfigConflictRetry,
} from '@/lib/config';
import { readLimitedJson } from '@/lib/cookies';
import { checkCsrf } from '@/lib/csrf-guard';
import { getStorage } from '@/lib/db';
import {
  ensureGroupsInitialized,
  isInviteCodeRequired,
  MAX_INVITE_CODES,
  validateInviteCodeFormat,
  validateInviteExpiresAt,
  validateInviteMaxUses,
  validateInviteNote,
} from '@/lib/invite';
import { IStorage } from '@/lib/types';
import { resolveGroups } from '@/lib/user-groups';

export const runtime = 'edge';

const ACTIONS = [
  'setRequireInviteCode',
  'createCode',
  'updateCode',
  'deleteCode',
] as const;
type Action = (typeof ACTIONS)[number];

const bad = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });

export async function POST(request: NextRequest) {
  const csrf = checkCsrf(request);
  if (!csrf.ok) return csrf.response;

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return bad('不支持本地存储进行管理员配置');
  }

  try {
    // 🛡️ 安全防线：邀请码可指定任意分组（含高权限分组），仅允许站长（owner）管理
    const authUser = await getVerifiedAuthUser(request, {
      requiredRole: 'owner',
    });
    if (!authUser || authUser.username !== process.env.USERNAME) {
      return bad('仅站长可管理邀请码配置', 401);
    }

    const parsedBody = await readLimitedJson(request, 32 * 1024);
    if (!parsedBody.ok) return bad(parsedBody.error, parsedBody.status);
    const body = parsedBody.data;
    const action = body?.action as Action | undefined;
    if (!action || !ACTIONS.includes(action)) return bad('参数格式错误');

    return await withConfigConflictRetry(async () => {
      const adminConfig = await getConfig();
      const storage: IStorage | null = getStorage();

      if (!adminConfig.InviteConfig) {
        adminConfig.InviteConfig = {
          RequireInviteCode: isInviteCodeRequired(adminConfig),
          Codes: [],
        };
      }
      if (!Array.isArray(adminConfig.InviteConfig.Codes)) {
        adminConfig.InviteConfig.Codes = [];
      }
      const codes = adminConfig.InviteConfig.Codes;

      if (action === 'setRequireInviteCode') {
        if (typeof body.requireInviteCode !== 'boolean') {
          return bad('参数格式错误');
        }
        adminConfig.InviteConfig.RequireInviteCode = body.requireInviteCode;
      } else if (action === 'createCode') {
        if (codes.length >= MAX_INVITE_CODES) {
          return bad(`最多只能创建 ${MAX_INVITE_CODES} 个邀请码`);
        }
        const codeRes = validateInviteCodeFormat(body.code);
        if (!codeRes.ok) return bad(codeRes.error);
        if (codes.some((c) => c.code === codeRes.code)) {
          return bad('该邀请码已存在');
        }

        const maxUsesRes = validateInviteMaxUses(body.maxUses);
        if (!maxUsesRes.ok) return bad(maxUsesRes.error);

        const expiresRes = validateInviteExpiresAt(body.expiresAt);
        if (!expiresRes.ok) return bad(expiresRes.error);

        const noteRes = validateInviteNote(body.note);
        if (!noteRes.ok) return bad(noteRes.error);

        // 若尚未启用分组功能，自动初始化默认的 A 组 / B 组，使分组绑定即刻生效
        ensureGroupsInitialized(adminConfig);
        const rg = resolveGroups(adminConfig);
        const targetGroupId =
          typeof body.groupId === 'string' && body.groupId.trim()
            ? body.groupId.trim()
            : rg.defaultId;
        if (!rg.groups.some((g) => g.id === targetGroupId)) {
          return bad('指定的用户分组不存在', 404);
        }

        codes.push({
          code: codeRes.code,
          groupId: targetGroupId,
          maxUses: maxUsesRes.maxUses,
          usedCount: 0,
          createdAt: Date.now(),
          ...(expiresRes.expiresAt ? { expiresAt: expiresRes.expiresAt } : {}),
          ...(noteRes.note ? { note: noteRes.note } : {}),
        });
      } else if (action === 'updateCode') {
        const codeRes = validateInviteCodeFormat(body.code);
        if (!codeRes.ok) return bad(codeRes.error);
        const item = codes.find((c) => c.code === codeRes.code);
        if (!item) return bad('邀请码不存在', 404);

        if (body.groupId !== undefined) {
          ensureGroupsInitialized(adminConfig);
          const rg = resolveGroups(adminConfig);
          if (
            typeof body.groupId !== 'string' ||
            !rg.groups.some((g) => g.id === body.groupId)
          ) {
            return bad('指定的用户分组不存在', 404);
          }
          item.groupId = body.groupId;
        }

        if (body.maxUses !== undefined) {
          const maxUsesRes = validateInviteMaxUses(body.maxUses);
          if (!maxUsesRes.ok) return bad(maxUsesRes.error);
          item.maxUses = maxUsesRes.maxUses;
        }

        if (body.expiresAt !== undefined) {
          const expiresRes = validateInviteExpiresAt(body.expiresAt);
          if (!expiresRes.ok) return bad(expiresRes.error);
          if (expiresRes.expiresAt) {
            item.expiresAt = expiresRes.expiresAt;
          } else {
            delete item.expiresAt;
          }
        }

        if (body.note !== undefined) {
          const noteRes = validateInviteNote(body.note);
          if (!noteRes.ok) return bad(noteRes.error);
          if (noteRes.note) {
            item.note = noteRes.note;
          } else {
            delete item.note;
          }
        }

        if (body.resetUsedCount === true) {
          item.usedCount = 0;
        }
      } else if (action === 'deleteCode') {
        const codeRes = validateInviteCodeFormat(body.code);
        if (!codeRes.ok) return bad(codeRes.error);
        const idx = codes.findIndex((c) => c.code === codeRes.code);
        if (idx === -1) return bad('邀请码不存在', 404);
        codes.splice(idx, 1);
      }

      if (storage && typeof (storage as any).setAdminConfig === 'function') {
        await (storage as any).setAdminConfig(adminConfig);
      }
      invalidateConfigCache();
      return NextResponse.json(
        { ok: true },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    });
  } catch (error) {
    console.error('邀请码管理操作失败:', error);
    return NextResponse.json(
      { error: '邀请码管理操作失败' },
      { status: 500 }
    );
  }
}
