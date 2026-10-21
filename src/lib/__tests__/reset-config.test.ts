/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-explicit-any */
// 重置配置不得“复活”已封禁用户或已吊销的旧会话，也不得让受限用户升级分组

let saved: any = null;
const prev: any = {
  configVersion: 3,
  UserConfig: {
    AllowRegister: false,
    Users: [
      { username: 'boss', role: 'owner' },
      { username: 'bad', role: 'user', banned: true, group: 'g1', sessionsValidAfter: 1234567890 },
      { username: 'ok', role: 'user', group: 'g1' },
    ],
  },
  GroupConfig: { Groups: [{ id: 'g1', name: 'G1', allSources: false, sourceKeys: [] }] },
};

jest.mock('@/lib/db', () => ({
  getStorage: () => ({
    getAllUsers: async () => ['bad', 'ok', 'fresh'],
    getAdminConfig: async () => prev,
    setAdminConfig: async (c: any) => {
      saved = c;
    },
  }),
}));

import { resetConfig } from '../config';

test('resetConfig 保留 banned、sessionsValidAfter 与分组；新用户不受影响', async () => {
  process.env.USERNAME = 'boss';
  delete process.env.DOCKER_ENV;
  await resetConfig();
  const by = (n: string) => saved.UserConfig.Users.find((u: any) => u.username === n);
  expect(by('bad')).toMatchObject({ banned: true, sessionsValidAfter: 1234567890, group: 'g1' });
  expect(by('ok').banned).toBeUndefined();
  expect(by('ok').group).toBe('g1');
  expect(by('fresh')).toBeDefined();
  expect(by('fresh').banned).toBeUndefined();
  expect(by('fresh').sessionsValidAfter).toBeUndefined();
});
