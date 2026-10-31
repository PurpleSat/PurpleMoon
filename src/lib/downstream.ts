/* eslint-disable @typescript-eslint/no-explicit-any */
import { API_CONFIG, ApiSite, getConfig } from '@/lib/config';
import { readJsonLimited, readTextLimited, safeFetch } from '@/lib/safe-fetch';
import { checkUpstreamUrlSafety } from '@/lib/ssrf-guard';
import { SearchResult } from '@/lib/types';
import { cleanHtmlTags } from '@/lib/utils';

function assertSafeUpstream(url: string) {
  const result = checkUpstreamUrlSafety(url);
  if (!result.ok) {
    throw new Error(`拒绝访问不安全的上游地址: ${result.reason}`);
  }
}

function sanitizePosterUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  return /^(https?:)?\/\//i.test(trimmed) ? trimmed : '';
}

interface ApiSearchItem {
  vod_id: string;
  vod_name: string;
  vod_pic: string;
  vod_remarks?: string;
  vod_play_url?: string;
  vod_class?: string;
  vod_year?: string;
  vod_content?: string;
  vod_douban_id?: number;
  type_name?: string;
}

function extractEpisodesAndTitles(vodPlayUrl?: string): {
  episodes: string[];
  episodes_titles: string[];
} {
  let episodes: string[] = [];
  let titles: string[] = [];

  if (vodPlayUrl) {
    const m3u8Regex = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
    const vodPlayUrlArray = vodPlayUrl.split('$$$');
    vodPlayUrlArray.forEach((url: string) => {
      const matches = url.match(m3u8Regex) || [];
      if (matches.length > episodes.length) {
        episodes = matches;
        const matchTitles: string[] = [];
        url.split('#').forEach((segment: string) => {
          const parts = segment.split('$');
          if (parts.length >= 2 && /\.m3u8/i.test(parts[1])) {
            matchTitles.push(parts[0].trim());
          }
        });
        titles = matchTitles;
      }
    });
  }

  episodes = Array.from(new Set(episodes)).map((link: string) => {
    link = link.substring(1);
    const parenIndex = link.indexOf('(');
    return parenIndex > 0 ? link.substring(0, parenIndex) : link;
  });

  return { episodes, episodes_titles: titles };
}

export interface SearchFromApiOptions {
  /** 绝对截止时间（ms 时间戳）。到点后不再发起新请求，进行中的请求也会被提前中止 */
  deadline?: number;
  /** 调用方中止信号（如客户端断开连接或发起新搜索），同步中断进行中的上游请求 */
  signal?: AbortSignal;
  /** 第一页结果一到就回调，便于流式输出（后续翻页结果仍包含在最终返回值里） */
  onFirstPage?: (results: SearchResult[]) => void;
  /** 首页请求失败/超时（上游本身有问题，而不是被整体截止时间打断）时回调，用于短时熔断 */
  onFailure?: () => void;
}

const FIRST_PAGE_TIMEOUT_MS = 3500;
const EXTRA_PAGE_TIMEOUT_MS = 4000;

function createTimeoutController(timeoutMs: number, parentSignal?: AbortSignal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const onParentAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }
  const cleanup = () => {
    clearTimeout(timeoutId);
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  };
  return { controller, cleanup };
}

