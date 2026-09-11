import { NextRequest, NextResponse } from 'next/server';

import config from '@/../config.json';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sourceKey = searchParams.get('source');
    const keyword = searchParams.get('q');
    const page = searchParams.get('page') || '1';

    if (!sourceKey || !keyword) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const apiSite = (config as any).api_site || {};
    const source = apiSite[sourceKey];

    if (!source || !source.api) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    // MacCMS 接口：ac=detail 获取详细数据，wd=搜索关键词，pg=页码
    const targetUrl = `${source.api}?ac=detail&wd=${encodeURIComponent(keyword)}&pg=${page}`;
    const res = await fetch(targetUrl, { next: { revalidate: 300 } });
    
    if (!res.ok) throw new Error(`Failed to search in ${source.name}`);

    const data = await res.json();
    const rawList = data.list || [];

    // 映射为前端 Item 类型所需字段
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
      meta: {
        page: data.page,
        pagecount: data.pagecount,
        total: data.total
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}