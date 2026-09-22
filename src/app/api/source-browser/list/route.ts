/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import config from '@/../config.json';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sourceKey = searchParams.get('source');
    const rawTypeId = searchParams.get('type_id');
    const rawPage = searchParams.get('page') || '1';

    if (!sourceKey || !rawTypeId) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // ==========================================
    // 🛡️ 安全加固：严格过滤输入参数，防范参数注入与污染
    // ==========================================
    
    // 1. 校验 type_id：仅允许字母、数字、下划线及中划线，彻底阻断恶意符号注入
    if (!/^[a-zA-Z0-9_-]+$/.test(rawTypeId)) {
      return NextResponse.json({ error: 'Invalid type_id parameter' }, { status: 400 });
    }

    // 2. 校验 page：必须为正整数，否则降级为安全默认值 '1'
    const page = /^\d+$/.test(rawPage) ? rawPage : '1';

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
    targetUrl.searchParams.set('t', rawTypeId);
    targetUrl.searchParams.set('pg', page);

    const res = await fetch(targetUrl.toString(), { next: { revalidate: 1800 } });
    
    if (!res.ok) throw new Error(`Failed to fetch list from ${source.name || 'upstream'}`);

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
    console.error('source-browser/list 接口异常:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
