/* eslint-disable no-console */
// 仅供 Node/Edge 路由处理函数使用;不要被 middleware.ts 引用(config.ts 含 Edge 不允许的 eval)
import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie, verifyAuthSignature } from '@/lib/auth';
import { getConfig, invalidateConfigCache } from '@/lib/config';

/**
 * 🛡️ 核心安全工具函数 (SEC-02, SEC-04)：提供业务 API 路由强校验与即时吊销检查
 * 1. 验证 Cookie 完整性与 HMAC 签名
 * 2. 验证会话时间戳是否过期（7天）
 * 3. 校验调用方所要求的角色权限
 * 4. 实时核对用户封禁状态（SEC-04 封禁即时生效）
 */
export async function getVerifiedAuthUser(
  request: NextRequest,
  options: { requiredRole?: 'admin' | 'owner' | 'user'; checkBan?: boolean } = {}
): Promise<{ username: string; role: string } | null> {
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

  // 角色权限校验
  if (options.requiredRole === 'owner') {
    if (authInfo.role !== 'owner') return null;
  } else if (options.requiredRole === 'admin') {
    if (authInfo.role !== 'admin' && authInfo.role !== 'owner') return null;
  }

  // 封禁状态即时校验 (SEC-04)
  if (options.checkBan !== false && authInfo.username !== process.env.USERNAME) {
    try {
      const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
      let config = await getConfig();
      let userEntry = config.UserConfig?.Users?.find((u) => u.username === authInfo.username);

      // 进程内配置缓存可能滞后（刚注册的用户、其它实例上的变更）。
      // 查不到该用户时先强制从存储刷新一次再下结论，避免误杀新注册用户。
      if (!userEntry && storageType !== 'localstorage') {
        invalidateConfigCache();
        config = await getConfig();
        userEntry = config.UserConfig?.Users?.find((u) => u.username === authInfo.username);
      }

      if (userEntry && userEntry.banned) {
        console.warn(`[会话吊销拦截] 已被封禁的用户尝试访问业务接口: ${authInfo.username}`);
        return null;
      }
      // 已被管理员删除的用户：其 7 天有效期内的 Cookie 不应继续可用（否则会重新写入数据）
      if (storageType !== 'localstorage' && !userEntry) {
        console.warn(`[会话吊销拦截] 不存在（或已被删除）的用户尝试访问业务接口: ${authInfo.username}`);
        return null;
      }
    } catch (err) {
      // 存储层暂时不可用：保持原有行为，不因此拒绝已通过签名校验的会话
    }
  }

  return { username: authInfo.username, role: authInfo.role };
}
