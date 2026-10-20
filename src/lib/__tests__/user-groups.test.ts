/** @jest-environment node */
import type { AdminConfig, UserGroupDef } from '../admin.types';
import {
  adminMayCreateUserInDefaultGroup,
  adminMayTakeOverAccount,
  filterSitesByGroupDef,
  getDefaultRegisterGroup,
  getDiscoveredUserGroup,
  getSitesForUser,
  getUserGroupDef,
  migrateGroupConfig,
  removeSourceKeyFromGroups,
  resolveGroups,
  sanitizeSourceKeys,
  validateGroupName,
} from '../user-groups';

const src = (key: string, extra: Partial<AdminConfig['SourceConfig'][number]> = {}) => ({
  key,
  name: key,
  api: `https://${key}.example/api`,
  from: 'config' as const,
  ...extra,
});

const G = (id: string, name: string, allSources: boolean, sourceKeys: string[] = []): UserGroupDef => ({
  id,
  name,
  allSources,
  sourceKeys,
});

const base = (): AdminConfig => ({
  SiteConfig: {
    SiteName: 's',
    Announcement: '',
    SearchDownstreamMaxPage: 5,
    SiteInterfaceCacheTime: 100,
    ImageProxy: '',
  },
  UserConfig: {
    AllowRegister: true,
    Users: [
      { username: 'boss', role: 'owner' },
      { username: 'old', role: 'user' }, // 无分组
      { username: 'vip', role: 'user', group: 'g_vip' },
      { username: 'basic', role: 'user', group: 'g_basic' },
      { username: 'lost', role: 'user', group: 'g_deleted' }, // 分组已不存在
      { username: 'adm', role: 'admin', group: 'g_basic' },
    ],
  },
  SourceConfig: [src('s1'), src('s2'), src('s3', { from: 'custom' }), src('off', { disabled: true })],
});

const withGroups = (c: AdminConfig) => {
  c.GroupConfig = {
    Groups: [G('g_vip', 'VIP', true), G('g_basic', '基础', false, ['s1', 'off', 'gone']), G('g_none', '空', false, [])],
    DefaultRegisterGroupId: 'g_basic',
  };
  return c;
};
const keys = (r: { key: string }[]) => r.map((s) => s.key);