export async function searchFromApi(
  apiSite: ApiSite,
  query: string,
  opts: SearchFromApiOptions = {}
): Promise<SearchResult[]> {
  const remaining = () =>
    opts.deadline ? opts.deadline - Date.now() : Number.POSITIVE_INFINITY;
  let fullBudget = false;
  try {
    if (opts.signal?.aborted) return [];
    const apiBaseUrl = apiSite.api;
    const apiUrl =
      apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(query);
    const apiName = apiSite.name;

    assertSafeUpstream(apiUrl);

    const firstBudget = Math.min(FIRST_PAGE_TIMEOUT_MS, remaining());
    if (firstBudget <= 0) return [];
    fullBudget = firstBudget >= FIRST_PAGE_TIMEOUT_MS;
    const { controller, cleanup } = createTimeoutController(firstBudget, opts.signal);

    let data: any;
    try {
      const response = await safeFetch(apiUrl, {
        headers: API_CONFIG.search.headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        if (!opts.signal?.aborted) opts.onFailure?.();
        return [];
      }

      data = await readJsonLimited(response);
    } finally {
      cleanup();
    }

    if (
      !data ||
      !data.list ||
      !Array.isArray(data.list) ||
      data.list.length === 0
    ) {
      return [];
    }

    // 处理第一页结果
    const results = data.list.map((item: ApiSearchItem) => {
      const { episodes, episodes_titles } = extractEpisodesAndTitles(
        item.vod_play_url
      );

      return {
        id: item.vod_id.toString(),
        title: item.vod_name.trim().replace(/\s+/g, ' '),
        poster: sanitizePosterUrl(item.vod_pic),
        episodes,
        episodes_titles,
        source: apiSite.key,
        source_name: apiName,
        class: item.vod_class,
        year: item.vod_year
          ? item.vod_year.match(/\d{4}/)?.[0] || ''
          : 'unknown',
        desc: cleanHtmlTags(item.vod_content || ''),
        type_name: item.type_name,
        douban_id: item.vod_douban_id,
        vod_remarks: item.vod_remarks,
      };
    });

    opts.onFirstPage?.(results.slice());

    const config = await getConfig();
    const MAX_SEARCH_PAGES: number = Math.min(
      Math.max(Number(config.SiteConfig.SearchDownstreamMaxPage) || 1, 1),
      3
    );

    const pageCount = data.pagecount || 1;
    const pagesToFetch = Math.min(pageCount - 1, MAX_SEARCH_PAGES - 1);

    if (pagesToFetch > 0 && remaining() > 800 && !opts.signal?.aborted) {
      const additionalPagePromises = [];

      for (let page = 2; page <= pagesToFetch + 1; page++) {
        const pageUrl =
          apiBaseUrl +
          API_CONFIG.search.pagePath
            .replace('{query}', encodeURIComponent(query))
            .replace('{page}', page.toString());

        const pagePromise = (async () => {
          const { controller: pageController, cleanup: pageCleanup } =
            createTimeoutController(
              Math.max(Math.min(EXTRA_PAGE_TIMEOUT_MS, remaining()), 1),
              opts.signal
            );
          try {
            const pageResponse = await safeFetch(pageUrl, {
              headers: API_CONFIG.search.headers,
              signal: pageController.signal,
            });

            if (!pageResponse.ok) {
              return [];
            }

            const pageData = await readJsonLimited(pageResponse);

            if (!pageData || !pageData.list || !Array.isArray(pageData.list))
              return [];

            return pageData.list.map((item: ApiSearchItem) => {
              const { episodes, episodes_titles } = extractEpisodesAndTitles(
                item.vod_play_url
              );

              return {
                id: item.vod_id.toString(),
                title: item.vod_name.trim().replace(/\s+/g, ' '),
                poster: sanitizePosterUrl(item.vod_pic),
                episodes,
                episodes_titles,
                source: apiSite.key,
                source_name: apiName,
                class: item.vod_class,
                year: item.vod_year
                  ? item.vod_year.match(/\d{4}/)?.[0] || ''
                  : 'unknown',
                desc: cleanHtmlTags(item.vod_content || ''),
                type_name: item.type_name,
                douban_id: item.vod_douban_id,
                vod_remarks: item.vod_remarks,
              };
            });
          } catch {
            return [];
          } finally {
            pageCleanup();
          }
        })();

        additionalPagePromises.push(pagePromise);
      }

      const additionalResults = await Promise.all(additionalPagePromises);

      additionalResults.forEach((pageResults) => {
        if (pageResults.length > 0) {
          results.push(...pageResults);
        }
      });
    }

    return results;
  } catch {
    if (fullBudget && !opts.signal?.aborted) opts.onFailure?.();
    return [];
  }
}

const M3U8_PATTERN = /(https?:\/\/[^"'\s]+?\.m3u8)/g;

export async function getDetailFromApi(
  apiSite: ApiSite,
  id: string
): Promise<SearchResult> {
  if (apiSite.detail) {
    return handleSpecialSourceDetail(id, apiSite);
  }

  const detailUrl = `${apiSite.api}${API_CONFIG.detail.path}${id}`;

  assertSafeUpstream(detailUrl);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  let data: any;
  try {
    const response = await safeFetch(detailUrl, {
      headers: API_CONFIG.detail.headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`详情请求失败: ${response.status}`);
    }

    data = await readJsonLimited(response);
  } finally {
    clearTimeout(timeoutId);
  }

  if (
    !data ||
    !data.list ||
    !Array.isArray(data.list) ||
    data.list.length === 0
  ) {
    throw new Error('获取到的详情内容无效');
  }

  const videoDetail = data.list[0];
  let episodes: string[] = [];

  if (videoDetail.vod_play_url) {
    const playSources = videoDetail.vod_play_url.split('$$$');
    if (playSources.length > 0) {
      const mainSource = playSources[0];
      const episodeList = mainSource.split('#');
      episodes = episodeList
        .map((ep: string) => {
          const parts = ep.split('$');
          return parts.length > 1 ? parts[1] : '';
        })
        .filter(
          (url: string) =>
            url && (url.startsWith('http://') || url.startsWith('https://'))
        );
    }
  }

  if (episodes.length === 0 && videoDetail.vod_content) {
    const matches = videoDetail.vod_content.match(M3U8_PATTERN) || [];
    episodes = matches.map((link: string) => link.replace(/^\$/, ''));
  }

  return {
    id: id.toString(),
    title: videoDetail.vod_name,
    poster: sanitizePosterUrl(videoDetail.vod_pic),
    episodes,
    source: apiSite.key,
    source_name: apiSite.name,
    class: videoDetail.vod_class,
    year: videoDetail.vod_year
      ? videoDetail.vod_year.match(/\d{4}/)?.[0] || ''
      : 'unknown',
    desc: cleanHtmlTags(videoDetail.vod_content),
    type_name: videoDetail.type_name,
    douban_id: videoDetail.vod_douban_id,
    vod_remarks: videoDetail.vod_remarks,
  };
}

async function handleSpecialSourceDetail(
  id: string,
  apiSite: ApiSite
): Promise<SearchResult> {
  const detailUrl = `${apiSite.detail}/index.php/vod/detail/id/${id}.html`;

  assertSafeUpstream(detailUrl);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  let html: string;
  try {
    const response = await safeFetch(detailUrl, {
      headers: API_CONFIG.detail.headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`详情页请求失败: ${response.status}`);
    }

    html = await readTextLimited(response);
  } finally {
    clearTimeout(timeoutId);
  }

  let matches: string[] = [];

  if (apiSite.key === 'ffzy') {
    const ffzyPattern =
      /\$(https?:\/\/[^"'\s]+?\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8)/g;
    matches = html.match(ffzyPattern) || [];
  }

  if (matches.length === 0) {
    const generalPattern = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
    matches = html.match(generalPattern) || [];
  }

  matches = Array.from(new Set(matches)).map((link: string) => {
    link = link.substring(1);
    const parenIndex = link.indexOf('(');
    return parenIndex > 0 ? link.substring(0, parenIndex) : link;
  });

  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const titleText = titleMatch ? titleMatch[1].trim() : '';

  const descMatch = html.match(
    /<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/
  );
  const descText = descMatch ? cleanHtmlTags(descMatch[1]) : '';

  const coverMatch = html.match(/(https?:\/\/[^"'\s]+?\.jpg)/g);
  const coverUrl = coverMatch ? coverMatch[0].trim() : '';

  const yearMatch = html.match(/>(\d{4})</);
  const yearText = yearMatch ? yearMatch[1] : 'unknown';

  return {
    id,
    title: titleText,
    poster: sanitizePosterUrl(coverUrl),
    episodes: matches,
    source: apiSite.key,
    source_name: apiSite.name,
    class: '',
    year: yearText,
    desc: descText,
    type_name: '',
    douban_id: 0,
  };
}
