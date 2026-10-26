/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */
jest.mock('@/lib/db', () => ({
  getStorage: () => null,
}));

import type { AdminConfig } from '../admin.types';
import { ConfigConflictError, withConfigConflictRetry } from '../config';
import {
  DEFAULT_INVITE_MAX_USES,
  isInviteCodeExpired,
  isInviteCodeRequired,
  MAX_INVITE_TTL_MS,
  migrateInviteCodesOnGroupDelete,
  validateInviteCodeFormat,
  validateInviteExpiresAt,
  validateInviteMaxUses,
  verifyAndConsumeInviteCode,
  verifyInviteCodeReadOnly,
} from '../invite';
import { getSitesForUser, resolveGroups } from '../user-groups';

function createBaseConfig(): AdminConfig {
  return {
    configVersion: 1,
    SiteConfig: {
      SiteName: 'PurpleMoon',
      Announcement: '',
      SearchDownstreamMaxPage: 5,
      SiteInterfaceCacheTime: 7200,
      ImageProxy: '',
    },
    UserConfig: {
      AllowRegister: true,
      Users: [{ username: 'boss', role: 'owner' }],
    },
    GroupConfig: {
      Groups: [
        { id: 'A', name: 'A 组', allSources: true, sourceKeys: [] },
        { id: 'B', name: 'B 组', allSources: false, sourceKeys: ['s1'] },
      ],
      DefaultRegisterGroupId: 'B',
    },
    InviteConfig: {
      RequireInviteCode: true,
      Codes: [
        {
          code: '111111',
          groupId: 'A',
          maxUses: DEFAULT_INVITE_MAX_USES,
          usedCount: 0,
        },
        {
          code: '22222',
          groupId: 'B',
          maxUses: DEFAULT_INVITE_MAX_USES,
          usedCount: 0,
        },
      ],
    },
    SourceConfig: [
      {
        key: 's1',
        name: '电影天堂资源',
        api: 'https://s1.example/api',
        from: 'config',
      },
      {
        key: 's2',
        name: '量子资源',
        api: 'https://s2.example/api',
        from: 'config',
      },
    ],
  };
}

