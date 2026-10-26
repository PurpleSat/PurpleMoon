/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthUser } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';
import { getUserGroupDef, resolveGroups } from '@/lib/user-groups';

export const runtime = 'edge';

/**
 * 当前登录用户的个人信息（用户名 / 级别 / 所属分组），仅供用户中心卡片展示。
 * 角色与分组一律以服务端最新配置为准，不信任 cookie 里可能过期的角色。
 */
export async function GET(request: NextRequest) {
  const authUser = await getVerifiedAuthUser(request);
  if (!authUser) {
    return NextResponse.json({ authenticated: false });
  }

  const isOwner =
    !!process.env.USERNAME && authUser.username === process.env.USERNAME;
  let role: 'owner' | 'admin' | 'user' = isOwner
    ? 'owner'
    : authUser.role === 'admin'
    ? 'admin'
    : 'user';
  let group: string | null = null;
  let groupEnabled = false;

  try {
    const config = authUser.config ?? (await getConfig());
    const entry = config.UserConfig?.Users?.find(
      (u) => u.username === authUser.username
    );
    if (!isOwner && entry) {
      role = entry.role === 'owner' ? 'owner' : entry.role === 'admin' ? 'admin' : 'user';
    }
    groupEnabled = resolveGroups(config).configured;
    if (groupEnabled) {
      const def = getUserGroupDef(config, authUser.username);
      group = def && def.name ? def.name : null;
    }
  } catch (err) {
    console.error('读取用户信息失败:', err);
  }

  return NextResponse.json({
    authenticated: true,
    username: authUser.username,
    role,
    group,
    groupEnabled,
  });
}
