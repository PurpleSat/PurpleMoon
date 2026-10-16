import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import { resolveAccessibleSites } from '@/lib/site-access';

export const runtime = 'edge';

// OrionTV 兼容接口：只返回当前用户所在分组可访问的资源站
export async function GET(request: Request) {
  try {
    const access = await resolveAccessibleSites(request);
    if (!access.ok) return access.response;
    const cacheTime = await getCacheTime();

    return NextResponse.json(access.sites, {
      headers: {
        // 不同分组看到的列表不同，禁止被 CDN / 共享缓存复用
        'Cache-Control': `private, max-age=${cacheTime}`,
        Vary: 'Cookie',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: '获取资源失败' }, { status: 500 });
  }
}
