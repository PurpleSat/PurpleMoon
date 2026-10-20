/**
 * 用户分组权限（纯函数，可单元测试）
 *
 * - 站长可自由创建 / 重命名 / 删除分组，并为每个分组自由选择可访问的资源站
 * - 分组可勾选“全部源”（含以后新增），或只选指定的若干源
 * - 站长不属于任何分组，恒可访问全部已启用资源站
 * - 被后台禁用的资源站，对所有分组都不可用（全局开关优先）
 * - 未启用分组（GroupConfig 为空）时不做限制，升级后行为不变
 * - 用户所属分组不存在（数据损坏）时，回退到默认注册分组，不会越权到更高权限
 * - 本地存储模式（无账户体系）不分组
 */
import type { AdminConfig, UserGroupDef } from './admin.types';

export const LEGACY_GROUP_A = 'A';
export const LEGACY_GROUP_B = 'B';
export const MAX_GROUPS = 30;
export const MAX_GROUP_NAME_LENGTH = 20;

export interface SiteLike {
  key: string;
  name: string;
  api: string;
  detail?: string;
}

export interface ResolvedGroups {
  configured: boolean;
  groups: UserGroupDef[];
  defaultId: string;
}

/** 读取分组配置（兼容旧版固定 A/B 格式，读取时在内存中转换） */
export function resolveGroups(config: Pick<AdminConfig, 'GroupConfig'>): ResolvedGroups {
  const gc = config.GroupConfig;
  if (!gc) return { configured: false, groups: [], defaultId: LEGACY_GROUP_B };

  if (Array.isArray(gc.Groups)) {
    const groups = gc.Groups.map((g) => ({
      id: String(g.id),
      name: String(g.name),
      allSources: Boolean(g.allSources),
      sourceKeys: Array.isArray(g.sourceKeys) ? g.sourceKeys.map(String) : [],
    }));
    let defaultId = gc.DefaultRegisterGroupId;
    if (!defaultId || !groups.some((g) => g.id === defaultId)) {
      defaultId = groups[0]?.id ?? LEGACY_GROUP_B;
    }
    return { configured: true, groups, defaultId };
  }

  // 旧格式：固定 A（全部）/ B（指定）两组
  return {
    configured: true,
    groups: [
      { id: LEGACY_GROUP_A, name: 'A 组', allSources: true, sourceKeys: [] },
      {
        id: LEGACY_GROUP_B,
        name: 'B 组',
        allSources: false,
        sourceKeys: Array.isArray(gc.GroupBSourceKeys) ? gc.GroupBSourceKeys : [],
      },
    ],
    defaultId: gc.DefaultRegisterGroup === 'A' ? LEGACY_GROUP_A : LEGACY_GROUP_B,
  };
}

/** 新注册用户应得到的分组 id */
export function getDefaultRegisterGroup(config: Pick<AdminConfig, 'GroupConfig'>): string {
  return resolveGroups(config).defaultId;
}

/**
 * 在 DB 中存在、但配置里还没有条目的用户（多为刚注册或升级前的老用户）应得到的分组：
 * 已启用分组 → 默认注册分组；未启用分组 → 'A'（与升级前一致，不受限制）。
 */
export function getDiscoveredUserGroup(config: Pick<AdminConfig, 'GroupConfig'>): string {
  const r = resolveGroups(config);
  return r.configured ? r.defaultId : LEGACY_GROUP_A;
}

/**
 * 用户所属分组定义；null 表示不受分组限制（站长 / 未启用分组）。
 */
export function getUserGroupDef(
  config: AdminConfig,
  username: string | null | undefined,
  ownerUsername: string | undefined = process.env.USERNAME
): UserGroupDef | null {
  const r = resolveGroups(config);
  if (!r.configured) return null;
  if (username && ownerUsername && username === ownerUsername) return null;
  const entry = username
    ? config.UserConfig.Users.find((u) => u.username === username)
    : undefined;
  if (entry?.role === 'owner') return null;
  const byId = (id: string | undefined) => r.groups.find((g) => g.id === id);
  // 用户没有分组或分组已不存在：回退默认注册分组（不会得到比新用户更高的权限）
  // 若默认分组也不存在（分组被清空等异常），返回空权限分组
  return (
    byId(entry?.group) ??
    byId(r.defaultId) ?? { id: '', name: '', allSources: false, sourceKeys: [] }
  );
}

export function filterSitesByGroupDef<T extends SiteLike>(
  config: AdminConfig,
  group: UserGroupDef | null
): T[] {
  const enabled = config.SourceConfig.filter((s) => !s.disabled) as unknown as T[];
  if (!group || group.allSources) return enabled;
  const allowed = new Set(group.sourceKeys);
  return enabled.filter((s) => allowed.has(s.key));
}

export function getSitesForUser(
  config: AdminConfig,
  username: string | null | undefined
): { group: string | null; sites: SiteLike[] } {
  const def = getUserGroupDef(config, username);
  const sites = filterSitesByGroupDef<SiteLike>(config, def).map((s) => ({
    key: s.key,
    name: s.name,
    api: s.api,
    detail: s.detail,
  }));
  return { group: def ? def.id : null, sites };
}