describe('后台邀请码开关、次数限制、过期时间与分组绑定 (InviteConfig)', () => {
  test('默认可用次数为 10 次，站长可自定义 1~100000 次', () => {
    expect(DEFAULT_INVITE_MAX_USES).toBe(10);
    expect(validateInviteMaxUses(undefined)).toEqual({
      ok: true,
      maxUses: 10,
    });
    expect(validateInviteMaxUses(25)).toEqual({ ok: true, maxUses: 25 });
    expect(validateInviteMaxUses(0).ok).toBe(false);
    expect(validateInviteMaxUses(-5).ok).toBe(false);
    expect(validateInviteMaxUses(1.5).ok).toBe(false);
  });

  test('后台开关不受已移除的 REQUIRE_INVITE_CODE / VALID_INVITE_CODE 环境变量影响', () => {
    const savedReq = process.env.REQUIRE_INVITE_CODE;
    const savedCode = process.env.VALID_INVITE_CODE;
    try {
      process.env.REQUIRE_INVITE_CODE = 'true';
      process.env.VALID_INVITE_CODE = 'env-secret';

      const cfgOff = createBaseConfig();
      cfgOff.InviteConfig!.RequireInviteCode = false;
      expect(isInviteCodeRequired(cfgOff)).toBe(false);

      process.env.REQUIRE_INVITE_CODE = 'false';
      const cfgOn = createBaseConfig();
      cfgOn.InviteConfig!.RequireInviteCode = true;
      expect(isInviteCodeRequired(cfgOn)).toBe(true);
    } finally {
      if (savedReq === undefined) delete process.env.REQUIRE_INVITE_CODE;
      else process.env.REQUIRE_INVITE_CODE = savedReq;
      if (savedCode === undefined) delete process.env.VALID_INVITE_CODE;
      else process.env.VALID_INVITE_CODE = savedCode;
    }
  });

  test('用 111111 注册分配到 A 组（全部资源站），用 22222 注册分配到 B 组（指定资源站）', () => {
    const cfg = createBaseConfig();

    const rA = verifyAndConsumeInviteCode(cfg, '111111');
    expect(rA).toEqual({
      ok: true,
      groupId: 'A',
      mode: 'config_code',
      consumedCode: '111111',
    });
    cfg.UserConfig.Users.push({
      username: 'user_a',
      role: 'user',
      group: rA.ok ? rA.groupId : 'B',
    });

    const rB = verifyAndConsumeInviteCode(cfg, '22222');
    expect(rB).toEqual({
      ok: true,
      groupId: 'B',
      mode: 'config_code',
      consumedCode: '22222',
    });
    cfg.UserConfig.Users.push({
      username: 'user_b',
      role: 'user',
      group: rB.ok ? rB.groupId : 'B',
    });

    expect(getSitesForUser(cfg, 'user_a').sites.map((s) => s.key)).toEqual([
      's1',
      's2',
    ]);
    expect(getSitesForUser(cfg, 'user_b').sites.map((s) => s.key)).toEqual([
      's1',
    ]);
    expect(cfg.InviteConfig!.Codes[0].usedCount).toBe(1);
    expect(cfg.InviteConfig!.Codes[1].usedCount).toBe(1);
  });

  test('邀请码达到默认 10 次上限后拒绝第 11 次注册；清零或扩容后恢复可用', () => {
    const cfg = createBaseConfig();

    for (let i = 1; i <= 10; i++) {
      const res = verifyAndConsumeInviteCode(cfg, '111111');
      expect(res.ok).toBe(true);
      expect(cfg.InviteConfig!.Codes[0].usedCount).toBe(i);
    }

    const res11 = verifyAndConsumeInviteCode(cfg, '111111');
    expect(res11.ok).toBe(false);
    if (!res11.ok) {
      expect(res11.status).toBe(403);
      expect(res11.error).toContain('最大使用次数');
    }
    expect(cfg.InviteConfig!.Codes[0].usedCount).toBe(10);

    cfg.InviteConfig!.Codes[0].maxUses = 12;
    expect(verifyAndConsumeInviteCode(cfg, '111111').ok).toBe(true);
    expect(cfg.InviteConfig!.Codes[0].usedCount).toBe(11);
  });

  test('过期时间校验 validateInviteExpiresAt 与过期拦截逻辑', () => {
    const now = 1760000000000;
    // 永不过期
    expect(validateInviteExpiresAt(undefined, now)).toEqual({
      ok: true,
      expiresAt: undefined,
    });
    expect(validateInviteExpiresAt(null, now)).toEqual({
      ok: true,
      expiresAt: undefined,
    });
    expect(validateInviteExpiresAt('', now)).toEqual({
      ok: true,
      expiresAt: undefined,
    });
    expect(validateInviteExpiresAt(0, now)).toEqual({
      ok: true,
      expiresAt: undefined,
    });

    // 合法未来时间
    const future = now + 3600 * 1000;
    expect(validateInviteExpiresAt(future, now)).toEqual({
      ok: true,
      expiresAt: future,
    });

    // 过去或当前时间被拒绝
    expect(validateInviteExpiresAt(now, now).ok).toBe(false);
    expect(validateInviteExpiresAt(now - 1000, now).ok).toBe(false);

    // 超过 10 年上限被拒绝
    expect(validateInviteExpiresAt(now + MAX_INVITE_TTL_MS + 1000, now).ok).toBe(
      false
    );

    // 验证邀请码过期前后行为
    const cfg = createBaseConfig();
    cfg.InviteConfig!.Codes[0].expiresAt = now + 5000;

    // 过期前可用
    expect(isInviteCodeExpired(cfg.InviteConfig!.Codes[0], now + 4999)).toBe(
      false
    );
    const okBefore = verifyAndConsumeInviteCode(cfg, '111111', now + 4999);
    expect(okBefore.ok).toBe(true);
    expect(cfg.InviteConfig!.Codes[0].usedCount).toBe(1);

    // 到达或超过过期时间立即拦截，且不增加 usedCount
    expect(isInviteCodeExpired(cfg.InviteConfig!.Codes[0], now + 5000)).toBe(
      true
    );
    const failAtExpiry = verifyAndConsumeInviteCode(cfg, '111111', now + 5000);
    expect(failAtExpiry).toEqual({
      ok: false,
      status: 403,
      error: '该邀请码已过期',
    });
    expect(cfg.InviteConfig!.Codes[0].usedCount).toBe(1);

    // 站长延长有效期或改为永不过期后恢复可用
    delete cfg.InviteConfig!.Codes[0].expiresAt;
    const okAfterClear = verifyAndConsumeInviteCode(cfg, '111111', now + 99999);
    expect(okAfterClear.ok).toBe(true);
    expect(cfg.InviteConfig!.Codes[0].usedCount).toBe(2);
  });

  test('高并发乐观锁保护：剩余 2 次可用时并发抢注不会突破 maxUses 上限', async () => {
    const dbState: AdminConfig = createBaseConfig();
    dbState.InviteConfig!.Codes[0].maxUses = 10;
    dbState.InviteConfig!.Codes[0].usedCount = 8;

    const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

    const mockStorage = {
      getAdminConfig: async () => clone(dbState),
      setAdminConfig: async (next: AdminConfig) => {
        if ((next.configVersion ?? 0) !== (dbState.configVersion ?? 0)) {
          throw new ConfigConflictError('version conflict');
        }
        next.configVersion = (dbState.configVersion ?? 0) + 1;
        Object.assign(dbState, clone(next));
      },
    };

    const simulateRegister = async (uname: string) => {
      return await withConfigConflictRetry(async () => {
        const fresh = await mockStorage.getAdminConfig();
        const res = verifyAndConsumeInviteCode(fresh, '111111');
        if (!res.ok) return res;
        fresh.UserConfig.Users.push({
          username: uname,
          role: 'user',
          group: res.groupId,
        });
        await mockStorage.setAdminConfig(fresh);
        return res;
      }, 10);
    };

    const tasks = Array.from({ length: 8 }, (_, idx) =>
      simulateRegister(`concurrent_u_${idx}`)
    );
    const results = await Promise.all(tasks);
    const successes = results.filter((r) => r.ok);
    const failures = results.filter((r) => !r.ok);

    expect(successes).toHaveLength(2);
    expect(failures).toHaveLength(6);
    expect(dbState.InviteConfig!.Codes[0].usedCount).toBe(10);
  });

  test('尚未手动启用分组时，使用邀请码注册会自动初始化 A/B 分组并生效', () => {
    const cfg = createBaseConfig();
    delete cfg.GroupConfig;

    const res = verifyAndConsumeInviteCode(cfg, '22222');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.groupId).toBe('B');
    }
    expect(resolveGroups(cfg).configured).toBe(true);
  });

  test('分组被删除时，绑定该分组的邀请码自动迁移且不悬空', () => {
    const cfg = createBaseConfig();
    cfg.GroupConfig!.Groups!.push({
      id: 'g_custom',
      name: 'C 组',
      allSources: false,
      sourceKeys: ['s2'],
    });
    cfg.InviteConfig!.Codes.push({
      code: '33333',
      groupId: 'g_custom',
      maxUses: 10,
      usedCount: 0,
    });

    migrateInviteCodesOnGroupDelete(cfg, 'g_custom', 'B');
    expect(
      cfg.InviteConfig!.Codes.find((c) => c.code === '33333')?.groupId
    ).toBe('B');

    cfg.InviteConfig!.Codes.find((c) => c.code === '33333')!.groupId =
      'g_non_existent';
    const check = verifyInviteCodeReadOnly(cfg, '33333');
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.groupId).toBe('B');
    }
  });

  test('邀请码区分大小写，错误或为空时提示区分大小写', () => {
    const cfg = createBaseConfig();
    cfg.InviteConfig!.Codes.push({
      code: 'AbCdEf',
      groupId: 'A',
      maxUses: 10,
      usedCount: 0,
    });
    const wrongCase = verifyInviteCodeReadOnly(cfg, 'abcdef');
    expect(wrongCase.ok).toBe(false);
    if (!wrongCase.ok) {
      expect(wrongCase.error).toContain('区分大小写');
    }
    const emptyRes = verifyInviteCodeReadOnly(cfg, '');
    expect(emptyRes.ok).toBe(false);
    if (!emptyRes.ok) {
      expect(emptyRes.error).toContain('区分大小写');
    }
    const exactCase = verifyInviteCodeReadOnly(cfg, 'AbCdEf');
    expect(exactCase.ok).toBe(true);
  });

  test('validateInviteCodeFormat 校验合法与非法字符', () => {
    expect(validateInviteCodeFormat(' 111111 ')).toEqual({
      ok: true,
      code: '111111',
    });
    expect(validateInviteCodeFormat('22222')).toEqual({
      ok: true,
      code: '22222',
    });
    expect(validateInviteCodeFormat('VIP_2026-A')).toEqual({
      ok: true,
      code: 'VIP_2026-A',
    });
    expect(validateInviteCodeFormat('').ok).toBe(false);
    expect(validateInviteCodeFormat('has space').ok).toBe(false);
    expect(validateInviteCodeFormat('<script>').ok).toBe(false);
  });
});
