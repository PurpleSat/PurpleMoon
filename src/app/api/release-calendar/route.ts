/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getClientIp } from '@/lib/client-ip';
import { checkSearchRateLimit } from '@/lib/search-engine';
import { checkUpstreamUrlSafety } from '@/lib/ssrf-guard';

export const runtime = 'edge';

const TMDB_GENRE_MAP: Record<number, string> = {
  28: '动作', 12: '冒险', 16: '动画', 35: '喜剧', 80: '犯罪', 99: '纪录',
  18: '剧情', 10751: '家庭', 14: '奇幻', 36: '历史', 27: '恐怖', 10402: '音乐',
  9648: '悬疑', 10749: '爱情', 878: '科幻', 10770: '电视电影', 53: '惊悚',
  10752: '战争', 37: '西部', 10759: '动作冒险', 10762: '儿童', 10763: '新闻',
  10764: '真人秀', 10765: '科幻奇幻', 10766: '肥皂剧', 10767: '脱口秀', 10768: '战争政治'
};

const REGION_MAP: Record<string, string> = {
  'en': '欧美', 'zh': '中国', 'ja': '日本', 'ko': '韩国', 'fr': '法国',
  'es': '西班牙', 'th': '泰国', 'hi': '印度', 'ru': '俄罗斯'
};

const TMDB_FETCH_TIMEOUT_MS = 5000;

async function fetchTmdbPage(url: string, options: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TMDB_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return res.ok ? await res.json() : { results: [], failed: true };
  } catch {
    return { results: [], failed: true };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkSearchRateLimit(ip, 30, 60000)) {
    return NextResponse.json({ error: '请求过于频繁，请稍后再试' }, { status: 429 });
  }

  try {
    const apiKey = process.env.TMDB_API_KEY || '';
    const apiToken = process.env.TMDB_API_TOKEN || '';

    if (!apiKey && !apiToken) {
      return NextResponse.json({ error: '未配置 TMDB_API_KEY 或 TMDB_API_TOKEN' }, { status: 500 });
    }

    const fetchOptions: RequestInit & { next?: { revalidate: number } } = {
      headers: {
        accept: 'application/json',
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {})
      },
      next: { revalidate: 7200 }
    };

    const authParam = !apiToken && apiKey ? `&api_key=${apiKey}` : '';
    const baseUrl = (process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3').replace(/\/+$/, '');
    const safety = checkUpstreamUrlSafety(baseUrl);
    if (!safety.ok) {
      return NextResponse.json({ error: 'TMDB_BASE_URL 配置不安全' }, { status: 500 });
    }

    const pagesToFetch = [1, 2, 3];

    const moviePromises = pagesToFetch.map((page) =>
      fetchTmdbPage(
        `${baseUrl}/movie/upcoming?language=zh-CN&page=${page}${authParam}`,
        fetchOptions
      )
    );

    const tvPromises = pagesToFetch.map((page) =>
      fetchTmdbPage(
        `${baseUrl}/tv/on_the_air?language=zh-CN&page=${page}${authParam}`,
        fetchOptions
      )
    );

    const [moviesDataArray, tvDataArray] = await Promise.all([
      Promise.all(moviePromises),
      Promise.all(tvPromises),
    ]);

    const allPages = [...moviesDataArray, ...tvDataArray];
    const failedPages = allPages.filter((d) => d && d.failed).length;
    // 全部页面都失败（TMDB 不可达/超时/鉴权失败）时明确报错，不再静默返回空日历
    if (failedPages === allPages.length) {
      return NextResponse.json(
        { error: '上映日程数据源暂时不可用，请稍后重试' },
        { status: 502 }
      );
    }

    const moviesResults = moviesDataArray.flatMap(data => data.results || []);
    const tvResults = tvDataArray.flatMap(data => data.results || []);

    const rawItems = [
      ...moviesResults.map((item: any) => ({ ...item, media_type: 'movie' })),
      ...tvResults.map((item: any) => ({ ...item, media_type: 'tv' }))
    ];

    const regions: Record<string, number> = {};
    const genres: Record<string, number> = {};

    const parsedData = rawListToCalendarItems(rawItems, regions, genres);

    const filters = {
      types: [
        { label: '电影', value: 'movie', count: parsedData.movieCount },
        { label: '电视剧', value: 'tv', count: parsedData.tvCount },
      ],
      regions: Object.entries(regions)
        .sort((a, b) => b[1] - a[1])
        .map(([label, count]) => ({ label, value: label, count })),
      genres: Object.entries(genres)
        .sort((a, b) => b[1] - a[1])
        .map(([label, count]) => ({ label, value: label, count })),
    };

    return NextResponse.json({
      items: parsedData.items,
      total: parsedData.items.length,
      hasMore: false,
      // 部分页面失败时仍返回已拿到的数据，并标记，便于前端或排查使用
      partial: failedPages > 0,
      filters
    });
  } catch (error) {
    console.error('获取上映日程失败:', error);
    return NextResponse.json({ error: '获取上映日程失败' }, { status: 500 });
  }
}

function rawListToCalendarItems(
  rawItems: any[],
  regions: Record<string, number>,
  genres: Record<string, number>
) {
  let movieCount = 0;
  let tvCount = 0;

  const uniqueItemsMap = new Map();

  rawItems.forEach((item: any) => {
    if (!item || !item.id) return;

    const uniqueKey = `${item.media_type}_${item.id}`;
    if (uniqueItemsMap.has(uniqueKey)) return;

    const type = item.media_type;
    const region = REGION_MAP[item.original_language] || item.original_language?.toUpperCase() || '未知';

    const genreNames = (item.genre_ids || []).map((id: number) => TMDB_GENRE_MAP[id]).filter(Boolean);
    const genre = genreNames.length > 0 ? genreNames.join('、') : '其他';

    const releaseDate = item.release_date || item.first_air_date;
    if (!releaseDate) return;

    if (type === 'movie') movieCount++;
    else tvCount++;
    regions[region] = (regions[region] || 0) + 1;

    genreNames.forEach((g: string) => {
      genres[g] = (genres[g] || 0) + 1;
    });

    uniqueItemsMap.set(uniqueKey, {
      id: String(item.id),
      title: item.title || item.name || '未知',
      type,
      region,
      genre,
      releaseDate,
      director: item.vote_average ? `TMDB评分 ${item.vote_average.toFixed(1)}` : '暂无评分',
      actors: item.overview || '暂无剧情简介',
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '',
    });
  });

  return {
    items: Array.from(uniqueItemsMap.values()),
    movieCount,
    tvCount
  };
}
