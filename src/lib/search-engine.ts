import { ApiSite } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { SearchResult } from '@/lib/types';

// ============================================================================
// 多源并发搜索引擎
// ============================================================================

export const SEARCH_CONCURRENCY = 8;
export const SEARCH_DEADLINE_MS = 8000;

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

const cache = new Map<string, { at: number; data: SearchResult[] }>();

const FAILURE_COOLDOWN_MS = 45 * 1000;
const failedUntil = new Map<string, number>();

export function clearSearchCache() {
  cache.clear();
  failedUntil.clear();
}

function isCoolingDown(siteKey: string): boolean {
  const until = failedUntil.get(siteKey);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    failedUntil.delete(siteKey);
    return false;
  }
  return true;
}

/**
 * 读取进程内 5 分钟搜索缓存，并强制使用当前请求上下文的 `siteName` 重写 `source_name`：
 * - 防止管理员先搜索后，5 分钟内普通用户命中缓存拿到真实资源站名（脱敏绕过）
 * - 防止普通用户先搜索后，管理员命中缓存拿到「线路 N」或不同分组间「线路 N」序号互串
 */
function cacheGet(key: string, siteName: string): SearchResult[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.data.map((item) => ({ ...item, source_name: siteName }));
}

function cacheSet(key: string, data: SearchResult[]) {
  if (data.length === 0) return;
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(
    key,
    {
      at: Date.now(),
      data: data.map((item) => ({ ...item })),
    }
  );
}

// ---------------------------------------------------------------------------
// 限流（/api/search、/api/search/stream、/api/search/one、/api/detail 等共用）
// 🛡️ 安全加固 (SEC-08 / SEC-NEW-09)：轻量级内存限流，防止上游检索接口被滥用做反射 DDoS
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

export interface SourceChunk {
  source: string;
  results: SearchResult[];
}

export interface SourceCompleteInfo {
  source: string;
  completedSources: number;
  totalSources: number;
}

export interface RunSearchOptions {
  /** 每当某个源有新结果（首页 / 后续页 / 缓存命中）时回调 */
  onChunk?: (chunk: SourceChunk) => void;
  /** 每当某个源完成检索（含缓存、熔断、空结果或成功）时回调 */
  onSourceComplete?: (info: SourceCompleteInfo) => void;
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
  const totalSources = sites.length;
  let completedSources = 0;
  let next = 0;

  const markSiteComplete = (sourceKey: string) => {
    completedSources += 1;
    opts.onSourceComplete?.({
      source: sourceKey,
      completedSources,
      totalSources,
    });
  };

  const worker = async () => {
    for (;;) {
      if (opts.signal?.aborted || Date.now() >= deadline) return;
      const index = next++;
      if (index >= sites.length) return;
      const site = sites[index];
      const key = `${site.key}|${site.api}|${normalizedQuery}`;

      const cached = cacheGet(key, site.name);
      if (cached) {
        perSite[index] = cached;
        if (cached.length) opts.onChunk?.({ source: site.key, results: cached });
        markSiteComplete(site.key);
        continue;
      }

      if (isCoolingDown(site.key)) {
        markSiteComplete(site.key);
        continue;
      }

      let firstCount = 0;
      const all = await searchFromApi(site, query, {
        deadline,
        signal: opts.signal,
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
      if (!opts.signal?.aborted) {
        cacheSet(key, all);
      }
      markSiteComplete(site.key);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  return perSite.flat();
}
