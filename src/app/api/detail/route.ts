/* eslint-disable no-console */
import { NextResponse } from 'next/server';

import { getClientIp } from '@/lib/client-ip';
import { getCacheTime } from '@/lib/config';
import { getDetailFromApi } from '@/lib/downstream';
import { checkSearchRateLimit } from '@/lib/search-engine';
import { resolveAccessibleSite } from '@/lib/site-access';

export const runtime = 'edge';

export async function GET(request: Request) {
  // 🛡️ 安全加固 (SEC-NEW-09)：接入统一的检索频控，防止被滥用刷上游详情接口
  const ip = getClientIp(request as { headers: Headers });
  if (!checkSearchRateLimit(ip, 60, 60000)) {
    return NextResponse.json(
      { error: '请求过于频繁，请稍后再试' },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const sourceCode = searchParams.get('source');

  if (!id || !sourceCode) {
    return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
  }

  if (!/^[\w-]{1,100}$/.test(id) || !/^[\w-]{1,50}$/.test(sourceCode)) {
    return NextResponse.json({ error: '无效的参数格式' }, { status: 400 });
  }

  try {
    const access = await resolveAccessibleSite(request, sourceCode);
    if (!access.ok) return access.response;
    const apiSite = access.site;

    const result = await getDetailFromApi(apiSite, id);
    const cacheTime = await getCacheTime();

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': `private, max-age=${cacheTime}`,
        Vary: 'Cookie',
      },
    });
  } catch (error) {
    console.error('获取视频详情失败:', error);
    return NextResponse.json({ error: '获取视频详情失败' }, { status: 500 });
  }
}
