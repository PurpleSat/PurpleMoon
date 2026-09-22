import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// TMDB 常见的类型 ID 映射表
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

export async function GET(req: NextRequest) {
  try {
    const apiKey = process.env.TMDB_API_KEY || '';
    const apiToken = process.env.TMDB_API_TOKEN || '';

    if (!apiKey && !apiToken) {
      return NextResponse.json({ error: '未配置 TMDB_API_KEY 或 TMDB_API_TOKEN' }, { status: 500 });
    }

    const fetchOptions = {
      headers: {
        accept: 'application/json',
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {})
      },
      next: { revalidate: 7200 } // 缓存 2 小时
    };

    const authParam = !apiToken && apiKey ? `&api_key=${apiKey}` : '';
    const baseUrl = process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3';

    // 设定要并发获取的页数（例如获取前 5 页，每页 20 条，共 100 电影 + 100 剧集）
    const pagesToFetch = [1, 2, 3, 4, 5];

    // 并发构建电影和剧集的请求 (解除 region=CN 的严格限制，获取全球即将上映)
    const moviePromises = pagesToFetch.map(page => 
      fetch(`${baseUrl}/movie/upcoming?language=zh-CN&page=${page}${authParam}`, fetchOptions)
        .then(res => res.ok ? res.json() : { results: [] })
    );
    
    const tvPromises = pagesToFetch.map(page => 
      fetch(`${baseUrl}/tv/on_the_air?language=zh-CN&page=${page}${authParam}`, fetchOptions)
        .then(res => res.ok ? res.json() : { results: [] })
    );

    // 等待所有页面请求完成
    const moviesDataArray = await Promise.all(moviePromises);
    const tvDataArray = await Promise.all(tvPromises);

    // 扁平化数据数组
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
        .sort((a, b) => b[1] - a[1]) // 按数量降序
        .map(([label, count]) => ({ label, value: label, count })),
      genres: Object.entries(genres)
        .sort((a, b) => b[1] - a[1]) // 按数量降序
        .map(([label, count]) => ({ label, value: label, count })),
    };

    return NextResponse.json({
      items: parsedData.items,
      total: parsedData.items.length,
      hasMore: false,
      filters
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function rawListToCalendarItems(
  rawItems: any[], 
  regions: Record<string, number>, 
  genres: Record<string, number>
) {
  let movieCount = 0;
  let tvCount = 0;

  // 使用 Map 根据 ID 进行去重，防止 TMDB API 翻页时出现重复数据
  const uniqueItemsMap = new Map();

  rawItems.forEach((item: any) => {
    // 过滤掉无效数据
    if (!item || !item.id) return;

    // 防止跨页重复数据
    const uniqueKey = `${item.media_type}_${item.id}`;
    if (uniqueItemsMap.has(uniqueKey)) return;

    const type = item.media_type;
    const region = REGION_MAP[item.original_language] || item.original_language?.toUpperCase() || '未知';
    
    const genreNames = (item.genre_ids || []).map((id: number) => TMDB_GENRE_MAP[id]).filter(Boolean);
    const genre = genreNames.length > 0 ? genreNames.join('、') : '其他';
    
    // 如果没有发行日期，默认过滤掉，不再强塞今日日期
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
