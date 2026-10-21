/* eslint-disable @typescript-eslint/no-explicit-any */
// 会话撤销：改密码/封禁之前签发的 cookie 必须失效；被降级的管理员立即失去管理权限

const mockCfg: any = { UserConfig: { Users: [] } };
let mockAuth: any = null;

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: () => mockAuth,
  verifyAuthSignature: async () => true,
}));
jest.mock('@/lib/config', () => ({
  getConfig: async () => mockCfg,
  invalidateConfigCache: jest.fn(),
}));

import { getVerifiedAuthUser, resetAuthRefreshCooldown } from '../auth-server';

const req: any = {};

beforeEach(() => {
  resetAuthRefreshCooldown();
  process.env.USERNAME = 'boss';
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
  mockCfg.UserConfig.Users = [];
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
