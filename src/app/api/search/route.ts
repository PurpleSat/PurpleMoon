import { NextResponse } from 'next/server';

import { getClientIp } from '@/lib/client-ip';
import { getAvailableApiSites, getCacheTime } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { SearchResult } from '@/lib/types';

export const runtime = 'edge';

// 🛡️ 安全加固 (SEC-08)：轻量级内存限流，防止搜索接口被滥用做反射 DDoS
const searchRateLimitMap = new Map<string, { count: number; timestamp: number }>();

function checkSearchRateLimit(ip: string, maxRequests = 30, windowMs = 60000): boolean {
  const effectiveMax = ip === 'unknown_ip' ? 100 : maxRequests;
  const now = Date.now();
  const entry = searchRateLimitMap.get(ip);

  searchRateLimitMap.forEach((v, k) => {
    if (now - v.timestamp > windowMs) searchRateLimitMap.delete(k);
  });

  if (entry && now - entry.timestamp < windowMs) {
    if (entry.count >= effectiveMax) return false;
    entry.count++;
  } else {
    searchRateLimitMap.set(ip, { count: 1, timestamp: now });
  }
  return true;
}

// ⚡ 性能优化：热门搜索内存缓存 (TTL 5 分钟，容量 100 条)，极大减少重复全网检索延迟
const searchCache = new Map<string, { results: SearchResult[]; expireAt: number }>();

function getCachedSearch(key: string): SearchResult[] | null {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expireAt) {
    searchCache.delete(key);
    return null;
  }
  return entry.results;
}

function setCachedSearch(key: string, results: SearchResult[], ttlMs = 300000): void {
  if (searchCache.size >= 100) {
    const oldestKey = searchCache.keys().next().value;
    if (oldestKey) searchCache.delete(oldestKey);
  }
  searchCache.set(key, { results, expireAt: Date.now() + ttlMs });
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

  const cacheTime = await getCacheTime();

  // 1. 命中内存缓存直接返回 (0ms 秒开)
  const cached = getCachedSearch(query.toLowerCase());
  if (cached) {
    return NextResponse.json(
      { results: cached },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}`,
        },
      }
    );
  }

  try {
    const apiSites = await getAvailableApiSites();

    // ⚡ 性能优化：全量并行异步拉取 (Promise.allSettled + 严格短超时)
    // 消除串行分批瀑布流，各源独立并发请求，总耗时由全网最慢源截断控制
    const searchPromises = apiSites.map((site) =>
      searchFromApi(site, query).catch((err) => {
        // 单个源异常/超时快速容错，不阻断其他源
        return [];
      })
    );

    const settledResults = await Promise.allSettled(searchPromises);
    const flattenedResults: SearchResult[] = [];

    for (const r of settledResults) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        flattenedResults.push(...r.value);
      }
    }

    // 写入内存缓存
    setCachedSearch(query.toLowerCase(), flattenedResults);

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
