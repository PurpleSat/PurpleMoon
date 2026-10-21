/* eslint-disable @typescript-eslint/no-explicit-any */
// 会话撤销与按用户隔离的防穿透刷新测试：
// 1. 改密码/封禁之前签发的 cookie 必须失效
// 2. 被降级的管理员立即失去管理权限
// 3. 已删除用户重复请求在 5 秒内仅触发 1 次强制刷新（防缓存击穿 DoS）
// 4. 已删除用户的冷却窗口绝不阻塞同一时刻新注册用户的首次请求（修复全局冷却误伤新用户）

const mockCfg: any = { UserConfig: { Users: [] } };
let mockAuth: any = null;
const mockInvalidate = jest.fn();

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: () => mockAuth,
  verifyAuthSignature: async () => true,
}));
jest.mock('@/lib/config', () => ({
  getConfig: async () => mockCfg,
  invalidateConfigCache: () => mockInvalidate(),
}));

import { getVerifiedAuthUser, resetAuthRefreshCooldown } from '../auth-server';

const req: any = {};

beforeEach(() => {
  process.env.USERNAME = 'boss';
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
  mockCfg.UserConfig.Users = [];
  mockInvalidate.mockReset();
  resetAuthRefreshCooldown();
});

function cookie(username: string, role: string, timestamp: number) {
  mockAuth = { username, role, timestamp, signature: 'x' };
}

test('正常用户通过', async () => {
  mockCfg.UserConfig.Users = [{ username: 'a', role: 'user' }];
  cookie('a', 'user', Date.now());
  expect(await getVerifiedAuthUser(req)).toMatchObject({ username: 'a' });
});

test('改密码之前签发的 cookie 被拒绝，之后签发的通过', async () => {
  const t = Date.now();
  mockCfg.UserConfig.Users = [{ username: 'a', role: 'user', sessionsValidAfter: t }];
  cookie('a', 'user', t - 1000);
  expect(await getVerifiedAuthUser(req)).toBeNull();
  cookie('a', 'user', t + 1000);
  expect(await getVerifiedAuthUser(req)).not.toBeNull();
});

test('被降级的管理员访问管理接口被拒绝', async () => {
  mockCfg.UserConfig.Users = [{ username: 'a', role: 'user' }];
  cookie('a', 'admin', Date.now());
  expect(await getVerifiedAuthUser(req, { requiredRole: 'admin' })).toBeNull();
});

test('已被封禁的用户被拒绝', async () => {
  mockCfg.UserConfig.Users = [{ username: 'a', role: 'user', banned: true }];
  cookie('a', 'user', Date.now());
  expect(await getVerifiedAuthUser(req)).toBeNull();
});

test('已删除用户高频重放旧 cookie 在 5 秒内仅触发 1 次强制刷新，但绝不阻塞新注册用户的首次请求', async () => {
  // 1. 已删除用户 ghost 重放旧 cookie：第一次触发刷新，紧接着第二次被单用户冷却拦截
  cookie('ghost', 'user', Date.now());
  expect(await getVerifiedAuthUser(req)).toBeNull();
  expect(mockInvalidate).toHaveBeenCalledTimes(1);

  expect(await getVerifiedAuthUser(req)).toBeNull();
  expect(mockInvalidate).toHaveBeenCalledTimes(1);

  // 2. 同一时刻新注册用户 alice 首次请求：缓存刷新后出现在 Users 中，不应受 ghost 的冷却影响
  mockInvalidate.mockImplementationOnce(() => {
    mockCfg.UserConfig.Users = [{ username: 'alice', role: 'user' }];
  });
  cookie('alice', 'user', Date.now());
  const verifiedAlice = await getVerifiedAuthUser(req);
  expect(mockInvalidate).toHaveBeenCalledTimes(2);
  expect(verifiedAlice).toMatchObject({ username: 'alice', role: 'user' });
});
