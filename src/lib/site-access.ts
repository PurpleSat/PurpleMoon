/* eslint-disable no-console */
// 仅供 Node/Edge 路由处理函数使用（依赖 config.ts / auth-server.ts）
import { NextRequest, NextResponse } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';
import { getVerifiedAuthUser } from '@/lib/auth-server';
import { ApiSite, getAvailableApiSites, getConfig } from '@/lib/config';
import { getSitesForUser } from '@/lib/user-groups';

export type AccessResult =
  | {
      ok: true;
      sites: ApiSite[];
      username: string | null;
      role: 'owner' | 'admin' | 'user';
      group: string | null;
    }
  | { ok: false; response: NextResponse };

export function isPrivilegedRole(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * 根据用户角色格式化资源站显示名称：
 * - 站长（owner）与管理员（admin）：显示真实资源站名称
 * - 普通用户（user）：隐藏真实资源站名称，按该用户可访问源顺序脱敏为“线路 1 / 线路 2 ...”
 */
export function formatSourceNameForRole(
  config: AdminConfig,
  username: string | null | undefined,
  role: string | null | undefined,
  sourceKey: string,
  fallbackName?: string
): string {
  if (isPrivilegedRole(role)) {
    const real = config.SourceConfig?.find((s) => s.key === sourceKey)?.name;
    return real || fallbackName || sourceKey;
  }
  const { sites } = getSitesForUser(config, username);
  const idx = sites.findIndex((s) => s.key === sourceKey);
  if (idx >= 0) {
    return `线路 ${idx + 1}`;
  }
  const allIdx = config.SourceConfig?.findIndex((s) => s.key === sourceKey) ?? -1;
  return allIdx >= 0 ? `线路 ${allIdx + 1}` : '线路';
}

/**
 * 解析当前请求的用户可访问的资源站（按用户分组过滤，并对普通用户脱敏资源站名称）。
 * - 本地存储模式没有多账户体系（仅站长）：返回全部已启用资源站及真实名称
 * - 数据库模式：必须是通过签名校验的有效用户，按其分组返回；
 *   普通用户（role === 'user'）的资源站名称统一脱敏为“线路 1”、“线路 2”...，管理员与站长不受限制。
 */
export async function resolveAccessibleSites(
  request: Request
): Promise<AccessResult> {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return {
      ok: true,
      sites: await getAvailableApiSites(),
      username: null,
      role: 'owner',
      group: null,
    };
  }

  const user = await getVerifiedAuthUser(request as NextRequest);
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  const config = user.config ?? (await getConfig());
  const { group, sites } = getSitesForUser(config, user.username);
  const role: 'owner' | 'admin' | 'user' =
    user.role === 'owner' ? 'owner' : user.role === 'admin' ? 'admin' : 'user';

  const finalSites: ApiSite[] = isPrivilegedRole(role)
    ? sites
    : sites.map((s, idx) => ({
        ...s,
        name: `线路 ${idx + 1}`,
      }));

  return { ok: true, sites: finalSites, username: user.username, role, group };
}

/** 按 key 取一个当前用户有权访问的资源站；不存在与无权限统一给出明确状态码 */
export async function resolveAccessibleSite(
  request: Request,
  key: string
): Promise<
  | { ok: true; site: ApiSite; role: 'owner' | 'admin' | 'user' }
  | { ok: false; response: NextResponse }
> {
  const access = await resolveAccessibleSites(request);
  if (!access.ok) return access;
  const site = access.sites.find((s) => s.key === key);
  if (site) return { ok: true, site, role: access.role };

  // 区分“源不存在/已禁用”与“存在但当前分组无权访问”，便于前端给出准确提示
  const all = await getAvailableApiSites();
  const exists = all.some((s) => s.key === key);
  return {
    ok: false,
    response: NextResponse.json(
      { error: exists ? '当前用户组无权访问该资源站' : '无效的API来源' },
      { status: exists ? 403 : 400 }
    ),
  };
}
