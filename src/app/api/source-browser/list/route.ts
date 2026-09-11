import { NextRequest, NextResponse } from 'next/server';
import config from '@/../config.json';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sourceKey = searchParams.get('source');
    const typeId = searchParams.get('type_id');
    const page = searchParams.get('page') || '1';

    if (!sourceKey || !typeId) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const apiSite = (config as any).api_site || {};
    const source = apiSite[sourceKey];

    if (!source || !source.api) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    const targetUrl = `${source.api}?ac=detail&t=${typeId}&pg=${page}`;
    const res = await fetch(targetUrl, { next: { revalidate: 1800 } });
    
    if (!res.ok) throw new Error(`Failed to fetch list from ${source.name}`);

    const data = await res.json();
    const rawList = data.list || [];

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
