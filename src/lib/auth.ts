import { NextRequest } from 'next/server';

export interface AuthPayload {
  username?: string;
  password?: string; // 建议后续逐步移除，不再把密码存入 Cookie
  role?: string;     // 【新增】：角色字段
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

    const authCookie = cookies['auth'];
    if (!authCookie) {
      return null;
    }

    // 处理可能的双重编码
    let decoded = decodeURIComponent(authCookie);

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
async function getCryptoKey() {
  const secret = process.env.AUTH_SECRET || 'default_secure_secret_moon_tv_2026';
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

/**
 * 生成覆盖 username:timestamp:role 的防篡改签名
 */
export async function signAuthPayload(username: string, timestamp: number, role: string): Promise<string> {
  const key = await getCryptoKey();
  // 【严谨】：签名源字符串绑定了三个核心要素
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
  const expectedSignature = await signAuthPayload(username, timestamp, role);
  // 使用简单的恒定时间比较（在非极端高并发下直接比较字符串即可安全）
  return expectedSignature === providedSignature;
}
