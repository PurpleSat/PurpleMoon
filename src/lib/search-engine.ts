import { ApiSite } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { SearchResult } from '@/lib/types';

// ============================================================================
// 多源并发搜索引擎
//
// 旧实现把资源站按 6 个一批分批 await：每批都要等最慢的那个源（首页最多 3.5s，
// 翻页再 8s），几十个源叠加后可达数十秒。现在：
//   1. 固定大小的并发池（有界出站并发，不会一瞬间打出几十个请求）
//   2. 整体截止时间：到点后不再发起新请求，进行中的请求也被限制在剩余时间内
//   3. 逐源回调：流式接口可以“搜到一个源就推一个源”
//   4. 短时结果缓存：同一关键词重复搜索 / 换源页面几乎瞬时返回
//   5. 坏源短时熔断：超时/报错的资源站 45 秒内直接跳过，不再拖慢后续搜索
// ============================================================================

export const SEARCH_CONCURRENCY = 8;
export const SEARCH_DEADLINE_MS = 8000;

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

const cache = new Map<string, { at: number; data: SearchResult[] }>();

// 短时熔断：某个资源站刚刚超时 / 报错，接下来一小段时间直接跳过它，
// 否则每次搜索都要为同一个坏源白等 3.5 秒，还会占用并发名额拖慢其他源。
const FAILURE_COOLDOWN_MS = 45 * 1000;
const failedUntil = new Map<string, number>();

function isCoolingDown(siteKey: string): boolean {
  const until = failedUntil.get(siteKey);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    failedUntil.delete(siteKey);
    return false;
  }
  return true;
}

function cacheGet(key: string): SearchResult[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(key: string, data: SearchResult[]) {
  // 空结果可能是超时/失败造成的，不缓存，避免把故障“固化”5 分钟
  if (data.length === 0) return;
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), data });
}

// ---------------------------------------------------------------------------
// 限流（/api/search 与 /api/search/stream 共用同一份计数）
// 🛡️ 安全加固 (SEC-08)：轻量级内存限流，防止搜索接口被滥用做反射 DDoS
// 注意：这是“每个实例各自计数”的内存限流，多实例部署请在代理层再加一层限流。
// ---------------------------------------------------------------------------
const rateMap = new Map<string, { count: number; timestamp: number }>();

export function checkSearchRateLimit(
  ip: string,
  maxRequests = 30,
  windowMs = 60000
): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);

  rateMap.forEach((v, k) => {
    if (now - v.timestamp > windowMs) rateMap.delete(k);
  });

  if (entry && now - entry.timestamp < windowMs) {
    if (entry.count >= maxRequests) return false;
    entry.count++;
  } else {
    rateMap.set(ip, { count: 1, timestamp: now });
  }
  return true;
}

// ---------------------------------------------------------------------------

export interface SourceChunk {
  source: string;
  results: SearchResult[];
}

export interface RunSearchOptions {
  /** 每当某个源有新结果（首页 / 后续页 / 缓存命中）时回调 */
  onChunk?: (chunk: SourceChunk) => void;
  /** 调用方断开连接时中止，不再发起新的上游请求 */
  signal?: AbortSignal;
  deadlineMs?: number;
  concurrency?: number;
}

/**
 * 并发搜索全部资源站。返回值按资源站配置顺序排列（与旧实现一致），
 * 与完成先后无关，因此结果顺序是确定的。
 */
export async function runSearch(
  sites: ApiSite[],
  query: string,
  opts: RunSearchOptions = {}
): Promise<SearchResult[]> {
  const deadline = Date.now() + (opts.deadlineMs ?? SEARCH_DEADLINE_MS);
  const concurrency = Math.max(
    1,
    Math.min(opts.concurrency ?? SEARCH_CONCURRENCY, sites.length || 1)
  );
  const perSite: SearchResult[][] = sites.map(() => []);
  const normalizedQuery = query.trim().toLowerCase();
  let next = 0;

  const worker = async () => {
    for (;;) {
      if (opts.signal?.aborted || Date.now() >= deadline) return;
      const index = next++;
      if (index >= sites.length) return;
      const site = sites[index];
      const key = `${site.key}|${site.api}|${normalizedQuery}`;

      const cached = cacheGet(key);
      if (cached) {
        perSite[index] = cached;
        if (cached.length) opts.onChunk?.({ source: site.key, results: cached });
        continue;
      }

      if (isCoolingDown(site.key)) continue;

      let firstCount = 0;
      const all = await searchFromApi(site, query, {
        deadline,
        onFailure: () => failedUntil.set(site.key, Date.now() + FAILURE_COOLDOWN_MS),
        onFirstPage: (first) => {
          firstCount = first.length;
          if (first.length) opts.onChunk?.({ source: site.key, results: first });
        },
      });
      perSite[index] = all;
      if (all.length > firstCount) {
        opts.onChunk?.({ source: site.key, results: all.slice(firstCount) });
      }
      cacheSet(key, all);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  return perSite.flat();
}
