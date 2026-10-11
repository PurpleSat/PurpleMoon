import { NextResponse } from 'next/server';

import { getClientIp } from '@/lib/client-ip';
import { ApiSite, getAvailableApiSites, getCacheTime } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { SearchResult } from '@/lib/types';

export const runtime = 'edge';

// 🛡️ 安全加固 (SEC-08)：轻量级内存限流，防止搜索接口被滥用做反射 DDoS
const searchRateLimitMap = new Map<string, { count: number; timestamp: number }>();

function checkSearchRateLimit(ip: string, maxRequests = 30, windowMs = 60000): boolean {
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

// 🛡️ 安全加固 (SEC-08)：分3批并发控制，避免瞬间发出数十上百个出站
async function batchSearch(sites: ApiSite[], query: string, batchSize = 3): Promise<SearchResult[]> {
  const allResults: SearchResult[] = [];
  for (let i = 0; i < sites.length; i += batchSize) {
    const batch = sites.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((site) => searchFromApi(site, query)));
    allResults.push(...batchResults.flat());
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
    const flattenedResults = await batchSearch(apiSites, query, 6);
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
