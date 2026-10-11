import { NextResponse } from 'next/server';

import { getClientIp } from '@/lib/client-ip';
import { ApiSite, getAvailableApiSites, getCacheTime } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { SearchResult } from '@/lib/types';

export const runtime = 'edge';

// 🛡️ 安全加固 (SEC-08)：轻量级内存限流，防止搜索接口被滥用做反射 DDoS
const searchRateLimitMap = new Map<string, { count: number; timestamp: number }>();

function checkSearchRateLimit(ip: string, maxRequests = 30, windowMs = 180000): boolean {
  const now = Date.now();
  const entry = searchRateLimitMap.get(ip);

  searchRateLimitMap.forEach((v, k) => {
    if (now - v.timestamp > windowMs) searchRateLimitMap.delete(k);
  });

  if (entry && now - entry.timestamp < windowMs) {
    if (entry.count >= maxRequests) return false;
    entry.count++;
  } else {
    searchRateLimitMap.set(ip, { count: 1, timestamp: now });
  }
  return true;
}

// =========================================================================
// 🚀 服务端短时内存缓存 (LRU Cache with TTL)
// =========================================================================
interface SourceGroup {
  source: string;
  sourceName: string;
  results: SearchResult[];
}

interface SearchCacheEntry {
  results: SearchResult[];
  groupedBySource: SourceGroup[];
  timestamp: number;
}

const SEARCH_CACHE_MAX_ENTRIES = 200; // 最多缓存 200 个热搜词，避免内存膨胀 (适配 Vercel 内存限制)
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000; // 5分钟短时有效缓存

const searchLruCache = new Map<string, SearchCacheEntry>();

function getSearchCache(key: string): SearchCacheEntry | null {
  const entry = searchLruCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > SEARCH_CACHE_TTL_MS) {
    searchLruCache.delete(key);
    return null;
  }
  // LRU 命中：移至末尾
  searchLruCache.delete(key);
  searchLruCache.set(key, entry);
  return entry;
}

function setSearchCache(key: string, data: { results: SearchResult[]; groupedBySource: SourceGroup[] }) {
  if (searchLruCache.has(key)) {
    searchLruCache.delete(key);
  } else if (searchLruCache.size >= SEARCH_CACHE_MAX_ENTRIES) {
    // 淘汰最久未访问的条目
    const oldestKey = searchLruCache.keys().next().value;
    if (oldestKey) searchLruCache.delete(oldestKey);
  }
  searchLruCache.set(key, {
    ...data,
    timestamp: Date.now(),
  });
}

// =========================================================================
// ⚡ 并发池执行器 (Concurrency Pool + Overall Timeout)
// 适配 Vercel Hobby 10s 函数执行限制：硬性总时限设为 8.5s，预留网络收尾安全缓冲
// =========================================================================
const CONCURRENCY_LIMIT = 8;
const GLOBAL_TIMEOUT_MS = 8500;

interface PoolSearchOptions {
  sites: ApiSite[];
  query: string;
  concurrency?: number;
  globalTimeoutMs?: number;
  clientSignal?: AbortSignal;
  onResult?: (site: ApiSite, results: SearchResult[]) => void;
  onProgress?: (completed: number, total: number) => void;
}

async function runSearchWithPool({
  sites,
  query,
  concurrency = CONCURRENCY_LIMIT,
  globalTimeoutMs = GLOBAL_TIMEOUT_MS,
  clientSignal,
  onResult,
  onProgress,
}: PoolSearchOptions): Promise<SearchResult[]> {
  const globalController = new AbortController();
  const timeoutTimer = setTimeout(() => {
    globalController.abort();
  }, globalTimeoutMs);

  const onClientAbort = () => globalController.abort();
  if (clientSignal) {
    clientSignal.addEventListener('abort', onClientAbort, { once: true });
  }

  const allResults: SearchResult[] = [];
  let currentIndex = 0;
  let completedCount = 0;

  try {
    const workerCount = Math.min(concurrency, sites.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (currentIndex < sites.length) {
        if (globalController.signal.aborted) break;
        const index = currentIndex++;
        const site = sites[index];

        try {
          const results = await searchFromApi(site, query, globalController.signal);
          completedCount++;
          if (results && results.length > 0) {
            allResults.push(...results);
            if (onResult) {
              onResult(site, results);
            }
          }
        } catch {
          completedCount++;
        }

        if (onProgress) {
          onProgress(completedCount, sites.length);
        }
      }
    });

    await Promise.all(workers);
  } finally {
    clearTimeout(timeoutTimer);
    if (clientSignal) {
      clientSignal.removeEventListener('abort', onClientAbort);
    }
  }

  return allResults;
}

export async function GET(request: Request) {
  const ip = getClientIp(request as any);
  if (!checkSearchRateLimit(ip)) {
    return NextResponse.json(
      { error: '搜索请求过于频繁，请稍后再试' },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(request.url);
  const rawQuery = searchParams.get('q');
  const query = rawQuery ? rawQuery.trim().slice(0, 100) : '';
  const isStream = searchParams.get('stream') === '1' || searchParams.get('stream') === 'true';

  if (!query) {
    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { results: [] },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}`,
        },
      }
    );
  }

  try {
    const apiSites = await getAvailableApiSites();
    const flattenedResults = await batchSearch(apiSites, query, 2);
    const cacheTime = await getCacheTime();

    return NextResponse.json(
      { results: flattenedResults },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}`,
        },
      }
    );
  } catch (error) {
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}
