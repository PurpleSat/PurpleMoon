import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// TMDB 常见的类型 ID 映射表（包含电影与剧集）
const TMDB_GENRE_MAP: Record<number, string> = {
  28: '动作', 12: '冒险', 16: '动画', 35: '喜剧', 80: '犯罪', 99: '纪录',
  18: '剧情', 10751: '家庭', 14: '奇幻', 36: '历史', 27: '恐怖', 10402: '音乐',
  9648: '悬疑', 10749: '爱情', 878: '科幻', 10770: '电视电影', 53: '惊悚',
  10752: '战争', 37: '西部', 10759: '动作冒险', 10762: '儿童', 10763: '新闻',
  10764: '真人秀', 10765: '科幻奇幻', 10766: '肥皂剧', 10767: '脱口秀', 10768: '战争政治'
};

// 常见语言代码映射到国家/地区
const REGION_MAP: Record<string, string> = {
  'en': '欧美', 'zh': '中国', 'ja': '日本', 'ko': '韩国', 'fr': '法国', 
  'es': '西班牙', 'th': '泰国', 'hi': '印度', 'ru': '俄罗斯'
};

export async function GET(req: NextRequest) {
  try {
    // 优先使用 Token 授权，其次使用 API Key
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

    // 并发请求 TMDB 的“即将上映电影”和“正在热播剧集”
    const [moviesRes, tvRes] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/movie/upcoming?language=zh-CN&region=CN&page=1${authParam}`, fetchOptions),
      fetch(`https://api.themoviedb.org/3/tv/on_the_air?language=zh-CN&page=1${authParam}`, fetchOptions)
    ]);

    if (!moviesRes.ok || !tvRes.ok) {
      throw new Error('获取 TMDB 数据失败，请检查 API 密钥或网络状态');
    }

    const moviesData = await moviesRes.json();
    const tvData = await tvRes.json();

    const rawItems = [
      ...(moviesData.results || []).map((item: any) => ({ ...item, media_type: 'movie' })),
      ...(tvData.results || []).map((item: any) => ({ ...item, media_type: 'tv' }))
    ];

    const regions: Record<string, number> = {};
    const genres: Record<string, number> = {};

    // 接收处理后的结构数据
    const parsedData = rawListToCalendarItems(rawItems, regions, genres);

    const filters = {
      types: [
        { label: '电影', value: 'movie', count: parsedData.movieCount },
        { label: '电视剧', value: 'tv', count: parsedData.tvCount },
      ],
      regions: Object.entries(regions).map(([label, count]) => ({ label, value: label, count })),
      genres: Object.entries(genres).map(([label, count]) => ({ label, value: label, count })),
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

// 数据映射提取函数
function rawListToCalendarItems(
  rawItems: any[], 
  regions: Record<string, number>, 
  genres: Record<string, number>
) {
  let movieCount = 0;
  let tvCount = 0;

  const items = rawItems.map((item: any) => {
    const type = item.media_type;
    const region = REGION_MAP[item.original_language] || item.original_language?.toUpperCase() || '未知';
    
    // 解析分类标签
    const genreNames = (item.genre_ids || []).map((id: number) => TMDB_GENRE_MAP[id]).filter(Boolean);
    const genre = genreNames.length > 0 ? genreNames.join('、') : '其他';
    
    // 解析时间
    const releaseDate = item.release_date || item.first_air_date || new Date().toISOString().split('T')[0];

    // 统计过滤器数据
    if (type === 'movie') movieCount++;
    else tvCount++;
    regions[region] = (regions[region] || 0) + 1;
    
    genreNames.forEach((g: string) => {
      genres[g] = (genres[g] || 0) + 1;
    });

    return {
      id: String(item.id),
      title: item.title || item.name || '未知',
      type,
      region,
      genre,
      releaseDate,
      // TMDB 的列表接口不包含演职员信息，使用评分代替展示
      director: item.vote_average ? `TMDB评分 ${item.vote_average.toFixed(1)}` : '暂无评分',
      actors: item.overview || '暂无剧情简介',
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '',
    };
  });

  return { items, movieCount, tvCount };
}
