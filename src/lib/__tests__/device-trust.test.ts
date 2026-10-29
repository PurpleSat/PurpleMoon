/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { webcrypto } from 'crypto';
import { TextDecoder, TextEncoder } from 'util';

// Jest 27 的 node 环境缺少这些全局（运行时 Node 22/24 自带）
(globalThis as any).crypto ??= webcrypto;
(globalThis as any).TextEncoder ??= TextEncoder;
(globalThis as any).TextDecoder ??= TextDecoder;

// cookies.ts 只把 next/server 当类型用，这里不加载真实实现（它依赖 Request 等全局）
jest.mock('next/server', () => ({ NextRequest: class {}, NextResponse: class {} }));

import { hasDeviceTrust, setDeviceTrustCookie } from '../cookies';

const savedSecret = process.env.AUTH_SECRET;
beforeAll(() => {
  process.env.AUTH_SECRET = 'test-secret-test-secret-test-secret-1234';
});
afterAll(() => {
  if (savedSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = savedSecret;
});

function fakeReq(cookies: Record<string, string>): any {
  return {
    cookies: { get: (n: string) => (n in cookies ? { name: n, value: cookies[n] } : undefined) },
    headers: { get: () => null },
    nextUrl: { protocol: 'http:' },
  };
}

async function issue(account: string): Promise<Record<string, string>> {
  const jar: Record<string, string> = {};
  const res: any = { cookies: { set: (name: string, value: string) => (jar[name] = value) } };
  await setDeviceTrustCookie(res, fakeReq({}), account);
  return jar;
}

describe('N3 设备信任 Cookie', () => {
  test('签发后同账号校验通过（大小写不敏感）', async () => {
    const cookies = await issue('Alice');
    expect(await hasDeviceTrust(fakeReq(cookies), 'alice')).toBe(true);
  });

  test('A 账号的 Cookie 不能当 B 账号的信任凭证', async () => {
    const alice = await issue('alice');
    expect(await hasDeviceTrust(fakeReq(alice), 'bob')).toBe(false);
    // 把 alice 的值塞进 bob 的 Cookie 名下也不行（签名绑定账号）
    const aliceValue = Object.values(alice)[0];
    const bobName = Object.keys(await issue('bob'))[0];
    expect(await hasDeviceTrust(fakeReq({ [bobName]: aliceValue }), 'bob')).toBe(false);
  });

  test('篡改时间戳或签名都无效', async () => {
    const cookies = await issue('alice');
    const [name, value] = Object.entries(cookies)[0];
    const [ts, sig] = value.split('.');
    expect(await hasDeviceTrust(fakeReq({ [name]: `${Number(ts) + 1}.${sig}` }), 'alice')).toBe(false);
    expect(await hasDeviceTrust(fakeReq({ [name]: `${ts}.${'0'.repeat(64)}` }), 'alice')).toBe(false);
    expect(await hasDeviceTrust(fakeReq({ [name]: 'garbage' }), 'alice')).toBe(false);
  });

  test('超过 30 天无效', async () => {
    const cookies = await issue('alice');
    const realNow = Date.now;
    Date.now = () => realNow() + 31 * 24 * 60 * 60 * 1000;
    try {
      expect(await hasDeviceTrust(fakeReq(cookies), 'alice')).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });

  test('没有 Cookie 时无效', async () => {
    expect(await hasDeviceTrust(fakeReq({}), 'alice')).toBe(false);
  });
});
