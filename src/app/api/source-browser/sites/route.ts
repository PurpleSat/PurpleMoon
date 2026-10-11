/* eslint-disable no-console */
import { NextResponse } from 'next/server';

import { getAvailableApiSites } from '@/lib/config';

export const runtime = 'edge';

export async function GET() {
  try {
    // 仅返回管理员后台已启用的资源站，不向客户端暴露上游 API 地址
    const sites = await getAvailableApiSites();
    return NextResponse.json({
      sources: sites.map((s) => ({ key: s.key, name: s.name || s.key })),
    });
  } catch (error) {
    console.error('source-browser/sites 接口异常:', error);
    return NextResponse.json({ error: '获取资源站失败' }, { status: 500 });
  }
}
