/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
import { NextRequest, NextResponse } from 'next/server';

import { fetchUpstreamJson, resolveBrowsableSite } from '@/lib/source-browser';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawTypeId = searchParams.get('type_id');
    const rawPage = searchParams.get('page') || '1';

    if (!rawTypeId || !/^[a-zA-Z0-9_-]{1,20}$/.test(rawTypeId)) {
      return NextResponse.json({ error: 'Invalid type_id parameter' }, { status: 400 });
    }
    // 页码必须是 1~1000 的正整数，否则回退到第 1 页
    const page = /^\d{1,4}$/.test(rawPage) && Number(rawPage) >= 1 ? rawPage : '1';

    const resolved = await resolveBrowsableSite(searchParams.get('source'));
    if ('error' in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const targetUrl = new URL(resolved.site.api);
    targetUrl.searchParams.set('ac', 'detail');
    targetUrl.searchParams.set('t', rawTypeId);
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
    console.error('source-browser/list 接口异常:', error);
    return NextResponse.json({ error: '获取列表失败' }, { status: 502 });
  }
}
