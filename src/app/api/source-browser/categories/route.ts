/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { fetchUpstreamJson, resolveBrowsableSite } from '@/lib/source-browser';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
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
