import { z } from 'zod';

import { Favorite, PlayRecord } from '@/lib/types';

// 写入存储的用户数据必须有明确的字段与长度上限：
// 否则任意已登录用户都可以向 Redis / D1 灌入超大或带任意额外字段的 JSON，耗尽存储。

const short = (max: number) => z.string().max(max);
const num = z.number().finite();

/** `source+id` 形式的记录键；source 与 id 都不允许包含 '+' 或控制字符 */
export function parseRecordKey(
  key: unknown
): { source: string; id: string } | null {
  if (typeof key !== 'string' || key.length > 200) return null;
  const parts = key.split('+');
  if (parts.length !== 2) return null;
  const [source, id] = parts;
  const isValidPart = (v: string) =>
    v.length >= 1 &&
    v.length <= 100 &&
    // 排除空白、控制字符与 Redis glob 通配符
    !Array.from(v).some((ch) => {
      const c = ch.charCodeAt(0);
      return c <= 0x20 || c === 0x7f || '*?[]\\'.includes(ch);
    });
  if (!isValidPart(source) || !isValidPart(id)) return null;
  return { source, id };
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
    data: { ...r.data, save_time: r.data.save_time ?? Date.now() } as PlayRecord,
  };
}

export function parseFavorite(
  input: unknown
): { ok: true; data: Favorite } | { ok: false; error: string } {
  const r = favoriteSchema.safeParse(input);
  if (!r.success) return { ok: false, error: 'Invalid favorite data' };
  return {
    ok: true,
    data: { ...r.data, save_time: r.data.save_time ?? Date.now() } as Favorite,
  };
}
