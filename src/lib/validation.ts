import { z } from 'zod';

import { Favorite, PlayRecord } from '@/lib/types';

// 写入存储的用户数据必须有明确的字段与长度上限：
// 否则任意已登录用户都可以向 Redis / D1 灌入超大或带任意额外字段的 JSON，耗尽存储。

const short = (max: number) => z.string().max(max);
const num = z.number().finite();

// 🛡️ 安全修复 (SEC-NEW-08)：严格白名单校验 source 与 id，防止特殊字符（':' '*' '?' '+' 等）污染键空间
const SOURCE_RE = /^[\w-]{1,50}$/;
const ID_RE = /^[\w-]{1,100}$/;

/** `source+id` 形式的记录键；source 与 id 仅允许字母、数字、下划线与连字符 */
export function parseRecordKey(
  key: unknown
): { source: string; id: string } | null {
  if (typeof key !== 'string' || key.length > 160) return null;
  const parts = key.split('+');
  if (parts.length !== 2) return null;
  const [source, id] = parts;
  if (!SOURCE_RE.test(source) || !ID_RE.test(id)) return null;
  return { source, id };
}

/** 仅允许空字符串或 http(s):// / // 开头的封面地址，阻止 javascript: / data: 等危险协议 */
function sanitizeCoverUrl(v: string | undefined): string {
  const trimmed = (v || '').trim();
  if (!trimmed) return '';
  return /^(https?:)?\/\//i.test(trimmed) ? trimmed : '';
}

/** 限制 save_time 在合理时间范围内，避免写入负数或远超当前时间的异常时间戳 */
function clampSaveTime(v: number | undefined): number {
  const now = Date.now();
  if (typeof v !== 'number' || !Number.isFinite(v)) return now;
  return Math.min(Math.max(v, 0), now + 24 * 60 * 60 * 1000);
}

const playRecordSchema = z.object({
  title: short(300).min(1),
  source_name: short(100).min(1),
  cover: short(2000).default(''),
  year: short(20).default(''),
  index: num.int().min(1).max(100000),
  total_episodes: num.int().min(0).max(100000),
  play_time: num.min(0).max(1e8),
  total_time: num.min(0).max(1e8),
  save_time: num.optional(),
  search_title: short(300).default(''),
});

const favoriteSchema = z.object({
  title: short(300).min(1),
  source_name: short(100).min(1),
  cover: short(2000).default(''),
  year: short(20).default(''),
  total_episodes: num.int().min(0).max(100000),
  save_time: num.optional(),
  search_title: short(300).default(''),
});

export function parsePlayRecord(
  input: unknown
): { ok: true; data: PlayRecord } | { ok: false; error: string } {
  const r = playRecordSchema.safeParse(input);
  if (!r.success) return { ok: false, error: 'Invalid record data' };
  return {
    ok: true,
    data: {
      ...r.data,
      cover: sanitizeCoverUrl(r.data.cover),
      save_time: clampSaveTime(r.data.save_time),
    } as PlayRecord,
  };
}

export function parseFavorite(
  input: unknown
): { ok: true; data: Favorite } | { ok: false; error: string } {
  const r = favoriteSchema.safeParse(input);
  if (!r.success) return { ok: false, error: 'Invalid favorite data' };
  return {
    ok: true,
    data: {
      ...r.data,
      cover: sanitizeCoverUrl(r.data.cover),
      save_time: clampSaveTime(r.data.save_time),
    } as Favorite,
  };
}
