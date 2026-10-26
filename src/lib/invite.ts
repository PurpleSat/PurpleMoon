import type { AdminConfig, InviteCodeItem } from './admin.types';
import { timingSafeEqual } from './password';
import {
  getDefaultRegisterGroup,
  LEGACY_GROUP_A,
  LEGACY_GROUP_B,
  migrateGroupConfig,
  resolveGroups,
} from './user-groups';

export const DEFAULT_INVITE_MAX_USES = 10;
export const MAX_INVITE_CODES = 200;
export const MAX_INVITE_CODE_LENGTH = 64;
export const MAX_INVITE_NOTE_LENGTH = 50;
export const MAX_INVITE_USES_LIMIT = 100000;
/** 邀请码最长有效期跨度：10 年（毫秒） */
export const MAX_INVITE_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/**
 * 是否强制邀请码注册。
 * 完全由管理后台 config.InviteConfig.RequireInviteCode 控制（默认关闭）。
 */
export function isInviteCodeRequired(
  config?: Pick<AdminConfig, 'InviteConfig'> | null
): boolean {
  if (
    config?.InviteConfig &&
    typeof config.InviteConfig.RequireInviteCode === 'boolean'
  ) {
    return config.InviteConfig.RequireInviteCode;
  }
  return process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true';
}

/**
 * 确保分组配置已初始化（当站长在后台创建绑定分组的邀请码，但尚未手动点击“启用分组功能”时，
 * 自动初始化默认的 A 组与 B 组，保证邀请码的 A 组 / B 组分配立即生效）。
 */
export function ensureGroupsInitialized(config: AdminConfig): void {
  const migrated = migrateGroupConfig(config);
  if (migrated) {
    config.GroupConfig = migrated;
    return;
  }
  const enabledKeys = (config.SourceConfig || [])
    .filter((s) => !s.disabled)
    .map((s) => s.key);
  config.GroupConfig = {
    Groups: [
      { id: LEGACY_GROUP_A, name: 'A 组', allSources: true, sourceKeys: [] },
      {
        id: LEGACY_GROUP_B,
        name: 'B 组',
        allSources: false,
        sourceKeys: enabledKeys,
      },
    ],
    DefaultRegisterGroupId: LEGACY_GROUP_B,
  };
  (config.UserConfig?.Users || []).forEach((u) => {
    if (u.role !== 'owner' && !u.group) {
      u.group = LEGACY_GROUP_A;
    }
  });
}

/** 校验邀请码格式：1~64 位字母、数字、下划线或连字符 */
export function validateInviteCodeFormat(
  code: unknown
): { ok: true; code: string } | { ok: false; error: string } {
  if (typeof code !== 'string') {
    return { ok: false, error: '邀请码格式无效' };
  }
  const trimmed = code.trim();
  if (trimmed.length < 1) {
    return { ok: false, error: '邀请码不能为空' };
  }
  if (trimmed.length > MAX_INVITE_CODE_LENGTH) {
    return {
      ok: false,
      error: `邀请码长度不能超过 ${MAX_INVITE_CODE_LENGTH} 个字符`,
    };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return {
      ok: false,
      error: '邀请码仅允许包含字母、数字、下划线及连字符',
    };
  }
  return { ok: true, code: trimmed };
}

/** 校验最大可使用次数：默认 10，范围 1 ~ 100000 的整数 */
export function validateInviteMaxUses(
  maxUses: unknown
): { ok: true; maxUses: number } | { ok: false; error: string } {
  if (maxUses === undefined || maxUses === null || maxUses === '') {
    return { ok: true, maxUses: DEFAULT_INVITE_MAX_USES };
  }
  const num = typeof maxUses === 'number' ? maxUses : Number(maxUses);
  if (!Number.isInteger(num) || num < 1 || num > MAX_INVITE_USES_LIMIT) {
    return {
      ok: false,
      error: `可使用次数必须为 1 ~ ${MAX_INVITE_USES_LIMIT} 之间的整数`,
    };
  }
  return { ok: true, maxUses: num };
}

