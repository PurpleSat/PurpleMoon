import { NextResponse } from 'next/server';

import { getClientIp } from '@/lib/client-ip';
import { getAvailableApiSites, getCacheTime } from '@/lib/config';
import { checkSearchRateLimit, runSearch } from '@/lib/search-engine';

export const runtime = 'edge';

export async function GET(request: Request) {
  const ip = getClientIp(request as { headers: Headers });
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
    const results = await runSearch(apiSites, query, {
      signal: request.signal,
    });
    const cacheTime = await getCacheTime();

    return NextResponse.json(
      { results },
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