describe('custom user groups', () => {
  it('未启用分组：所有人（含无分组用户）可访问全部已启用源', () => {
    const c = base();
    expect(getUserGroupDef(c, 'basic', 'boss')).toBeNull();
    expect(keys(getSitesForUser(c, 'basic').sites)).toEqual(['s1', 's2', 's3']);
  });

  it('站长不受分组限制', () => {
    const c = withGroups(base());
    expect(getUserGroupDef(c, 'boss', 'boss')).toBeNull();
    c.UserConfig.Users[0].group = 'g_none'; // 即使被篡改
    expect(getUserGroupDef(c, 'boss', 'boss')).toBeNull();
  });

  it('全部源分组包含以后新增的源；被禁用的源除外', () => {
    const c = withGroups(base());
    c.SourceConfig.push(src('new1', { from: 'custom' }));
    const def = getUserGroupDef(c, 'vip', 'boss');
    expect(keys(filterSitesByGroupDef(c, def))).toEqual(['s1', 's2', 's3', 'new1']);
  });

  it('指定源分组：只含勾选且已启用的源，陈旧 / 被禁用 key 被忽略', () => {
    const c = withGroups(base());
    expect(keys(filterSitesByGroupDef(c, getUserGroupDef(c, 'basic', 'boss')))).toEqual(['s1']);
  });

  it('空列表分组 → 无任何资源站', () => {
    const c = withGroups(base());
    expect(filterSitesByGroupDef(c, c.GroupConfig!.Groups![2])).toEqual([]);
  });

  it('后新增的源不会自动开放给指定源分组', () => {
    const c = withGroups(base());
    c.SourceConfig.push(src('new1'));
    expect(keys(filterSitesByGroupDef(c, getUserGroupDef(c, 'basic', 'boss')))).toEqual(['s1']);
  });

  it('用户所属分组已不存在 / 无分组 → 回退默认注册分组，不越权', () => {
    const c = withGroups(base());
    expect(getUserGroupDef(c, 'lost', 'boss')?.id).toBe('g_basic');
    expect(getUserGroupDef(c, 'old', 'boss')?.id).toBe('g_basic');
    expect(getUserGroupDef(c, 'ghost', 'boss')?.id).toBe('g_basic');
    expect(getUserGroupDef(c, null, 'boss')?.id).toBe('g_basic');
  });

  it('分组被清空时回退为空权限，而不是全部权限', () => {
    const c = base();
    c.GroupConfig = { Groups: [], DefaultRegisterGroupId: 'x' };
    expect(getSitesForUser(c, 'basic').sites).toEqual([]);
  });

  it('getSitesForUser 只暴露必要字段', () => {
    const c = withGroups(base());
    const r = getSitesForUser(c, 'basic');
    expect(r.group).toBe('g_basic');
    expect(Object.keys(r.sites[0]).sort()).toEqual(['api', 'detail', 'key', 'name']);
  });

  it('旧格式（固定 A/B）自动迁移，保持原有语义与 id', () => {
    const c = base();
    c.GroupConfig = { DefaultRegisterGroup: 'B', GroupBSourceKeys: ['s2'] };
    const r = resolveGroups(c);
    expect(r.groups.map((g) => [g.id, g.allSources])).toEqual([['A', true], ['B', false]]);
    expect(r.defaultId).toBe('B');
    c.UserConfig.Users.push({ username: 'oldb', role: 'user', group: 'B' });
    expect(keys(getSitesForUser(c, 'oldb').sites)).toEqual(['s2']);
    const m = migrateGroupConfig(c)!;
    expect(m.Groups).toHaveLength(2);
    expect(m.DefaultRegisterGroupId).toBe('B');
    expect(m.GroupBSourceKeys).toBeUndefined();
  });

  it('默认注册分组 / 发现型用户分组', () => {
    const c = base();
    expect(getDefaultRegisterGroup(c)).toBe('B'); // 未配置时的新注册默认
    expect(getDiscoveredUserGroup(c)).toBe('A'); // 未配置：老用户不受限
    withGroups(c);
    expect(getDefaultRegisterGroup(c)).toBe('g_basic');
    expect(getDiscoveredUserGroup(c)).toBe('g_basic');
    c.GroupConfig!.DefaultRegisterGroupId = 'missing'; // 默认分组 id 失效 → 取第一个分组
    expect(getDefaultRegisterGroup(c)).toBe('g_vip');
  });

  it('removeSourceKeyFromGroups 清理引用，避免同名源日后“复活”权限', () => {
    const c = withGroups(base());
    removeSourceKeyFromGroups(c, 's1');
    expect(c.GroupConfig!.Groups![1].sourceKeys).toEqual(['off', 'gone']);
  });

  it('sanitizeSourceKeys：去重；未知 key / 非数组 / 非字符串拒绝', () => {
    const c = base();
    expect(sanitizeSourceKeys(c, ['s1', 's1', 's2'])).toEqual(['s1', 's2']);
    expect(sanitizeSourceKeys(c, ['s1', 'nope'])).toBeNull();
    expect(sanitizeSourceKeys(c, 's1')).toBeNull();
    expect(sanitizeSourceKeys(c, [1])).toBeNull();
    expect(sanitizeSourceKeys(c, [])).toEqual([]);
  });

  it('validateGroupName：长度、控制字符、重名（不区分大小写与首尾空格）', () => {
    const groups = [G('1', 'VIP', true), G('2', '基础', false)];
    expect(validateGroupName('  白金 ', groups)).toEqual({ ok: true, name: '白金' });
    expect(validateGroupName('', groups).ok).toBe(false);
    expect(validateGroupName('x'.repeat(21), groups).ok).toBe(false);
    expect(validateGroupName('a\u0000b', groups).ok).toBe(false);
    expect(validateGroupName('vip', groups).ok).toBe(false);
    expect(validateGroupName('VIP', groups, '1').ok).toBe(true); // 自己改名保持不变
    expect(validateGroupName(123, groups).ok).toBe(false);
  });

  describe('管理员越权防护', () => {
    it('管理员不能接管权限更高的账号，可接管同级 / 更低 / 自己', () => {
      const c = withGroups(base());
      expect(adminMayTakeOverAccount(c, 'adm', 'vip', 'boss')).toBe(false);
      expect(adminMayTakeOverAccount(c, 'adm', 'basic', 'boss')).toBe(true);
      expect(adminMayTakeOverAccount(c, 'adm', 'adm', 'boss')).toBe(true);
      expect(adminMayTakeOverAccount(c, 'adm', 'lost', 'boss')).toBe(true);
      c.UserConfig.Users.push({ username: 'none', role: 'user', group: 'g_none' });
      expect(adminMayTakeOverAccount(c, 'adm', 'none', 'boss')).toBe(true);
    });

    it('SEC-NEW-01：即使其他视频源被临时禁用，受限分组管理员仍不能接管更高分组或 allSources 账号', () => {
      const c = withGroups(base());
      // 把除 s1 外的源全部设为 disabled
      c.SourceConfig.forEach((s) => {
        if (s.key !== 's1') s.disabled = true;
      });
      // vip 属于 allSources=true 分组，受限管理员 adm 仍不可接管
      expect(adminMayTakeOverAccount(c, 'adm', 'vip', 'boss')).toBe(false);

      // 新增一个拥有 ['s1', 's2']（但 s2 当前处于 disabled）的分组用户
      c.GroupConfig!.Groups!.push(G('g_plus', '进阶', false, ['s1', 's2']));
      c.UserConfig.Users.push({ username: 'plus_user', role: 'user', group: 'g_plus' });
      expect(adminMayTakeOverAccount(c, 'adm', 'plus_user', 'boss')).toBe(false);
    });

    it('站长不受限；管理员在“全部源”分组时可接管任意用户', () => {
      const c = withGroups(base());
      expect(adminMayTakeOverAccount(c, 'boss', 'vip', 'boss')).toBe(true);
      c.UserConfig.Users.find((u) => u.username === 'adm')!.group = 'g_vip';
      expect(adminMayTakeOverAccount(c, 'adm', 'vip', 'boss')).toBe(true);
      expect(adminMayTakeOverAccount(c, 'adm', 'basic', 'boss')).toBe(true);
    });

    it('未启用分组时不做限制', () => {
      const c = base();
      expect(adminMayTakeOverAccount(c, 'adm', 'vip', 'boss')).toBe(true);
      expect(adminMayCreateUserInDefaultGroup(c, 'adm', 'boss')).toBe(true);
    });

    it('管理员新建用户：默认注册分组权限不能高于自己', () => {
      const c = withGroups(base());
      expect(adminMayCreateUserInDefaultGroup(c, 'adm', 'boss')).toBe(true);
      c.GroupConfig!.DefaultRegisterGroupId = 'g_vip';
      expect(adminMayCreateUserInDefaultGroup(c, 'adm', 'boss')).toBe(false);
      expect(adminMayCreateUserInDefaultGroup(c, 'boss', 'boss')).toBe(true);
    });
  });
});