/** 校验并清洗后台提交的资源站 key 列表：必须是真实存在的源，去重 */
export function sanitizeSourceKeys(
  config: Pick<AdminConfig, 'SourceConfig'>,
  keys: unknown
): string[] | null {
  if (!Array.isArray(keys) || keys.length > 1000) return null;
  const valid = new Set(config.SourceConfig.map((s) => s.key));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    if (typeof k !== 'string') return null;
    if (!valid.has(k)) return null;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** 校验分组名：1~20 字符，不含控制字符，不与其它分组重名（不区分大小写） */
export function validateGroupName(
  name: unknown,
  groups: UserGroupDef[],
  exceptId?: string
): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof name !== 'string') return { ok: false, error: '分组名称无效' };
  const n = name.trim();
  if (n.length < 1) return { ok: false, error: '分组名称不能为空' };
  if (n.length > MAX_GROUP_NAME_LENGTH) {
    return { ok: false, error: `分组名称不能超过 ${MAX_GROUP_NAME_LENGTH} 个字符` };
  }
  for (let i = 0; i < n.length; i++) {
    const c = n.charCodeAt(i);
    if (c < 32 || c === 127) return { ok: false, error: '分组名称包含非法字符' };
  }
  const lower = n.toLowerCase();
  if (groups.some((g) => g.id !== exceptId && g.name.trim().toLowerCase() === lower)) {
    return { ok: false, error: '已存在同名分组' };
  }
  return { ok: true, name: n };
}

/**
 * 旧格式 → 新格式（写入前调用）。已是新格式则原样返回其规范化副本。
 * 未配置时返回 null。
 */
export function migrateGroupConfig(
  config: Pick<AdminConfig, 'GroupConfig'>
): NonNullable<AdminConfig['GroupConfig']> | null {
  const r = resolveGroups(config);
  if (!r.configured) return null;
  return { Groups: r.groups, DefaultRegisterGroupId: r.defaultId };
}

/** 从所有分组里清除某个资源站 key（资源站被删除时调用，避免同名 key 日后被重新添加时“复活”权限） */
export function removeSourceKeyFromGroups(config: AdminConfig, key: string): void {
  const migrated = migrateGroupConfig(config);
  if (!migrated) return;
  migrated.Groups!.forEach((g) => {
    g.sourceKeys = g.sourceKeys.filter((k) => k !== key);
  });
  config.GroupConfig = migrated;
}

// ---------------------------------------------------------------------------
// 🛡️ 安全修复 (SEC-NEW-01)：防止管理员借“临时禁用源 + 改密码 / 新建用户”接管权限更高的账号
// 规则：
// 1. 比较分组权限时，按 SourceConfig 中全部已配置资源站（不排除 disabled 源）计算，
//    防止受限管理员先禁用其他源、修改高权限用户密码后再重新启用源。
// 2. 若目标分组拥有 allSources（含未来新增源）权限，则操作者也必须具备 allSources 权限。
// ---------------------------------------------------------------------------

function allConfiguredKeysFor(config: AdminConfig, def: UserGroupDef | null): Set<string> {
  const allKeys = config.SourceConfig.map((s) => s.key);
  if (!def || def.allSources) return new Set(allKeys);
  const valid = new Set(allKeys);
  return new Set(def.sourceKeys.filter((k) => valid.has(k)));
}

function isSubset(sub: Set<string>, sup: Set<string>): boolean {
  for (const k of Array.from(sub)) if (!sup.has(k)) return false;
  return true;
}

function isGroupSubsetOfAdmin(
  config: AdminConfig,
  targetDef: UserGroupDef | null,
  adminDef: UserGroupDef | null
): boolean {
  // 管理员不受限（站长 / 未启用分组 / 所属分组为 allSources）时可管理任何普通分组
  if (!adminDef || adminDef.allSources) return true;
  // 管理员受限时，绝不能操作拥有 allSources 权限的分组
  if (!targetDef || targetDef.allSources) return false;
  return isSubset(
    allConfiguredKeysFor(config, targetDef),
    allConfiguredKeysFor(config, adminDef)
  );
}

/** 管理员是否可以操作（修改密码 / 封禁 / 删除）目标用户的账号：目标分组权限必须是管理员自己的子集 */
export function adminMayTakeOverAccount(
  config: AdminConfig,
  adminUsername: string,
  targetUsername: string,
  ownerUsername: string | undefined = process.env.USERNAME
): boolean {
  if (adminUsername === ownerUsername) return true;
  if (adminUsername === targetUsername) return true;
  const targetDef = getUserGroupDef(config, targetUsername, ownerUsername);
  const adminDef = getUserGroupDef(config, adminUsername, ownerUsername);
  return isGroupSubsetOfAdmin(config, targetDef, adminDef);
}

/** 管理员新建的用户会进入默认注册分组，该分组的权限不能超过管理员自己 */
export function adminMayCreateUserInDefaultGroup(
  config: AdminConfig,
  adminUsername: string,
  ownerUsername: string | undefined = process.env.USERNAME
): boolean {
  if (adminUsername === ownerUsername) return true;
  const r = resolveGroups(config);
  if (!r.configured) return true;
  const def = r.groups.find((g) => g.id === r.defaultId) ?? null;
  const target = def ?? { id: '', name: '', allSources: false, sourceKeys: [] };
  const adminDef = getUserGroupDef(config, adminUsername, ownerUsername);
  return isGroupSubsetOfAdmin(config, target, adminDef);
}
