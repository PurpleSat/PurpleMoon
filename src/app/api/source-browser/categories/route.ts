/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getClientIp } from '@/lib/client-ip';
import { checkSearchRateLimit } from '@/lib/search-engine';
import { fetchUpstreamJson, resolveBrowsableSite } from '@/lib/source-browser';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkSearchRateLimit(ip, 60, 60000)) {
    return NextResponse.json({ error: '请求过于频繁，请稍后再试' }, { status: 429 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveBrowsableSite(req, searchParams.get('source'));
    if ('error' in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const data = await fetchUpstreamJson(resolved.site.api);
    const categories = Array.isArray(data?.class) ? data.class : [];

    return NextResponse.json({ categories });
  } catch (error) {
    console.error('source-browser/categories 接口异常:', error);
    return NextResponse.json({ error: '获取分类失败' }, { status: 502 });
  }
}
