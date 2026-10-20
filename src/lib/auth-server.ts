/* eslint-disable no-console */
// 仅供 Node/Edge 路由处理函数使用;不要被 middleware.ts 引用(config.ts 含 Edge 不允许的 eval)
import { NextRequest } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie, verifyAuthSignature } from '@/lib/auth';
import { getConfig, invalidateConfigCache } from '@/lib/config';

/**
 * 🛡️ 核心安全工具函数 (SEC-02, SEC-04, SEC-NEW-07)：提供业务 API 路由强校验与即时吊销检查
 * 1. 验证 Cookie 完整性与 HMAC 签名
 * 2. 验证会话时间戳是否过期（7天）与是否早于 sessionsValidAfter（改密/封禁吊销水位线）
 * 3. 实时核对用户封禁状态、删除状态及最新角色权限（SEC-04 / SEC-NEW-07 即时生效）
 * 4. 按用户名隔离的缓存强制刷新冷却（5秒），既防止持有已删账号旧 Cookie 反复刷库 DoS，
 *    又保证新注册或刚变更权限的正常用户首次请求 0 延迟触发刷新，绝不互相阻塞误判 401。
 */
const FORCED_REFRESH_MIN_INTERVAL_MS = 5000;
const MAX_REFRESH_COOLDOWN_ENTRIES = 1000;
const userRefreshCooldown = new Map<string, number>();

export function resetAuthRefreshCooldown() {
  userRefreshCooldown.clear();
}

export async function getVerifiedAuthUser(
  request: NextRequest,
  options: { requiredRole?: 'admin' | 'owner' | 'user'; checkBan?: boolean } = {}
): Promise<{ username: string; role: string; config?: AdminConfig } | null> {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username || !authInfo.signature || !authInfo.timestamp || !authInfo.role) {
    return null;
  }

  // 校验有效期（7天）
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  if (Date.now() - authInfo.timestamp > SEVEN_DAYS_MS) {
    return null;
  }

  // 严格核验 HMAC-SHA256 签名 (SEC-02 纵深防御)
  const isValid = await verifyAuthSignature(
    authInfo.username,
    authInfo.timestamp,
    authInfo.role,
    authInfo.signature
  );

  if (!isValid) {
    return null;
  }

  const ownerName = process.env.USERNAME;
  const isOwner = Boolean(ownerName && authInfo.username === ownerName);

  // 角色权限初筛
  if (options.requiredRole === 'owner') {
    if (!isOwner) return null;
    if (authInfo.role !== 'owner' && authInfo.role !== 'admin') return null;
  } else if (options.requiredRole === 'admin') {
    if (authInfo.role !== 'admin' && authInfo.role !== 'owner') return null;
  }

  // 封禁校验时顺带取到的配置，供调用方复用（避免 Vercel/Cloudflare 上重复读库）
  let loadedConfig: AdminConfig | undefined;
  let effectiveRole: string = isOwner ? 'owner' : authInfo.role;

  // 封禁状态、改密吊销与角色降级即时校验 (SEC-04 / SEC-NEW-07)
  if ((options.checkBan !== false || options.requiredRole === 'admin') && !isOwner) {
    try {
      const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
      if (storageType !== 'localstorage') {
        let config = await getConfig();
        let userEntry = config.UserConfig?.Users?.find((u) => u.username === authInfo.username);
        loadedConfig = config;

        // 进程内配置缓存可能滞后（刚注册的用户、其它实例上的变更）。
        // 查不到该用户或角色不匹配时，按用户名独立限频（5秒）强制从存储刷新一次再下结论。
        // 由于此处已通过 HMAC 签名校验，攻击者无法伪造随机用户名填充 Map，
        // 按用户名限频既能阻止已删账号旧 Cookie 反复击穿缓存，又不会阻塞新注册用户的首次请求。
        if (!userEntry || (options.requiredRole === 'admin' && userEntry.role !== 'admin' && userEntry.role !== 'owner')) {
          const now = Date.now();
          const lastRefreshForUser = userRefreshCooldown.get(authInfo.username) ?? 0;
          if (now - lastRefreshForUser > FORCED_REFRESH_MIN_INTERVAL_MS) {
            if (userRefreshCooldown.size >= MAX_REFRESH_COOLDOWN_ENTRIES) {
              const oldestKey = userRefreshCooldown.keys().next().value;
              if (oldestKey !== undefined) userRefreshCooldown.delete(oldestKey);
            }
            userRefreshCooldown.set(authInfo.username, now);
            invalidateConfigCache();
          }
          config = await getConfig();
          userEntry = config.UserConfig?.Users?.find((u) => u.username === authInfo.username);
          loadedConfig = config;
        }

        if (userEntry && userEntry.banned) {
          console.warn(`[会话吊销拦截] 已被封禁的用户尝试访问业务接口: ${authInfo.username}`);
          return null;
        }
        // 已被管理员删除的用户：其 7 天有效期内的 Cookie 不应继续可用
        if (!userEntry) {
          console.warn(`[会话吊销拦截] 不存在（或已被删除）的用户尝试访问业务接口: ${authInfo.username}`);
          return null;
        }

        // 改密码/封禁之后：签发时间早于 sessionsValidAfter 的旧会话作废
        if (userEntry.sessionsValidAfter && authInfo.timestamp < userEntry.sessionsValidAfter) {
          console.warn(`[会话吊销拦截] 密码变更/封禁前签发的会话已作废: ${authInfo.username}`);
          return null;
        }

        effectiveRole = userEntry.role;

        // 🛡️ SEC-NEW-07：被取消管理员权限的用户，即使旧 Cookie 仍写着 role='admin'，也必须立即拒绝访问管理接口
        if (options.requiredRole === 'admin' && effectiveRole !== 'admin' && effectiveRole !== 'owner') {
          console.warn(`[权限降级拦截] 已被取消管理员身份的用户尝试访问管理接口: ${authInfo.username}`);
          return null;
        }

        // 校验全部通过后清理该用户的负缓存冷却记录
        userRefreshCooldown.delete(authInfo.username);
      }
    } catch (err) {
      // 🛡️ SEC-NEW-07：管理接口在存储异常时必须 Fail-Closed 拒绝访问
      if (options.requiredRole === 'admin' || options.requiredRole === 'owner') {
        console.error('管理接口鉴权读取配置失败，已拒绝请求:', err);
        return null;
      }
    }
  }

  return { username: authInfo.username, role: effectiveRole, config: loadedConfig };
}