/**
 * 校验邀请码过期时间：
 * - undefined / null / '' / 0 表示永不过期（返回 expiresAt: undefined）；
 * - 支持毫秒级时间戳（整数）或可被 Date.parse 解析的日期时间字符串；
 * - 设置时必须晚于当前时间（now），且不超过未来 10 年。
 */
export function validateInviteExpiresAt(
  expiresAt: unknown,
  now = Date.now()
): { ok: true; expiresAt: number | undefined } | { ok: false; error: string } {
  if (
    expiresAt === undefined ||
    expiresAt === null ||
    expiresAt === '' ||
    expiresAt === 0 ||
    expiresAt === '0'
  ) {
    return { ok: true, expiresAt: undefined };
  }

  let ts: number;
  if (typeof expiresAt === 'number') {
    ts = expiresAt;
  } else if (typeof expiresAt === 'string') {
    const trimmed = expiresAt.trim();
    if (!trimmed) return { ok: true, expiresAt: undefined };
    ts = /^\d+$/.test(trimmed) ? Number(trimmed) : Date.parse(trimmed);
  } else {
    return { ok: false, error: '过期时间格式无效' };
  }

  if (!Number.isFinite(ts) || ts <= 0) {
    return { ok: false, error: '过期时间格式无效' };
  }
  const rounded = Math.floor(ts);
  if (rounded <= now) {
    return { ok: false, error: '过期时间必须晚于当前时间' };
  }
  if (rounded > now + MAX_INVITE_TTL_MS) {
    return { ok: false, error: '过期时间跨度不能超过 10 年' };
  }
  return { ok: true, expiresAt: rounded };
}

/** 判断邀请码是否已过期 */
export function isInviteCodeExpired(
  item: Pick<InviteCodeItem, 'expiresAt'>,
  now = Date.now()
): boolean {
  return (
    typeof item.expiresAt === 'number' &&
    Number.isFinite(item.expiresAt) &&
    item.expiresAt > 0 &&
    now >= item.expiresAt
  );
}

/** 校验备注：选填，最多 50 字符且不含控制字符 */
export function validateInviteNote(
  note: unknown
): { ok: true; note: string } | { ok: false; error: string } {
  if (note === undefined || note === null) {
    return { ok: true, note: '' };
  }
  if (typeof note !== 'string') {
    return { ok: false, error: '备注格式无效' };
  }
  const trimmed = note.trim();
  if (trimmed.length > MAX_INVITE_NOTE_LENGTH) {
    return {
      ok: false,
      error: `备注不能超过 ${MAX_INVITE_NOTE_LENGTH} 个字符`,
    };
  }
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed.charCodeAt(i);
    if (c < 32 || c === 127) {
      return { ok: false, error: '备注包含非法字符' };
    }
  }
  return { ok: true, note: trimmed };
}

/**
 * 解析邀请码对应的有效分组 id：
 * - 若目标分组存在于已启用的分组列表中，返回该分组 id；
 * - 若目标分组已被删除或不存在，安全回退到默认注册分组（绝不越权提升权限）。
 */
export function resolveInviteTargetGroup(
  config: Pick<AdminConfig, 'GroupConfig'>,
  codeGroupId: string | undefined
): string {
  const r = resolveGroups(config);
  if (!r.configured) {
    if (codeGroupId === LEGACY_GROUP_A || codeGroupId === LEGACY_GROUP_B) {
      return codeGroupId;
    }
    return getDefaultRegisterGroup(config);
  }
  if (codeGroupId && r.groups.some((g) => g.id === codeGroupId)) {
    return codeGroupId;
  }
  return r.defaultId;
}

export type InviteVerifySuccess = {
  ok: true;
  groupId: string;
  mode: 'not_required' | 'config_code';
  consumedCode?: string;
};

export type InviteVerifyFailure = {
  ok: false;
  status: number;
  error: string;
};

export type InviteVerifyResult = InviteVerifySuccess | InviteVerifyFailure;

/**
 * 校验邀请码（只读，不扣减次数）。
 * 使用恒定时间比较遍历全部邀请码，避免时序侧信道泄露邀请码内容或数量。
 */
