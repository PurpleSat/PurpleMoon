/* eslint-disable no-console */
import { NextRequest } from 'next/server';

export interface AuthPayload {
  username?: string;
  role?: string;       // 角色字段
  signature?: string;
  timestamp?: number;
}

// 从cookie获取认证信息 (服务端使用)
export function getAuthInfoFromCookie(request: NextRequest): AuthPayload | null {
  const authCookie = request.cookies.get('auth');

  if (!authCookie) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(authCookie.value);
    const authData = JSON.parse(decoded);
    return authData;
  } catch (error) {
    return null;
  }
}

// 从cookie获取认证信息 (客户端使用)
export function getAuthInfoFromBrowserCookie(): AuthPayload | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    // 解析 document.cookie
    const cookies = document.cookie.split(';').reduce((acc, cookie) => {
      const trimmed = cookie.trim();
      const firstEqualIndex = trimmed.indexOf('=');

      if (firstEqualIndex > 0) {
        const key = trimmed.substring(0, firstEqualIndex);
        const value = trimmed.substring(firstEqualIndex + 1);
        if (key && value) {
          acc[key] = value;
        }
      }

      return acc;
    }, {} as Record<string, string>);

    // 【核心修改】：客户端只读取非 HttpOnly 的 user_info Cookie
    const userInfoCookie = cookies['user_info'];
    if (!userInfoCookie) {
      return null;
    }

    // 处理可能的双重编码
    let decoded = decodeURIComponent(userInfoCookie);

    // 如果解码后仍然包含 %，说明是双重编码，需要再次解码
    if (decoded.includes('%')) {
      decoded = decodeURIComponent(decoded);
    }

    const authData = JSON.parse(decoded);
    return authData;
  } catch (error) {
    return null;
  }
}

// ============================================================================
// 【核心安全升级】：防篡改签名机制 (支持 Cloudflare Edge Runtime)
// ============================================================================

// 获取用于签名的安全密钥
//
// 🛡️ 安全修复 (P0)：彻底移除硬编码的兜底默认密钥。
function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.PASSWORD;
  if (!secret) {
    throw new Error(
      'FATAL: 未配置 AUTH_SECRET 或 PASSWORD 环境变量，无法安全地签发/校验登录凭证。' +
        '请在部署环境中设置 AUTH_SECRET（推荐使用高强度随机字符串）后重试。'
    );
  }
  return secret;
}

async function getCryptoKey() {
  const secret = getAuthSecret();
  const enc = new TextEncoder();
  return await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

// 将 Buffer 转换为 Hex 字符串
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// 恒定时间比较两个等长 Hex 字符串，避免时序侧信道泄露签名信息
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * 生成覆盖 username:timestamp:role 的防篡改签名
 */
export async function signAuthPayload(username: string, timestamp: number, role: string): Promise<string> {
  const key = await getCryptoKey();
  const data = `${username}:${timestamp}:${role}`;
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return bufferToHex(signatureBuffer);
}

/**
 * 验证签名的合法性
 */
export async function verifyAuthSignature(
  username: string,
  timestamp: number,
  role: string,
  providedSignature: string
): Promise<boolean> {
  try {
    const expectedSignature = await signAuthPayload(username, timestamp, role);
    return timingSafeEqualHex(expectedSignature, providedSignature);
  } catch (error) {
    // getAuthSecret() 在密钥缺失时会抛出致命错误；
    // 校验函数在这种情况下必须安全降级为"验证失败"，
    // 而不是让未捕获异常导致中间件行为不可预测。
    console.error('鉴权密钥未正确配置，拒绝所有需要签名校验的请求:', error);
    return false;
  }
}
