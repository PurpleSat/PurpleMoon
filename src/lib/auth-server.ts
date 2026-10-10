/* eslint-disable no-console */
// 仅供 Node/Edge 路由处理函数使用;不要被 middleware.ts 引用(config.ts 含 Edge 不允许的 eval)
import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie, verifyAuthSignature } from '@/lib/auth';
import { getConfig } from '@/lib/config';

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

  // 封禁状态与注销即时校验 (SEC-04)
  if (options.checkBan !== false && authInfo.username !== process.env.USERNAME) {
    try {
      const config = await getConfig();
      const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
      const userEntry = config.UserConfig?.Users?.find((u) => u.username === authInfo.username);
      if (storageType !== 'localstorage') {
        if (!userEntry || userEntry.banned) {
          console.warn(`[会话吊销拦截] 用户不存在或已被封禁: ${authInfo.username}`);
          return null;
        }
      } else {
        if (userEntry && userEntry.banned) {
          console.warn(`[会话吊销拦截] 已被封禁的用户尝试访问业务接口: ${authInfo.username}`);
          return null;
        }
      }
    } catch (err) {
      // 存储层未启用多用户配置时忽略
    }
  }

  return { username: authInfo.username, role: authInfo.role };
}
