/* eslint-disable no-console */
import { NextResponse } from 'next/server';

import { resolveAccessibleSites } from '@/lib/site-access';

export const runtime = 'edge';

export async function GET(request: Request) {
  try {
    // 仅返回当前用户所在分组可访问的资源站，不向客户端暴露上游 API 地址
    const access = await resolveAccessibleSites(request);
    if (!access.ok) return access.response;
    return NextResponse.json(
      {
        sources: access.sites.map((s) => ({ key: s.key, name: s.name || s.key })),
      },
      { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } }
    );
  } catch (error) {
    console.error('source-browser/sites 接口异常:', error);
    return NextResponse.json({ error: '获取资源站失败' }, { status: 500 });
  }
}
