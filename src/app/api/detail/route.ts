/* eslint-disable no-console */
import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import { getDetailFromApi } from '@/lib/downstream';
import { resolveAccessibleSite } from '@/lib/site-access';

export const runtime = 'edge';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const sourceCode = searchParams.get('source');

  if (!id || !sourceCode) {
    return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
  }

  if (!/^[\w-]+$/.test(id)) {
    return NextResponse.json({ error: '无效的视频ID格式' }, { status: 400 });
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
    // 内部异常信息（上游地址、网络错误细节等）只写服务端日志，不回传给客户端
    console.error('获取视频详情失败:', error);
    return NextResponse.json({ error: '获取视频详情失败' }, { status: 500 });
  }
}
