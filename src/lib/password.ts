// 文件路径：src/lib/password.ts
// 使用 Web Crypto API 实现兼容 Cloudflare Edge 的密码加盐哈希与防时序攻击验证

const ITERATIONS = 100000;
const HASH_BYTES = 32;
const SALT_BYTES = 16;

function buf2hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hex2buf(hex: string): ArrayBuffer {
  const buffer = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    buffer[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return buffer.buffer;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    HASH_BYTES * 8
  );

  return `${buf2hex(salt.buffer)}:${buf2hex(hash)}`;
}

export async function verifyPassword(password: string, storedValue: string): Promise<boolean> {
  if (!storedValue) return false;

  if (!storedValue.includes(':')) {
    return timingSafeEqual(password, storedValue);
  }

  const [saltHex, originalHashHex] = storedValue.split(':');
  if (!saltHex || !originalHashHex) return false;

  const salt = hex2buf(saltHex);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(salt),
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    HASH_BYTES * 8
  );

  return timingSafeEqual(buf2hex(hash), originalHashHex);
}