export function verifyInviteCodeReadOnly(
  config: AdminConfig,
  inputCode: string | undefined,
  now = Date.now()
): InviteVerifyResult & { matchedItem?: InviteCodeItem } {
  const required = isInviteCodeRequired(config);
  if (!required) {
    return {
      ok: true,
      groupId: getDefaultRegisterGroup(config),
      mode: 'not_required',
    };
  }

  const trimmedInput = typeof inputCode === 'string' ? inputCode.trim() : '';
  if (!trimmedInput) {
    return {
      ok: false,
      status: 400,
      error: '系统已开启邀请制，必须填写邀请码（区分大小写）才可注册',
    };
  }

  const rawCodes = config.InviteConfig?.Codes;
  const configuredCodes: InviteCodeItem[] = Array.isArray(rawCodes)
    ? rawCodes
    : [];

  if (configuredCodes.length > 0) {
    let matchedItem: InviteCodeItem | undefined;
    for (const item of configuredCodes) {
      if (typeof item.code !== 'string') continue;
      const isMatch = timingSafeEqual(trimmedInput, item.code);
      if (isMatch && !matchedItem) {
        matchedItem = item;
      }
    }

    if (!matchedItem) {
      return {
        ok: false,
        status: 403,
        error: '邀请码错误或已失效（注意区分大小写）',
      };
    }

    if (isInviteCodeExpired(matchedItem, now)) {
      return {
        ok: false,
        status: 403,
        error: '该邀请码已过期',
      };
    }

    const used = Number.isFinite(matchedItem.usedCount)
      ? matchedItem.usedCount
      : 0;
    const max = Number.isFinite(matchedItem.maxUses)
      ? matchedItem.maxUses
      : DEFAULT_INVITE_MAX_USES;

    if (used >= max) {
      return {
        ok: false,
        status: 403,
        error: '该邀请码已达到最大使用次数上限',
      };
    }

    return {
      ok: true,
      groupId: resolveInviteTargetGroup(config, matchedItem.groupId),
      mode: 'config_code',
      consumedCode: matchedItem.code,
      matchedItem,
    };
  }

  // 邀请码仅由后台管理：要求邀请码但后台尚未添加任何邀请码时，直接提示联系站长（不再回退环境变量）
  return {
    ok: false,
    status: 403,
    error: '系统暂无可用邀请码，请联系站长获取',
  };
}

/**
 * 校验并在内存中原子递增邀请码已使用次数（配合 withConfigConflictRetry + setAdminConfig 落盘）。
 * 若校验通过且邀请码绑定的分组为 'A' 或 'B' 但尚未初始化 GroupConfig，会自动初始化默认分组。
 */
export function verifyAndConsumeInviteCode(
  config: AdminConfig,
  inputCode: string | undefined,
  now = Date.now()
): InviteVerifyResult {
  const res = verifyInviteCodeReadOnly(config, inputCode, now);
  if (!res.ok) return res;

  if (res.mode === 'config_code' && res.matchedItem) {
    res.matchedItem.usedCount =
      (Number.isFinite(res.matchedItem.usedCount)
        ? res.matchedItem.usedCount
        : 0) + 1;
    // 确保分组已启用，使邀请码绑定的分组立即生效
    if (!resolveGroups(config).configured) {
      ensureGroupsInitialized(config);
    }
    const resolvedGroupId = resolveInviteTargetGroup(
      config,
      res.matchedItem.groupId
    );
    return {
      ok: true,
      groupId: resolvedGroupId,
      mode: 'config_code',
      consumedCode: res.matchedItem.code,
    };
  }

  return {
    ok: true,
    groupId: res.groupId,
    mode: res.mode,
    consumedCode: res.consumedCode,
  };
}

/**
 * 删除分组时，将该分组下绑定的邀请码自动迁移至目标分组（或默认注册分组），防止产生悬空分组引用。
 */
export function migrateInviteCodesOnGroupDelete(
  config: AdminConfig,
  deletedGroupId: string,
  fallbackGroupId: string
): void {
  const codes = config.InviteConfig?.Codes;
  if (!Array.isArray(codes) || codes.length === 0) return;
  codes.forEach((item) => {
    if (item.groupId === deletedGroupId) {
      item.groupId = fallbackGroupId;
    }
  });
}
