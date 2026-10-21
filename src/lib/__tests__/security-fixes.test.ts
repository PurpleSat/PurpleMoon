/* eslint-disable @typescript-eslint/no-explicit-any */
import { TextDecoder, TextEncoder } from 'util';

import { sanitizeAuthPayload } from '../auth';
import { getClientIp, UNKNOWN_IP } from '../client-ip';
import { isInviteCodeRequired } from '../invite';
import { readJsonLimited, readTextLimited } from '../safe-fetch';
import { parseFavorite, parsePlayRecord, parseRecordKey } from '../validation';

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

describe('SEC-NEW-02 getClientIp 生产环境防伪造', () => {
  const envKeys = ['NODE_ENV', 'TRUST_X_FORWARDED_FOR', 'TRUST_CF_CONNECTING_IP', 'TRUST_X_REAL_IP', 'TRUSTED_PROXY_HOPS'];
  const saved: Record<string, string | undefined> = {};
  const env = process.env as Record<string, string | undefined>;
  beforeEach(() => envKeys.forEach((k) => { saved[k] = env[k]; delete env[k]; }));
  afterEach(() => envKeys.forEach((k) => { if (saved[k] === undefined) delete env[k]; else env[k] = saved[k]; }));

  test('生产环境未开启 TRUST_* 时，单值 XFF 仍作为最近一跳使用（不折叠进 unknown_ip）', () => {
    env.NODE_ENV = 'production';
    const ip = getClientIp({
      headers: {
        get: (k: string) => (k.toLowerCase() === 'x-forwarded-for' ? '203.0.113.99' : null),
      },
    });
    expect(ip).toBe('203.0.113.99');
  });

  test('生产环境未开启 TRUST_* 时，客户端在最左侧伪造的值不会生效（取最右侧）', () => {
    env.NODE_ENV = 'production';
    const ip = getClientIp({
      headers: {
        get: (k: string) => (k.toLowerCase() === 'x-forwarded-for' ? '6.6.6.6, 198.51.100.7' : null),
      },
    });
    expect(ip).toBe('198.51.100.7');
  });

  test('生产环境没有任何可用头时返回 unknown_ip', () => {
    env.NODE_ENV = 'production';
    expect(getClientIp({ headers: { get: () => null } })).toBe(UNKNOWN_IP);
  });

  test('生产环境显式开启 TRUST_X_FORWARDED_FOR=true 时取可信代理跳数对应的 IP', () => {
    env.NODE_ENV = 'production';
    env.TRUST_X_FORWARDED_FOR = 'true';
    env.TRUSTED_PROXY_HOPS = '1';
    const ip = getClientIp({
      headers: {
        get: (k: string) => (k.toLowerCase() === 'x-forwarded-for' ? '1.1.1.1, 198.51.100.7' : null),
      },
    });
    expect(ip).toBe('198.51.100.7');
  });
});

describe('SEC-NEW-08 parseRecordKey & cover URL 协议清洗', () => {
  test('parseRecordKey 仅允许字母数字下划线连字符', () => {
    expect(parseRecordKey('ruyi+12345')).toEqual({ source: 'ruyi', id: '12345' });
    expect(parseRecordKey('ruyi:evil+123')).toBeNull();
    expect(parseRecordKey('ruyi+123+456')).toBeNull();
    expect(parseRecordKey('ruyi+*')).toBeNull();
  });

  test('parsePlayRecord 与 parseFavorite 过滤危险封面协议并限制 save_time', () => {
    const r1 = parsePlayRecord({
      title: '测试剧集',
      source_name: '测试源',
      cover: 'javascript:alert(1)',
      year: '2026',
      index: 1,
      total_episodes: 10,
      play_time: 12,
      total_time: 100,
      save_time: -999,
    });
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(r1.data.cover).toBe('');
      expect(r1.data.save_time).toBe(0);
    }

    const r2 = parseFavorite({
      title: '测试电影',
      source_name: '测试源',
      cover: 'https://image.tmdb.org/t/p/w500/a.jpg',
      year: '2026',
      total_episodes: 1,
    });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.data.cover).toBe('https://image.tmdb.org/t/p/w500/a.jpg');
    }
  });
});
