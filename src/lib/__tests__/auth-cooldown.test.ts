/* eslint-disable @typescript-eslint/no-explicit-any */
// 按用户名隔离的强制刷新冷却：已删用户的旧 cookie 不能阻塞其他新用户的首次请求，也不能反复击穿缓存

let stale = true;
let refreshCount = 0;
const users: any[] = [];

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: () => (global as any).__auth,
  verifyAuthSignature: async () => true,
}));
jest.mock('@/lib/config', () => ({
  getConfig: async () => ({ UserConfig: { Users: stale ? [] : users } }),
  invalidateConfigCache: () => {
    refreshCount++;
    stale = false;
  },
}));

import { getVerifiedAuthUser, resetAuthRefreshCooldown } from '../auth-server';

const as = (username: string) => {
  (global as any).__auth = { username, role: 'user', timestamp: Date.now(), signature: 'x' };
};

beforeEach(() => {
  process.env.USERNAME = 'boss';
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
  resetAuthRefreshCooldown();
  stale = true;
  refreshCount = 0;
  users.length = 0;
  users.push({ username: 'newbie', role: 'user' });
});

test('已删用户的旧 cookie 触发刷新后，另一个新用户 5 秒内首次请求不会被误判 401', async () => {
  as('ghost');
  expect(await getVerifiedAuthUser({} as any)).toBeNull();
  stale = true; // 缓存再次变旧（如其它实例刚写入新用户）
  as('newbie');
  expect(await getVerifiedAuthUser({} as any)).not.toBeNull();
});

test('同一个已删用户反复请求，5 秒内只会强制刷新一次存储', async () => {
  as('ghost');
  for (let i = 0; i < 10; i++) {
    stale = true;
    expect(await getVerifiedAuthUser({} as any)).toBeNull();
  }
  expect(refreshCount).toBe(1);
});
