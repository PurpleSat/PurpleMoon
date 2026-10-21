/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-explicit-any */
// 管理员修改自己的密码：写入 sessionsValidAfter 作废旧会话，同时给当前浏览器重签 cookie 防止被踢下线；
// 修改他人密码则不重签。

const cfg: any = {
  configVersion: 1,
  UserConfig: {
    AllowRegister: false,
    Users: [
      { username: 'adm', role: 'admin' },
      { username: 'bob', role: 'user' },
    ],
  },
};
const changePassword = jest.fn(async () => undefined);
const setAdminConfig = jest.fn(async () => undefined);

// Jest 27 的 node 环境没有全局 Request/Response，这里用最小替身
jest.mock('next/server', () => ({
  NextRequest: class {},
  NextResponse: {
    json: (body: any, init: any = {}) => {
      const h = new Map<string, string>(Object.entries(init.headers || {}));
      return {
        status: init.status ?? 200,
        body,
        headers: { get: (k: string) => h.get(k) ?? null, set: (k: string, v: string) => h.set(k, v) },
      };
    },
  },
}));
jest.mock('@/lib/auth-server', () => ({
  getVerifiedAuthUser: async () => ({ username: 'adm', role: 'admin' }),
}));
jest.mock('@/lib/csrf-guard', () => ({ checkCsrf: () => ({ ok: true }) }));
jest.mock('@/lib/config', () => ({
  getConfig: async () => cfg,
  withConfigConflictRetry: async (fn: () => Promise<any>) => fn(),
}));
jest.mock('@/lib/db', () => ({
  getStorage: () => ({ changePassword, setAdminConfig }),
}));
jest.mock('@/lib/cookies', () => ({
  readLimitedJson: async (req: any) => ({ ok: true, data: await req.json() }),
  buildAuthCookieValue: async () => 'fresh-cookie-value',
  setAuthCookies: (res: any) => res.headers.set('x-test-reissued', '1'),
}));

import { POST } from '@/app/api/admin/user/route';

function call(targetUsername: string) {
  const req: any = {
    json: async () => ({ action: 'changePassword', targetUsername, targetPassword: 'newpass123' }),
  };
  return POST(req);
}

beforeEach(() => {
  process.env.USERNAME = 'boss';
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
  changePassword.mockClear();
  setAdminConfig.mockClear();
  cfg.UserConfig.Users.forEach((u: any) => delete u.sessionsValidAfter);
});

test('管理员改自己的密码：旧会话作废且当前会话重签 cookie', async () => {
  const res = await call('adm');
  expect(res.status).toBe(200);
  expect(changePassword).toHaveBeenCalledWith('adm', 'newpass123');
  expect(typeof cfg.UserConfig.Users[0].sessionsValidAfter).toBe('number');
  expect(res.headers.get('x-test-reissued')).toBe('1');
});

test('管理员改他人密码：对方会话作废，但不给当前管理员重签', async () => {
  const res = await call('bob');
  expect(res.status).toBe(200);
  expect(typeof cfg.UserConfig.Users[1].sessionsValidAfter).toBe('number');
  expect(res.headers.get('x-test-reissued')).toBeNull();
});
