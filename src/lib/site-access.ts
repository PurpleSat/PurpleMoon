/* eslint-disable no-console */
// 仅供 Node/Edge 路由处理函数使用（依赖 config.ts / auth-server.ts）
import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthUser } from '@/lib/auth-server';
import { ApiSite, getAvailableApiSites, getConfig } from '@/lib/config';
import { getSitesForUser } from '@/lib/user-groups';

export type AccessResult =
  | { ok: true; sites: ApiSite[]; username: string | null; group: string | null }
  | { ok: false; response: NextResponse };

/**
 * 解析当前请求的用户可访问的资源站（按用户分组过滤）。
 * - 本地存储模式没有账户体系：全部已启用资源站
 * - 数据库模式：必须是通过签名校验的有效用户，按其分组返回
 * 分组实时从配置读取（不写入 Cookie），站长调整后立即生效。
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
  return { ok: true, sites, username: user.username, group };
}

/** 按 key 取一个当前用户有权访问的资源站；不存在与无权限统一给出明确状态码 */
export async function resolveAccessibleSite(
  request: Request,
  key: string
): Promise<
  | { ok: true; site: ApiSite }
  | { ok: false; response: NextResponse }
> {
  const access = await resolveAccessibleSites(request);
  if (!access.ok) return access;
  const site = access.sites.find((s) => s.key === key);
  if (site) return { ok: true, site };

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
