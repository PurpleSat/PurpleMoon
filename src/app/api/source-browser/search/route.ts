/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
import { NextRequest, NextResponse } from 'next/server';

import { fetchUpstreamJson, resolveBrowsableSite } from '@/lib/source-browser';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const keyword = searchParams.get('q');
    const rawPage = searchParams.get('page') || '1';

    const trimmedKeyword = (keyword || '').trim().slice(0, 100);
    if (!trimmedKeyword) {
      return NextResponse.json({ error: 'Invalid search keyword' }, { status: 400 });
    }
    const page = /^\d{1,4}$/.test(rawPage) && Number(rawPage) >= 1 ? rawPage : '1';

    const resolved = await resolveBrowsableSite(req, searchParams.get('source'));
    if ('error' in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const targetUrl = new URL(resolved.site.api);
    targetUrl.searchParams.set('ac', 'detail');
    targetUrl.searchParams.set('wd', trimmedKeyword);
    targetUrl.searchParams.set('pg', page);

    const data = await fetchUpstreamJson(targetUrl.toString());
    const rawList: any[] = Array.isArray(data?.list) ? data.list : [];

    const items = rawList.map((item: any) => ({
      id: item.vod_id,
      title: item.vod_name,
      poster: item.vod_pic,
      year: item.vod_year,
      type_name: item.type_name,
      remarks: item.vod_remarks,
    }));

    return NextResponse.json({
      items,
      meta: { page: data?.page, pagecount: data?.pagecount, total: data?.total },
    });
  } catch (error) {
    console.error('source-browser/search 接口异常:', error);
    return NextResponse.json({ error: '搜索失败' }, { status: 502 });
  }
}
