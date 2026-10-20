/* eslint-disable @typescript-eslint/no-explicit-any */
import { TextDecoder, TextEncoder } from 'util';

import { sanitizeAuthPayload } from '../auth';
import { isInviteCodeRequired } from '../invite';
import { readJsonLimited, readTextLimited } from '../safe-fetch';

// Jest 27 + jsdom 缺少这两个全局
(globalThis as any).TextEncoder ??= TextEncoder;
(globalThis as any).TextDecoder ??= TextDecoder;

const goodSig = 'a'.repeat(64);

describe('S-05 sanitizeAuthPayload', () => {
  const base = { username: 'bob', role: 'user', timestamp: 1760000000000, signature: goodSig };
  test('合法载荷通过', () => {
    expect(sanitizeAuthPayload(base)).toEqual(base);
  });
  test('role 为数组 / 对象被拒绝', () => {
    expect(sanitizeAuthPayload({ ...base, role: ['user'] })).toBeNull();
    expect(sanitizeAuthPayload({ ...base, role: { a: 1 } })).toBeNull();
  });
  test('timestamp 为字符串被拒绝', () => {
    expect(sanitizeAuthPayload({ ...base, timestamp: '1760000000000' })).toBeNull();
    expect(sanitizeAuthPayload({ ...base, timestamp: NaN })).toBeNull();
  });
  test('用户名或角色含 ":"（签名串分隔符）被拒绝', () => {
    expect(sanitizeAuthPayload({ ...base, username: 'a:1' })).toBeNull();
    expect(sanitizeAuthPayload({ ...base, role: 'user:x' })).toBeNull();
  });
  test('签名必须是 64 位小写 hex', () => {
    expect(sanitizeAuthPayload({ ...base, signature: 'A'.repeat(64) })).toBeNull();
    expect(sanitizeAuthPayload({ ...base, signature: 'abc' })).toBeNull();
  });
  test('非对象被拒绝', () => {
    expect(sanitizeAuthPayload(null)).toBeNull();
    expect(sanitizeAuthPayload([base])).toBeNull();
    expect(sanitizeAuthPayload('x')).toBeNull();
  });
});

describe('L-05 isInviteCodeRequired', () => {
  const keys = ['REQUIRE_INVITE_CODE', 'VALID_INVITE_CODE', 'NEXT_PUBLIC_ENABLE_REGISTER'];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => keys.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; }));
  afterEach(() => keys.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }));

  test('什么都没配：不要求', () => expect(isInviteCodeRequired()).toBe(false));
  test('配置了邀请码即要求（即使 ENABLE_REGISTER 未设置）', () => {
    process.env.VALID_INVITE_CODE = 'secret-code';
    expect(isInviteCodeRequired()).toBe(true);
  });
  test('显式 REQUIRE_INVITE_CODE=false 优先', () => {
    process.env.VALID_INVITE_CODE = 'secret-code';
    process.env.REQUIRE_INVITE_CODE = 'false';
    expect(isInviteCodeRequired()).toBe(false);
  });
  test('开放注册默认要求邀请码（原有行为不变）', () => {
    process.env.NEXT_PUBLIC_ENABLE_REGISTER = 'true';
    expect(isInviteCodeRequired()).toBe(true);
  });
});

describe('S-06 readTextLimited', () => {
  // Jest 27 的环境里没有全局 Response，这里用最小的流式假对象模拟（每块 16 字节）
  const mk = (body: string, headers: Record<string, string> = {}) => {
    const bytes = new TextEncoder().encode(body);
    let pos = 0;
    return {
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
      body: {
        getReader: () => ({
          read: async () => {
            if (pos >= bytes.length) return { done: true, value: undefined };
            const value = bytes.slice(pos, pos + 16);
            pos += 16;
            return { done: false, value };
          },
          cancel: async () => undefined,
        }),
      },
      text: async () => body,
    } as unknown as Response;
  };
  test('正常大小可读', async () => {
    expect(await readTextLimited(mk('hello'), 100)).toBe('hello');
    expect(await readJsonLimited(mk('{"a":1}'), 100)).toEqual({ a: 1 });
  });
  test('流式累计超限时抛错', async () => {
    await expect(readTextLimited(mk('x'.repeat(200)), 100)).rejects.toThrow('过大');
  });
  test('Content-Length 声明超限直接拒绝', async () => {
    await expect(readTextLimited(mk('x', { 'content-length': '999999' }), 100)).rejects.toThrow('过大');
  });
});
