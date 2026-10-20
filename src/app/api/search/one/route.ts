import { NextResponse } from 'next/server';

import { getClientIp } from '@/lib/client-ip';
import { getCacheTime } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { checkSearchRateLimit } from '@/lib/search-engine';
import { resolveAccessibleSites } from '@/lib/site-access';

export const runtime = 'edge';

// OrionTV 兼容接口
export async function GET(request: Request) {
  // 🛡️ 安全加固 (SEC-NEW-09)：接入统一的搜索限流，防止绕过 /api/search 的频控刷单源接口
  const ip = getClientIp(request as { headers: Headers });
  if (!checkSearchRateLimit(ip)) {
    return NextResponse.json(
      { result: null, error: '搜索请求过于频繁，请稍后再试' },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(request.url);
  const rawQuery = searchParams.get('q');
  const query = rawQuery ? rawQuery.trim().slice(0, 100) : '';
  const resourceId = searchParams.get('resourceId');

  if (!query || !resourceId) {
    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { result: null, error: '缺少必要参数: q 或 resourceId' },
      {
        status: 400,
        headers: {
          'Cache-Control': `private, max-age=${cacheTime}`,
          Vary: 'Cookie',
        },
      }
    );
  }

  const access = await resolveAccessibleSites(request);
  if (!access.ok) return access.response;
  const apiSites = access.sites;

  try {
    const targetSite = apiSites.find((site) => site.key === resourceId);
    if (!targetSite) {
      return NextResponse.json(
        {
          error: `未找到指定的视频源: ${resourceId}`,
          result: null,
        },
        { status: 404 }
      );
    }

    const results = await searchFromApi(targetSite, query, {
      signal: request.signal,
    });
    const result = results.filter((r) => r.title === query);
    const cacheTime = await getCacheTime();

    if (result.length === 0) {
      return NextResponse.json(
        {
          error: '未找到结果',
          result: null,
        },
        { status: 404 }
      );
    } else {
      return NextResponse.json(
        { results: result },
        {
          headers: {
            'Cache-Control': `private, max-age=${cacheTime}`,
            Vary: 'Cookie',
          },
        }
      );
    }
  } catch {
    return NextResponse.json(
      {
        error: '搜索失败',
        result: null,
      },
      { status: 500 }
    );
  }
}
