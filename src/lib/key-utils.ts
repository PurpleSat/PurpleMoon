/* eslint-disable @typescript-eslint/no-explicit-any */
import { Favorite, PlayRecord } from './types';

// source：资源站 key；id：资源站内的视频 ID。
// 严格白名单，杜绝特殊字符（':' '*' '?' 等）进入 Redis 键名 / SQL 键值，
// 避免用户通过构造 key 污染 `u:*:pwd` 等键空间或写入超大垃圾数据。
const SOURCE_RE = /^[\w-]{1,50}$/;
const ID_RE = /^[\w-]{1,100}$/;

export function parseMediaKey(
  key: unknown
): { source: string; id: string } | null {
  if (typeof key !== 'string' || key.length > 160) return null;
  const parts = key.split('+');
  if (parts.length !== 2) return null;
  const [source, id] = parts;
  if (!SOURCE_RE.test(source) || !ID_RE.test(id)) return null;
  return { source, id };
}

function str(v: unknown, max: number, fallback = ''): string {
  return typeof v === 'string' ? v.slice(0, max) : fallback;
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function cover(v: unknown): string {
  const s = str(v, 1000).trim();
  return /^(https?:)?\/\//i.test(s) ? s : '';
}

function saveTime(v: unknown): number {
  const now = Date.now();
  return num(v, 0, now + 24 * 60 * 60 * 1000, now);
}

/** 只保留已知字段并限制长度/范围；不合法返回 null */
export function sanitizePlayRecord(input: any): PlayRecord | null {
  if (!input || typeof input !== 'object') return null;
  const title = str(input.title, 200).trim();
  const sourceName = str(input.source_name, 100).trim();
  const index = Math.floor(num(input.index, 1, 100000, NaN));
  if (!title || !sourceName || !Number.isFinite(index)) return null;

  return {
    title,
    source_name: sourceName,
    cover: cover(input.cover),
    year: str(input.year, 20),
    index,
    total_episodes: Math.floor(num(input.total_episodes, 0, 100000, 0)),
    play_time: num(input.play_time, 0, 86400 * 10, 0),
    total_time: num(input.total_time, 0, 86400 * 10, 0),
    save_time: saveTime(input.save_time),
    search_title: str(input.search_title, 200),
  };
}

export function sanitizeFavorite(input: any): Favorite | null {
  if (!input || typeof input !== 'object') return null;
  const title = str(input.title, 200).trim();
  const sourceName = str(input.source_name, 100).trim();
  if (!title || !sourceName) return null;

  return {
    title,
    source_name: sourceName,
    cover: cover(input.cover),
    year: str(input.year, 20),
    total_episodes: Math.floor(num(input.total_episodes, 0, 100000, 0)),
    save_time: saveTime(input.save_time),
    search_title: str(input.search_title, 200),
  };
}
