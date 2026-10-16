/* eslint-disable @typescript-eslint/no-explicit-any, no-console, @typescript-eslint/no-non-null-assertion */

import { getStorage } from '@/lib/db';

import { AdminConfig, UserGroup } from './admin.types';
import { ConfigConflictError } from './config-errors';
import runtimeConfig from './runtime';
import { getDefaultRegisterGroup, getDiscoveredUserGroup } from './user-groups';

export { ConfigConflictError };

export async function withConfigConflictRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ConfigConflictError) {
        lastError = err;
        // 版本冲突说明本地缓存已过期，强制下次重新从存储读取最新配置
        lastStorageSync = 0;
        continue;
      }
      throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new ConfigConflictError();
}

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
}

interface ConfigFileStruct {
  cache_time?: number;
  api_site: {
    [key: string]: ApiSite;
  };
}

export const API_CONFIG = {
  search: {
    path: '?ac=videolist&wd=',
    pagePath: '?ac=videolist&wd={query}&pg={page}',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
  detail: {
    path: '?ac=videolist&ids=',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
};

// 在模块加载时根据环境决定配置来源
let fileConfig: ConfigFileStruct;
let cachedConfig: AdminConfig;
// 上一次从数据库同步用户/配置的时间；Docker 模式下用于定时刷新进程内缓存
let lastStorageSync = 0;
const STORAGE_SYNC_TTL_MS = 5000;

/** 使进程内配置缓存失效，下一次 getConfig 将重新从数据库同步 */
export function invalidateConfigCache() {
  lastStorageSync = 0;
}

/**
 * Docker 模式下配置缓存常驻进程内存，导致：新注册用户不出现在后台用户列表、
 * 封禁/删除用户不即时生效、多实例间配置版本不一致。这里按 TTL 从数据库刷新。
 */
async function refreshCachedConfigFromStorage() {
  const storage = getStorage() as any;
  if (!storage || typeof storage.getAdminConfig !== 'function') return;
  try {
    const fresh: AdminConfig | null = await storage.getAdminConfig();
    if (!fresh) return;
    let userNames: string[] = [];
    if (typeof storage.getAllUsers === 'function') {
      userNames = await storage.getAllUsers();
    }
    fresh.UserConfig.Users = syncUsers(
      fresh.UserConfig.Users,
      userNames,
      getDiscoveredUserGroup(fresh)
    );
    cachedConfig = fresh;
    lastStorageSync = Date.now();
  } catch (e) {
    console.error('刷新管理员配置缓存失败，沿用旧缓存:', e);
  }
}

// ================== 核心同步逻辑抽离 ==================
// 用于将真实的底层用户列表与 JSON 配置中的权限/封禁状态进行动态合并
function syncUsers(
  jsonUsers: any[] = [],
  dbUserNames: string[] = [],
  discoveredGroup: UserGroup = 'A'
): any[] {
  const userMap = new Map();
  jsonUsers.forEach((u) => userMap.set(u.username, u));

  const syncedUsers: any[] = [];
  const ownerUser = process.env.USERNAME;

  // 1. 确保站长绝对在第一位
  if (ownerUser) {
    syncedUsers.push({ username: ownerUser, role: 'owner' });
    userMap.delete(ownerUser);
  }

  // 2. 遍历底层数据库中的所有真实用户
  dbUserNames.forEach((uname) => {
    if (uname === ownerUser) return;
    if (userMap.has(uname)) {
      // 如果 JSON 中已有该用户，保留其原有状态（如被封禁、特殊权限等）
      syncedUsers.push(userMap.get(uname));
      userMap.delete(uname);
    } else {
      // 发现新注册的用户，动态赋予默认的 user 角色与分组
      syncedUsers.push({ username: uname, role: 'user', group: discoveredGroup });
    }
  });

  // 3. 将残留的（可能在 JSON 中但底层表已被删的异常数据）追加回去
  userMap.forEach((u) => syncedUsers.push(u));

  return syncedUsers;
}
// ====================================================

async function initConfig() {
  if (cachedConfig) {
    return;
  }

  if (process.env.DOCKER_ENV === 'true') {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const _require = eval('require') as NodeRequire;
    const fs = _require('fs') as typeof import('fs');
    const path = _require('path') as typeof import('path');

    const configPath = path.join(process.cwd(), 'config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    fileConfig = JSON.parse(raw) as ConfigFileStruct;
    console.log('load dynamic config success');
  } else {
    // 默认使用编译时生成的配置
    fileConfig = runtimeConfig as unknown as ConfigFileStruct;
  }
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType !== 'localstorage') {
    // 数据库存储，读取并补全管理员配置
    const storage = getStorage();

    try {
      // 尝试从数据库获取管理员配置
      let adminConfig: AdminConfig | null = null;
      if (storage && typeof (storage as any).getAdminConfig === 'function') {
        adminConfig = await (storage as any).getAdminConfig();
      }

      // 获取所有真实的用户名
      let userNames: string[] = [];
      if (storage && typeof (storage as any).getAllUsers === 'function') {
        try {
          userNames = await (storage as any).getAllUsers();
        } catch (e) {
          console.error('获取用户列表失败:', e);
        }
      }

      const apiSiteEntries = Object.entries(fileConfig.api_site);

      if (adminConfig) {
        // 补全 SourceConfig
        const existed = new Set(
          (adminConfig.SourceConfig || []).map((s) => s.key)
        );
        apiSiteEntries.forEach(([key, site]) => {
          if (!existed.has(key)) {
            adminConfig!.SourceConfig.push({
              key,
              name: site.name,
              api: site.api,
              detail: site.detail,
              from: 'config',
              disabled: false,
            });
          }
        });

        // 检查现有源是否在 fileConfig.api_site 中，如果不在则标记为 custom
        const apiSiteKeys = new Set(apiSiteEntries.map(([key]) => key));
        adminConfig.SourceConfig.forEach((source) => {
          if (!apiSiteKeys.has(source.key)) {
            source.from = 'custom';
          }
        });

        // 动态合并补全 Users (自我修复)
        adminConfig.UserConfig.Users = syncUsers(
          adminConfig.UserConfig.Users,
          userNames,
          getDiscoveredUserGroup(adminConfig)
        );

      } else {
        // 数据库中没有配置，创建新的管理员配置
        adminConfig = {
          configVersion: 0,
          SiteConfig: {
            SiteName: process.env.SITE_NAME || 'PurpleMoon',
            Announcement:
              process.env.ANNOUNCEMENT ||
              'Welcome to PurpleMoon. Please note that all content available on this site is sourced from the Internet.',
            SearchDownstreamMaxPage:
              Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
            SiteInterfaceCacheTime: fileConfig.cache_time || 7200,
            ImageProxy: process.env.NEXT_PUBLIC_IMAGE_PROXY || '',
          },
          UserConfig: {
            AllowRegister: process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true',
            Users: syncUsers([], userNames) as any,
          },
          SourceConfig: apiSiteEntries.map(([key, site]) => ({
            key,
            name: site.name,
            api: site.api,
            detail: site.detail,
            from: 'config',
            disabled: false,
          })),
        };
      }

      if (storage && typeof (storage as any).setAdminConfig === 'function') {
        try {
          await (storage as any).setAdminConfig(adminConfig);
        } catch (writeErr) {
          if (writeErr instanceof ConfigConflictError) {
            console.warn('自愈式配置合并写入遇到并发冲突，已跳过本次持久化:', writeErr.message);
          } else {
            throw writeErr;
          }
        }
      }

      // 更新缓存
      cachedConfig = adminConfig;
    } catch (err) {
      console.error('加载管理员配置失败:', err);
    }
  } else {
    // 本地存储直接使用文件配置
    cachedConfig = {
      SiteConfig: {
        SiteName: process.env.SITE_NAME || 'PurpleMoon',
        Announcement:
          process.env.ANNOUNCEMENT ||
          'Welcome to PurpleMoon. Please note that all content available on this site is sourced from the Internet.',
        SearchDownstreamMaxPage:
          Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
        SiteInterfaceCacheTime: fileConfig.cache_time || 7200,
        ImageProxy: process.env.NEXT_PUBLIC_IMAGE_PROXY || '',
      },
      UserConfig: {
        AllowRegister: process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true',
        Users: [],
      },
      SourceConfig: Object.entries(fileConfig.api_site).map(([key, site]) => ({
        key,
        name: site.name,
        api: site.api,
        detail: site.detail,
        from: 'config',
        disabled: false,
      })),
    } as AdminConfig;
  }
}

export async function getConfig(): Promise<AdminConfig> {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (process.env.DOCKER_ENV === 'true' || storageType === 'localstorage') {
    const firstLoad = !cachedConfig;
    await initConfig();
    if (storageType !== 'localstorage') {
      if (firstLoad) {
        lastStorageSync = Date.now();
      } else if (Date.now() - lastStorageSync > STORAGE_SYNC_TTL_MS) {
        await refreshCachedConfigFromStorage();
      }
    }
    return cachedConfig;
  }
  
  // 非 docker 环境且 DB 存储，直接读 db 配置
  const storage = getStorage();
  let adminConfig: AdminConfig | null = null;
  if (storage && typeof (storage as any).getAdminConfig === 'function') {
    adminConfig = await (storage as any).getAdminConfig();
  }

  if (adminConfig) {
    // 合并一些环境变量配置
    adminConfig.SiteConfig.SiteName = process.env.SITE_NAME || 'PurpleMoon';
    adminConfig.SiteConfig.Announcement =
      process.env.ANNOUNCEMENT ||
      'Welcome to PurpleMoon. Please note that all content available on this site is sourced from the Internet.';
    adminConfig.UserConfig.AllowRegister =
      process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true';
    adminConfig.SiteConfig.ImageProxy =
      process.env.NEXT_PUBLIC_IMAGE_PROXY || '';

    // ================= 修复后台用户列表缺失问题 =================
    if (typeof (storage as any).getAllUsers === 'function') {
      try {
        const userNames: string[] = await (storage as any).getAllUsers();
        // 自动合并底层真实数据与 JSON 状态
        adminConfig.UserConfig.Users = syncUsers(
          adminConfig.UserConfig.Users,
          userNames,
          getDiscoveredUserGroup(adminConfig)
        );
      } catch (e) {
        console.error('动态同步用户列表失败:', e);
      }
    }
    // ============================================================

    // 合并文件中的源信息
    fileConfig = runtimeConfig as unknown as ConfigFileStruct;
    const apiSiteEntries = Object.entries(fileConfig.api_site);
    const existed = new Set((adminConfig.SourceConfig || []).map((s) => s.key));
    apiSiteEntries.forEach(([key, site]) => {
      if (!existed.has(key)) {
        adminConfig!.SourceConfig.push({
          key,
          name: site.name,
          api: site.api,
          detail: site.detail,
          from: 'config',
          disabled: false,
        });
      }
    });

    const apiSiteKeys = new Set(apiSiteEntries.map(([key]) => key));
    adminConfig.SourceConfig.forEach((source) => {
      if (!apiSiteKeys.has(source.key)) {
        source.from = 'custom';
      }
    });
    cachedConfig = adminConfig;
  } else {
    // DB 无配置，执行一次初始化
    await initConfig();
  }
  return cachedConfig;
}

export async function resetConfig() {
  const storage = getStorage();
  let userNames: string[] = [];
  if (storage && typeof (storage as any).getAllUsers === 'function') {
    try {
      userNames = await (storage as any).getAllUsers();
    } catch (e) {
      console.error('获取用户列表失败:', e);
    }
  }

  if (process.env.DOCKER_ENV === 'true') {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const _require = eval('require') as NodeRequire;
    const fs = _require('fs') as typeof import('fs');
    const path = _require('path') as typeof import('path');

    const configPath = path.join(process.cwd(), 'config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    fileConfig = JSON.parse(raw) as ConfigFileStruct;
    console.log('load dynamic config success');
  } else {
    fileConfig = runtimeConfig as unknown as ConfigFileStruct;
  }

  const apiSiteEntries = Object.entries(fileConfig.api_site);

  // 重置不应让受限用户悄悄“升级”：保留原有的分组配置与每个用户的分组
  let prevConfig: AdminConfig | null = null;
  if (storage && typeof (storage as any).getAdminConfig === 'function') {
    try {
      prevConfig = await (storage as any).getAdminConfig();
    } catch (e) {
      console.error('重置前读取旧配置失败:', e);
    }
  }
  const prevGroups = new Map<string, UserGroup | undefined>(
    (prevConfig?.UserConfig?.Users || []).map((u) => [u.username, u.group])
  );
  const resetUsers = syncUsers(
    [],
    userNames,
    getDiscoveredUserGroup({ GroupConfig: prevConfig?.GroupConfig })
  ).map((u: any) =>
    u.role === 'owner' ? u : { ...u, group: prevGroups.get(u.username) ?? u.group }
  );

  const adminConfig = {
    SiteConfig: {
      SiteName: process.env.SITE_NAME || 'PurpleMoon',
      Announcement:
        process.env.ANNOUNCEMENT ||
        'Welcome to PurpleMoon. Please note that all content available on this site is sourced from the Internet.',
      SearchDownstreamMaxPage:
        Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
      SiteInterfaceCacheTime: fileConfig.cache_time || 7200,
      ImageProxy: process.env.NEXT_PUBLIC_IMAGE_PROXY || '',
    },
    UserConfig: {
      AllowRegister: process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true',
      Users: resetUsers as any, // 确保重置时也提取底层数据
    },
    ...(prevConfig?.GroupConfig ? { GroupConfig: prevConfig.GroupConfig } : {}),
    SourceConfig: apiSiteEntries.map(([key, site]) => ({
      key,
      name: site.name,
      api: site.api,
      detail: site.detail,
      from: 'config',
      disabled: false,
    })),
  } as AdminConfig;

  // 乐观并发控制需要带上当前版本号，否则存储层会把这次写入判定为冲突（此前重置配置因此必然失败）
  adminConfig.configVersion = prevConfig?.configVersion ?? 0;

  if (storage && typeof (storage as any).setAdminConfig === 'function') {
    await (storage as any).setAdminConfig(adminConfig);
  }
  if (cachedConfig == null) {
    cachedConfig = adminConfig;
  }
  cachedConfig.SiteConfig = adminConfig.SiteConfig;
  cachedConfig.UserConfig = adminConfig.UserConfig;
  cachedConfig.SourceConfig = adminConfig.SourceConfig;
  cachedConfig.GroupConfig = adminConfig.GroupConfig;
  cachedConfig.configVersion = adminConfig.configVersion;
}

export async function getCacheTime(): Promise<number> {
  const config = await getConfig();
  return config.SiteConfig.SiteInterfaceCacheTime || 7200;
}

export async function getAvailableApiSites(): Promise<ApiSite[]> {
  const config = await getConfig();
  return config.SourceConfig.filter((s) => !s.disabled).map((s) => ({
    key: s.key,
    name: s.name,
    api: s.api,
    detail: s.detail,
  }));
}

/**
 * 新用户（自助注册 / 后台新增）创建后，立刻把其分组固化写入配置。
 * 否则该用户只存在于用户表里，分组要等某次后台保存才落盘，
 * 期间站长修改“默认注册分组”会让这些用户的分组跟着变。
 * 失败不影响注册本身：getConfig 的用户同步会兜底分配默认分组。
 */
export async function persistNewUserGroup(
  username: string,
  group?: UserGroup
): Promise<void> {
  const storage = getStorage() as any;
  if (!storage || typeof storage.setAdminConfig !== 'function') return;
  try {
    await withConfigConflictRetry(async () => {
      const config = await getConfig();
      const g = group ?? getDefaultRegisterGroup(config);
      const entry = config.UserConfig.Users.find((u) => u.username === username);
      if (entry) {
        if (entry.role === 'owner') return;
        // 🛡️ 配置里可能残留“数据库中已不存在”的旧条目（如删除用户时配置写入失败）。
        // 重新注册同名账号时必须按全新普通用户对待，不得继承旧条目的 admin 角色。
        entry.role = 'user';
        entry.group = g;
      } else {
        config.UserConfig.Users.push({ username, role: 'user', group: g });
      }
      await storage.setAdminConfig(config);
    });
  } catch (e) {
    console.error('写入新用户分组失败（将由用户同步兜底）:', e);
  }
}
