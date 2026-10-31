import { NextResponse } from 'next/server';

import { getClientIp } from '@/lib/client-ip';
import { ApiSite } from '@/lib/config';
import { checkSearchRateLimit, runSearch } from '@/lib/search-engine';
import { resolveAccessibleSites } from '@/lib/site-access';

export const runtime = 'edge';

/**
 * 流式搜索：以 NDJSON（每行一个 JSON）逐源推送结果，前端可以边收边渲染。
 *
 *   {"type":"start","totalSources":30}
 *   {"type":"results","source":"ruyi","results":[...]}
 *   {"type":"source_complete","source":"ruyi","completedSources":1,"totalSources":30}
 *   {"type":"done","total":123,"completedSources":30,"totalSources":30}
 */
export async function GET(request: Request) {
  const ip = getClientIp(request as { headers: Headers });
  if (!checkSearchRateLimit(ip)) {
    return NextResponse.json(
      { error: '搜索请求过于频繁，请稍后再试' },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(request.url);
  const rawQuery = searchParams.get('q');
  const query = rawQuery ? rawQuery.trim().slice(0, 100) : '';
  if (!query) {
    return NextResponse.json({ error: '缺少搜索关键词' }, { status: 400 });
  }

  let apiSites: ApiSite[];
  try {
    const access = await resolveAccessibleSites(request);
    if (!access.ok) return access.response;
    apiSites = access.sites;
  } catch {
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        } catch {
          closed = true;
        }
      };

      const totalSources = apiSites.length;
      send({ type: 'start', totalSources });

      try {
        const all = await runSearch(apiSites, query, {
          signal: request.signal,
          onChunk: (chunk) =>
            send({
              type: 'results',
              source: chunk.source,
              results: chunk.results,
            }),
          onSourceComplete: (info) =>
            send({
              type: 'source_complete',
              source: info.source,
              completedSources: info.completedSources,
              totalSources: info.totalSources,
            }),
        });
        send({
          type: 'done',
          total: all.length,
          completedSources: totalSources,
          totalSources,
        });
      } catch {
        send({ type: 'error', error: '搜索失败' });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // 客户端已断开
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      // 流式响应不能被缓存，也要告诉 Nginx 不要缓冲，否则“边搜边显示”会失效
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
