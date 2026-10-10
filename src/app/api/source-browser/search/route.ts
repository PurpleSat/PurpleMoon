/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import config from '@/../config.json';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sourceKey = searchParams.get('source');
    const keyword = searchParams.get('q');
    const rawPage = searchParams.get('page') || '1';

    if (!sourceKey || !keyword) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // ==========================================
    // 🛡️ 安全加固：清洗参数，防范参数污染与注入
    // ==========================================
    
    // 1. 严格过滤 page：必须为纯数字正整数，否则降级为安全默认值 '1'
    const page = /^\d+$/.test(rawPage) ? rawPage : '1';

    // 2. 限制搜索词最大长度，防止异常长文本刷接口
    const trimmedKeyword = keyword.trim().slice(0, 100);
    if (!trimmedKeyword) {
      return NextResponse.json({ error: 'Invalid search keyword' }, { status: 400 });
    }

    const apiSite = (config as any).api_site || {};
    const source = apiSite[sourceKey];

    if (!source || !source.api) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    // ==========================================
    // 🛡️ 规范化构造上游请求：废弃模板字符串拼接
    // ==========================================
    const targetUrl = new URL(source.api);
    targetUrl.searchParams.set('ac', 'detail');
    targetUrl.searchParams.set('wd', trimmedKeyword);
    targetUrl.searchParams.set('pg', page);

    const res = await fetch(targetUrl.toString(), { next: { revalidate: 300 } });
    
    if (!res.ok) throw new Error(`Failed to search in ${source.name || 'upstream'}`);

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
    console.error('source-browser/search 接口异常:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
