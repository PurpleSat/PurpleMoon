/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { Heart } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import {
  getCustomFingerprints,
  installAdLearnHelpers,
  rememberRawPlaylist,
} from '@/lib/ad-learn';
import {
  deleteFavorite,
  deletePlayRecord,
  deleteSkipConfig,
  generateStorageKey,
  getAllPlayRecords,
  getSkipConfig,
  isFavorited,
  saveFavorite,
  savePlayRecord,
  saveSkipConfig,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import {
  filterAdsFromM3U8,
  stripDiscontinuityLegacy,
} from '@/lib/m3u8-ad-filter';
import { SearchResult } from '@/lib/types';
import {
  getArtPlayerType,
  getVideoResolutionFromM3u8,
  processImageUrl,
  VideoSourceTestResult,
} from '@/lib/utils';

import EpisodeSelector from '@/components/EpisodeSelector';
import PageLayout from '@/components/PageLayout';

declare global {
  interface HTMLVideoElement {
    hls?: any;
  }
}

interface WakeLockSentinel {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

const PLAYER_PLAYBACK_RATE_KEY = 'moontv_player_playback_rate';
const DEFAULT_PLAYBACK_RATE = 1;
const ALLOWED_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

const sanitizePlaybackRate = (rate?: number | null): number => {
  if (typeof rate !== 'number' || Number.isNaN(rate)) {
    return DEFAULT_PLAYBACK_RATE;
  }
  const matched = ALLOWED_PLAYBACK_RATES.find(
    (allowed) => Math.abs(allowed - rate) < 0.001
  );
  return matched ?? DEFAULT_PLAYBACK_RATE;
};

const loadPlaybackRate = (): number => {
  if (typeof window === 'undefined') {
    return DEFAULT_PLAYBACK_RATE;
  }
  try {
    const raw = localStorage.getItem(PLAYER_PLAYBACK_RATE_KEY);
    if (!raw) return DEFAULT_PLAYBACK_RATE;
    const parsed = parseFloat(raw);
    return sanitizePlaybackRate(parsed);
  } catch {
    return DEFAULT_PLAYBACK_RATE;
  }
};

// 检测 iOS / iPadOS 设备
const isIOS13Plus = (() => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isIPadOS =
    navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return isIOS || isIPadOS;
})();

const isIOSGlobal = (() => {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
})();

// 规范化年份字符串：提取四位数字年份；支持 "unknown" / 空值处理
function normalizeYearForMatch(year?: string): string {
  if (!year) return '';
  const trimmed = year.trim();
  if (!trimmed || trimmed.toLowerCase() === 'unknown') return '';
  const match = trimmed.match(/\d{4}/);
  return match ? match[0] : '';
}

// 判断候选源年份是否满足期望年份
function matchesRequestedYear(
  candidateYear?: string,
  requestedYear?: string
): boolean {
  const reqNorm = normalizeYearForMatch(requestedYear);
  if (!reqNorm) return true;
  const candNorm = normalizeYearForMatch(candidateYear);
  if (!candNorm) return true;
  return candNorm === reqNorm;
}

// 阿拉伯数字与中文数字互转映射
const numberMap: Record<string, string> = {
  '1': '一',
  '2': '二',
  '3': '三',
  '4': '四',
  '5': '五',
  '6': '六',
  '7': '七',
  '8': '八',
  '9': '九',
  '10': '十',
};

const reverseNumberMap: Record<string, string> = {
  一: '1',
  二: '2',
  三: '3',
  四: '4',
  五: '5',
  六: '6',
  七: '7',
  八: '8',
  九: '9',
  十: '10',
};

function generateNumberVariants(title: string): string[] {
  const variants: string[] = [];

  const arabicMatch = title.match(/^(.*?)\s*([1-9]|10)\s*$/);
  if (arabicMatch) {
    const baseTitle = arabicMatch[1].trim();
    const num = arabicMatch[2];
    const chineseNum = numberMap[num];
    if (chineseNum) {
      variants.push(`${baseTitle}${chineseNum}`);
      variants.push(`${baseTitle} ${chineseNum}`);
      variants.push(`${baseTitle}第${chineseNum}季`);
      variants.push(`${baseTitle}第${num}季`);
    }
  }

  const chineseMatch = title.match(/^(.*?)\s*([一二三四五六七八九十])\s*$/);
  if (chineseMatch) {
    const baseTitle = chineseMatch[1].trim();
    const chineseNum = chineseMatch[2];
    const arabicNum = reverseNumberMap[chineseNum];
    if (arabicNum) {
      variants.push(`${baseTitle}${arabicNum}`);
      variants.push(`${baseTitle} ${arabicNum}`);
      variants.push(`${baseTitle}第${chineseNum}季`);
      variants.push(`${baseTitle}第${arabicNum}季`);
    }
  }

  const seasonMatch = title.match(
    /^(.*?)\s*第([1-9]|10|[一二三四五六七八九十])季\s*$/
  );
  if (seasonMatch) {
    const baseTitle = seasonMatch[1].trim();
    const num = seasonMatch[2];
    if (numberMap[num]) {
      const chineseNum = numberMap[num];
      variants.push(`${baseTitle}第${chineseNum}季`);
      variants.push(`${baseTitle}${num}`);
      variants.push(`${baseTitle} ${num}`);
    } else if (reverseNumberMap[num]) {
      const arabicNum = reverseNumberMap[num];
      variants.push(`${baseTitle}第${arabicNum}季`);
      variants.push(`${baseTitle}${arabicNum}`);
      variants.push(`${baseTitle} ${arabicNum}`);
    }
  }

  return variants;
}

function generateChinesePunctuationVariants(title: string): string[] {
  const variants: string[] = [];
  if (!title.includes('：') && !title.includes(':')) {
    const spaceReplaced = title.replace(/\s+/g, '：');
    if (spaceReplaced !== title) {
      variants.push(spaceReplaced);
    }
  }
  if (title.includes('：') || title.includes(':')) {
    const colonReplaced = title.replace(/[：:]/g, ' ').replace(/\s+/g, ' ');
    if (colonReplaced !== title) {
      variants.push(colonReplaced);
    }
  }
  return variants;
}

function generateSearchVariants(title: string): string[] {
  if (!title) return [];
  const variants = new Set<string>();
  const cleanTitle = title.trim();
  variants.add(cleanTitle);

  const noPunctuation = cleanTitle
    .replace(/[：:，,。！？!?.、\-—–\s]+/g, ' ')
    .trim();
  if (noPunctuation && noPunctuation !== cleanTitle) {
    variants.add(noPunctuation);
  }

  generateNumberVariants(cleanTitle).forEach((v) => variants.add(v));
  generateChinesePunctuationVariants(cleanTitle).forEach((v) =>
    variants.add(v)
  );

  const mainTitle = cleanTitle.split(/[：:\-—–]/)[0]?.trim();
  if (mainTitle && mainTitle !== cleanTitle && mainTitle.length >= 2) {
    variants.add(mainTitle);
  }

  return Array.from(variants).slice(0, 5);
}

function PlayPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // -----------------------------------------------------------------------------
  // 状态变量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('正在搜索播放源...');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);

  const [favorited, setFavorited] = useState(false);

  const [skipConfig, setSkipConfig] = useState<{
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }>({
    enable: false,
    intro_time: 0,
    outro_time: 0,
  });
  const skipConfigRef = useRef(skipConfig);
  useEffect(() => {
    skipConfigRef.current = skipConfig;
  }, [skipConfig]);

  const hasSkippedIntroRef = useRef(false);
  const hasSkippedOutroRef = useRef(false);
  // 防止跳过片尾与 video:ended 同时触发导致连跳两集
  const isSkipControllerTriggeredRef = useRef(false);
  const videoEndedHandledRef = useRef(false);
  // 区分换集（switchUrl 并重置进度）与换源（switchQuality 保持进度）
  const isEpisodeChangingRef = useRef(false);
  // 标记换集后是否需要确保自动播放
  const shouldAutoPlayAfterSwitchRef = useRef(false);
  // 标记正在切换源/集，防止浏览器重置倍速覆盖用户设置
  const isSourceSwitchingRef = useRef(false);

  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('enable_blockad');
      if (v !== null) return v === 'true';
    }
    return true;
  });
  const blockAdEnabledRef = useRef(blockAdEnabled);
  useEffect(() => {
    blockAdEnabledRef.current = blockAdEnabled;
  }, [blockAdEnabled]);

  const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
  const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
  const [videoCover, setVideoCover] = useState('');
  const [videoDoubanId, setVideoDoubanId] = useState(0);

  const [currentSource, setCurrentSource] = useState(
    searchParams.get('source') || ''
  );
  const [currentId, setCurrentId] = useState(searchParams.get('id') || '');

  const [searchTitle] = useState(searchParams.get('stitle') || '');
  const [searchType] = useState(searchParams.get('stype') || '');

  const [needPrefer, setNeedPrefer] = useState(
    searchParams.get('prefer') === 'true'
  );
  const needPreferRef = useRef(needPrefer);
  useEffect(() => {
    needPreferRef.current = needPrefer;
  }, [needPrefer]);

  // 支持从 URL ?index= 参数初始化集数（1-based 转换为 0-based）
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState<number>(() => {
    const indexParam = searchParams.get('index');
    if (indexParam) {
      const parsed = parseInt(indexParam, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        return parsed - 1;
      }
    }
    return 0;
  });

  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);

  useEffect(() => {
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    detailRef.current = detail;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
    videoTitleRef.current = videoTitle;
    videoYearRef.current = videoYear;
  }, [
    currentSource,
    currentId,
    detail,
    currentEpisodeIndex,
    videoTitle,
    videoYear,
  ]);

  useEffect(() => {
    hasSkippedIntroRef.current = false;
    hasSkippedOutroRef.current = false;
    videoEndedHandledRef.current = false;
    const timer = setTimeout(() => {
      isSkipControllerTriggeredRef.current = false;
    }, 800);
    return () => clearTimeout(timer);
  }, [currentEpisodeIndex]);

  const [videoUrl, setVideoUrl] = useState('');

  const totalEpisodes = detail?.episodes?.length || 0;

  const resumeTimeRef = useRef<number | null>(null);
  const historyRestoredKeyRef = useRef<string | null>(null);
  const lastVolumeRef = useRef<number>(0.7);
  const lastPlaybackRateRef = useRef<number>(loadPlaybackRate());

  // 实时检测到的视频分辨率（用于播放器右上角分辨率徽章展示）
  const [detectedResolution, setDetectedResolution] = useState<string>('');
  const detectedResolutionRef = useRef<string>('');
  useEffect(() => {
    detectedResolutionRef.current = detectedResolution;
  }, [detectedResolution]);

  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(
    null
  );

  // 优选测速进度状态
  const [speedTestProgress, setSpeedTestProgress] = useState<{
    completed: number;
    total: number;
  }>({ completed: 0, total: 0 });

  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch (_e) {
          console.debug('解析 enableOptimization 配置失败', _e);
        }
      }
    }
    return true;
  });

  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<
    Map<string, VideoSourceTestResult>
  >(new Map());

  const [isEpisodeSelectorCollapsed, setIsEpisodeSelectorCollapsed] =
    useState(false);

  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [videoLoadingStage, setVideoLoadingStage] = useState<
    'initing' | 'sourceChanging'
  >('initing');

  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const clockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const badgeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaveTimeRef = useRef<number>(0);

  const artPlayerRef = useRef<any>(null);
  const artRef = useRef<HTMLDivElement | null>(null);

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // 获取播放器当前实际根节点（兼容 FULLSCREEN_WEB_IN_BODY 将 $player 挂载到 body 的情况）
  const getPlayerRoot = (): HTMLElement | null => {
    return (
      (artPlayerRef.current?.template?.$player as HTMLElement | undefined) ||
      artRef.current
    );
  };

  // -----------------------------------------------------------------------------
  // 工具函数（Utils）
  // -----------------------------------------------------------------------------

  // 检测是否为移动设备
  const isMobileDevice = useCallback((): boolean => {
    if (typeof window === 'undefined') return false;
    return (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      ) || window.innerWidth < 768
    );
  }, []);

  // iOS13+ 零 HLS 优选策略：仅使用 HEAD 请求测速，不创建任何隐藏 video/HLS 实例，避免抢占硬件解码器
  const iosZeroHlsPreference = async (
    sources: SearchResult[]
  ): Promise<SearchResult> => {
    const validSources = sources.filter(
      (s) => s.episodes && s.episodes.length > 0
    );
    if (validSources.length === 0) return sources[0];
    if (validSources.length === 1) return validSources[0];

    const sourcesToTest = validSources.slice(0, 3);
    const results = await Promise.all(
      sourcesToTest.map(async (source) => {
        try {
          const episodeUrl = source.episodes[0];
          const start = performance.now();
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 1500);

          await fetch(episodeUrl, {
            method: 'HEAD',
            mode: 'no-cors',
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          const pingTime = Math.round(performance.now() - start);
          return { source, pingTime, success: true };
        } catch {
          return { source, pingTime: 9999, success: false };
        }
      })
    );

    const successful = results.filter((r) => r.success);
    if (successful.length === 0) return validSources[0];
    successful.sort((a, b) => a.pingTime - b.pingTime);
    return successful[0].source;
  };

  // 移动端轻量优选策略：仅测速延迟，不创建多个并发 HLS 实例消耗移动端内存与流量
  const lightweightPreference = async (
    sources: SearchResult[]
  ): Promise<SearchResult> => {
    const validSources = sources.filter(
      (s) => s.episodes && s.episodes.length > 0
    );
    if (validSources.length === 0) return sources[0];

    const sourcesToTest = validSources.slice(0, 6);
    setSpeedTestProgress({ completed: 0, total: sourcesToTest.length });

    let completedCount = 0;
    const results = await Promise.all(
      sourcesToTest.map(async (source) => {
        try {
          const episodeUrl =
            source.episodes.length > 1
              ? source.episodes[1]
              : source.episodes[0];
          const start = performance.now();
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);

          await fetch(episodeUrl, {
            method: 'HEAD',
            mode: 'no-cors',
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          const pingTime = Math.round(performance.now() - start);
          completedCount++;
          setSpeedTestProgress({
            completed: completedCount,
            total: sourcesToTest.length,
          });
          return {
            source,
            testResult: {
              quality: '未知',
              loadSpeed: '未知',
              pingTime,
            },
          };
        } catch {
          completedCount++;
          setSpeedTestProgress({
            completed: completedCount,
            total: sourcesToTest.length,
          });
          return null;
        }
      })
    );

    const successful = results.filter(Boolean) as Array<{
      source: SearchResult;
      testResult: VideoSourceTestResult;
    }>;

    if (successful.length === 0) return validSources[0];
    successful.sort((a, b) => a.testResult.pingTime - b.testResult.pingTime);
    return successful[0].source;
  };

  // 桌面端完整并发测速优选（含高清高速源提前结束优化）
  const preferBestSource = async (
    sources: SearchResult[]
  ): Promise<SearchResult> => {
    if (sources.length === 1) return sources[0];

    if (isIOS13Plus) {
      return await iosZeroHlsPreference(sources);
    }

    if (isMobileDevice()) {
      return await lightweightPreference(sources);
    }

    const MAX_CONCURRENT_TEST = 4;
    const allResults: Array<{
      source: SearchResult;
      testResult: VideoSourceTestResult;
    } | null> = new Array(sources.length).fill(null);

    setSpeedTestProgress({ completed: 0, total: sources.length });
    let completedCount = 0;
    let shouldStopEarly = false;
    let highQualityCount = 0;

    const testOne = async (index: number) => {
      if (shouldStopEarly) return;
      const source = sources[index];
      try {
        if (!source.episodes || source.episodes.length === 0) return;
        const episodeUrl =
          source.episodes.length > 1 ? source.episodes[1] : source.episodes[0];
        const testResult = await getVideoResolutionFromM3u8(episodeUrl);
        allResults[index] = { source, testResult };

        const qualityUpper = testResult.quality.toUpperCase();
        const isHighRes = qualityUpper === '4K' || qualityUpper === '2K';
        const speedKBps = resultSpeed(testResult.loadSpeed);
        if (isHighRes && speedKBps >= 1536) {
          highQualityCount++;
          if (highQualityCount >= 2) {
            shouldStopEarly = true;
          }
        }
      } catch (_error) {
        allResults[index] = null;
      } finally {
        completedCount++;
        setSpeedTestProgress({
          completed: completedCount,
          total: sources.length,
        });
      }
    };

    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(MAX_CONCURRENT_TEST, sources.length) },
      async () => {
        while (cursor < sources.length && !shouldStopEarly) {
          const current = cursor++;
          await testOne(current);
        }
      }
    );
    await Promise.all(workers);

    const newVideoInfoMap = new Map<string, VideoSourceTestResult>();
    allResults.forEach((result, index) => {
      const source = sources[index];
      const sourceKey = `${source.source}-${source.id}`;
      if (result) newVideoInfoMap.set(sourceKey, result.testResult);
    });

    const successfulResults = allResults.filter(Boolean) as Array<{
      source: SearchResult;
      testResult: VideoSourceTestResult;
    }>;

    setPrecomputedVideoInfo(newVideoInfoMap);

    if (successfulResults.length === 0) return sources[0];

    const validSpeeds = successfulResults
      .map((result) => resultSpeed(result.testResult.loadSpeed))
      .filter((speed) => speed > 0);

    const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024;

    const validPings = successfulResults
      .map((result) => result.testResult.pingTime)
      .filter((ping) => ping > 0);

    const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
    const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

    const resultsWithScore = successfulResults.map((result) => ({
      ...result,
      score: calculateSourceScore(
        result.testResult,
        maxSpeed,
        minPing,
        maxPing
      ),
    }));

    resultsWithScore.sort((a, b) => b.score - a.score);
    return resultsWithScore[0].source;
  };

  const calculateSourceScore = (
    testResult: VideoSourceTestResult,
    maxSpeed: number,
    minPing: number,
    maxPing: number
  ): number => {
    let score = 0;

    const qualityScore = (() => {
      switch (testResult.quality.toUpperCase()) {
        case '4K':
          return 100;
        case '2K':
          return 85;
        case '1080P':
          return 75;
        case '720P':
          return 60;
        case '480P':
          return 40;
        case 'SD':
          return 20;
        default:
          return 0;
      }
    })();
    score += qualityScore * 0.4;

    const speedScore = (() => {
      const speedVal = resultSpeed(testResult.loadSpeed);
      if (speedVal <= 0) return 30;
      const speedRatio = speedVal / maxSpeed;
      return Math.min(100, Math.max(0, speedRatio * 100));
    })();
    score += speedScore * 0.4;

    const pingScore = (() => {
      const ping = testResult.pingTime;
      if (ping <= 0) return 0;
      if (maxPing === minPing) return 100;
      const pingRatio = (maxPing - ping) / (maxPing - minPing);
      return Math.min(100, Math.max(0, pingRatio * 100));
    })();
    score += pingScore * 0.2;

    return Math.round(score * 100) / 100;
  };

  function resultSpeed(speedStr: string): number {
    if (!speedStr || speedStr === '未知' || speedStr === '测量中...') return 0;
    const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/i);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    return match[2].toUpperCase() === 'MB/S' ? value * 1024 : value;
  }

  // 根据视频宽高计算分辨率标签（同时兼容横屏和竖屏视频）
  const getResolutionLabel = (width: number, height: number): string => {
    if (!width || !height) return '';
    const maxDim = Math.max(width, height);
    const minDim = Math.min(width, height);

    if (maxDim >= 3840 || minDim >= 2160) return '4K';
    if (maxDim >= 2560 || minDim >= 1440) return '2K';
    if (maxDim >= 1920 || minDim >= 1080) return '1080P';
    if (maxDim >= 1280 || minDim >= 720) return '720P';
    if (maxDim >= 854 || minDim >= 480) return '480P';
    return 'SD';
  };

  // 生成分辨率徽章 HTML
  const buildResolutionBadgeHtml = (resolution: string): string => {
    if (!resolution) return '';
    const resUpper = resolution.toUpperCase();
    let bgStyle =
      'background: rgba(0, 0, 0, 0.65); border: 1px solid rgba(255, 255, 255, 0.25); color: #e5e7eb;';

    if (resUpper === '4K') {
      bgStyle =
        'background: linear-gradient(135deg, #f59e0b, #ea580c); border: 1px solid rgba(251, 191, 36, 0.6); color: #ffffff; box-shadow: 0 2px 10px rgba(245, 158, 11, 0.4);';
    } else if (resUpper === '2K') {
      bgStyle =
        'background: linear-gradient(135deg, #8b5cf6, #ec4899); border: 1px solid rgba(167, 139, 250, 0.6); color: #ffffff; box-shadow: 0 2px 10px rgba(139, 92, 246, 0.4);';
    } else if (resUpper === '1080P') {
      bgStyle =
        'background: linear-gradient(135deg, #10b981, #059669); border: 1px solid rgba(52, 211, 153, 0.5); color: #ffffff; box-shadow: 0 2px 8px rgba(16, 185, 129, 0.35);';
    } else if (resUpper === '720P') {
      bgStyle =
        'background: linear-gradient(135deg, #3b82f6, #2563eb); border: 1px solid rgba(96, 165, 250, 0.5); color: #ffffff;';
    }

    return `<div style="padding: 3px 9px; border-radius: 6px; font-size: 12px; font-weight: 700; letter-spacing: 0.5px; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); user-select: none; ${bgStyle}">${resUpper}</div>`;
  };

  const updateVideoUrl = (
    detailData: SearchResult | null,
    episodeIndex: number
  ) => {
    if (
      !detailData ||
      !detailData.episodes ||
      episodeIndex >= detailData.episodes.length
    ) {
      setVideoUrl('');
      return;
    }
    const newUrl = detailData?.episodes[episodeIndex] || '';
    if (newUrl !== videoUrl) {
      setVideoUrl(newUrl);
    } else {
      setIsVideoLoading(false);
    }
  };

  const ensureVideoSource = (video: HTMLVideoElement | null, url: string) => {
    if (!video || !url) return;
    const sources = Array.from(video.getElementsByTagName('source'));
    const existed = sources.some((s) => s.src === url);
    if (!existed) {
      sources.forEach((s) => s.remove());
      const sourceEl = document.createElement('source');
      sourceEl.src = url;
      video.appendChild(sourceEl);
    }
    video.disableRemotePlayback = false;
    if (video.hasAttribute('disableRemotePlayback')) {
      video.removeAttribute('disableRemotePlayback');
    }
  };

  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request(
          'screen'
        );
      }
    } catch (_err) {
      console.debug('Wake Lock 请求失败或未受支持');
    }
  };

  const releaseWakeLock = async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch (_err) {
      console.debug('Wake Lock 释放失败');
    }
  };

  const cleanupPlayer = () => {
    if (clockIntervalRef.current) {
      clearInterval(clockIntervalRef.current);
      clockIntervalRef.current = null;
    }
    if (badgeHideTimerRef.current) {
      clearTimeout(badgeHideTimerRef.current);
      badgeHideTimerRef.current = null;
    }
    if (artPlayerRef.current) {
      try {
        const art = artPlayerRef.current;
        const video = art.video || art.template?.$video;

        if (video) {
          video.muted = true;
          video.currentTime = 0;
          video.pause();

          while (video.firstChild) {
            video.removeChild(video.firstChild);
          }

          video.removeAttribute('src');
          video.removeAttribute('srcObject');
          video.load();

          const hls = video.hls || art.hls;
          if (hls) {
            hls.stopLoad();
            hls.detachMedia();
            hls.destroy();
            video.hls = null;
            art.hls = null;
          }

          if (video.parentNode) {
            video.parentNode.removeChild(video);
          }
        }

        art.destroy(true);
        artPlayerRef.current = null;
      } catch (err) {
        console.warn('⚠️ 清理播放器时出现异常，已强制重置引用:', err);
        artPlayerRef.current = null;
      }
    }
  };

  const formatTime = (seconds: number): string => {
    if (seconds === 0) return '00:00';
    const absSeconds = Math.abs(seconds);
    const hours = Math.floor(absSeconds / 3600);
    const minutes = Math.floor((absSeconds % 3600) / 60);
    const remainingSeconds = Math.round(absSeconds % 60);

    if (hours === 0) {
      return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
        .toString()
        .padStart(2, '0')}`;
    } else {
      return `${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  };

  const handleSkipConfigChange = async (newConfig: {
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }) => {
    if (!currentSourceRef.current || !currentIdRef.current) return;

    try {
      setSkipConfig(newConfig);

      if (!newConfig.enable && !newConfig.intro_time && !newConfig.outro_time) {
        await deleteSkipConfig(currentSourceRef.current, currentIdRef.current);
      } else {
        await saveSkipConfig(
          currentSourceRef.current,
          currentIdRef.current,
          newConfig
        );
      }

      if (artPlayerRef.current && artPlayerRef.current.setting) {
        artPlayerRef.current.setting.update({
          name: '跳过片头片尾',
          switch: newConfig.enable,
        });
        artPlayerRef.current.setting.update({
          name: '设置片头',
          tooltip:
            newConfig.intro_time > 0
              ? formatTime(newConfig.intro_time)
              : '设置片头时间',
        });
        artPlayerRef.current.setting.update({
          name: '设置片尾',
          tooltip:
            newConfig.outro_time < 0
              ? `-${formatTime(-newConfig.outro_time)}`
              : '设置片尾时间',
        });
      }

      console.log('跳过配置已同步:', newConfig);
    } catch (_err) {
      console.debug('保存跳过配置失败');
    }
  };

  class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
    constructor(config: any) {
      super(config);
      const load = this.load.bind(this);
      this.load = function (context: any, config: any, callbacks: any) {
        if (
          (context as any).type === 'manifest' ||
          (context as any).type === 'level'
        ) {
          const onSuccess = callbacks.onSuccess;
          callbacks.onSuccess = function (
            response: any,
            stats: any,
            context: any
          ) {
            if (response.data && typeof response.data === 'string') {
              try {
                const extra = (process.env.NEXT_PUBLIC_AD_BLOCK_PATTERNS || '')
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean);
                installAdLearnHelpers();
                rememberRawPlaylist(response.data);
                const r = filterAdsFromM3U8(response.data, {
                  baseUrl: context?.url,
                  extraPatterns: extra,
                  extraFingerprints: getCustomFingerprints(
                    process.env.NEXT_PUBLIC_AD_FINGERPRINTS
                  ),
                });
                if (r.removedSegments > 0) {
                  console.info(
                    `[去广告] 已移除 ${
                      r.removedSegments
                    } 个分片（约 ${r.removedSeconds.toFixed(1)} 秒）`
                  );
                } else if (
                  r.skippedReason &&
                  r.skippedReason !== 'not-media-playlist'
                ) {
                  console.info(`[去广告] 未过滤：${r.skippedReason}`);
                }
                try {
                  (window as any).__adFilterLast = {
                    url: context?.url,
                    ...r,
                    content: undefined,
                  };
                } catch {
                  // ignore
                }
                response.data =
                  r.removedSegments > 0
                    ? r.content
                    : stripDiscontinuityLegacy(r.content);
              } catch {
                response.data = stripDiscontinuityLegacy(response.data);
              }
            }
            return onSuccess(response, stats, context, null);
          };
        }
        load(context, config, callbacks);
      };
    }
  }

  useEffect(() => {
    updateVideoUrl(detail, currentEpisodeIndex);
  }, [detail, currentEpisodeIndex]);

  useEffect(() => {
    const fetchSourceDetail = async (
      source: string,
      id: string
    ): Promise<SearchResult[]> => {
      try {
        const detailResponse = await fetch(
          `/api/detail?source=${encodeURIComponent(
            source
          )}&id=${encodeURIComponent(id)}`
        );
        if (!detailResponse.ok) throw new Error('获取详情失败');
        const detailData = (await detailResponse.json()) as SearchResult;
        setAvailableSources([detailData]);
        return [detailData];
      } catch (_err) {
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };

    const fetchSourcesData = async (query: string): Promise<SearchResult[]> => {
      try {
        const variants = generateSearchVariants(query);
        const searchQueries = variants.length > 0 ? variants : [query.trim()];
        const allRawResults: SearchResult[] = [];
        const seenKeys = new Set<string>();

        for (let i = 0; i < searchQueries.length; i++) {
          const q = searchQueries[i];
          if (!q) continue;
          const response = await fetch(
            `/api/search?q=${encodeURIComponent(q)}`
          );
          if (!response.ok) {
            if (i === 0) throw new Error('搜索失败');
            continue;
          }
          const data = await response.json();
          const list = Array.isArray(data.results) ? data.results : [];
          for (const item of list) {
            const key = `${item.source}-${item.id}`;
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              allRawResults.push(item);
            }
          }
          // 如果首个主查询已经命中精确标题，无需继续发额外变体请求
          const targetNorm = videoTitleRef.current
            .replaceAll(' ', '')
            .toLowerCase();
          const hasExactInFirst = allRawResults.some(
            (r) => r.title.replaceAll(' ', '').toLowerCase() === targetNorm
          );
          if (hasExactInFirst) break;
        }

        const targetTitleNorm = (videoTitleRef.current || query)
          .replaceAll(' ', '')
          .toLowerCase();
        const requestedYear = videoYearRef.current;

        const matchesType = (result: SearchResult) =>
          searchType
            ? (searchType === 'tv' && result.episodes.length > 1) ||
              (searchType === 'movie' && result.episodes.length === 1)
            : true;

        // 分级匹配：1. 标题完全一致 + 年份匹配 -> 2. 标题完全一致 -> 3. 包含标题 + 年份匹配
        const exactTitleAndYear = allRawResults.filter(
          (result: SearchResult) =>
            result.title.replaceAll(' ', '').toLowerCase() ===
              targetTitleNorm &&
            matchesRequestedYear(result.year, requestedYear) &&
            matchesType(result)
        );

        const exactTitleOnly = allRawResults.filter(
          (result: SearchResult) =>
            result.title.replaceAll(' ', '').toLowerCase() ===
              targetTitleNorm && matchesType(result)
        );

        const looseMatch = allRawResults.filter((result: SearchResult) => {
          const rTitle = result.title.replaceAll(' ', '').toLowerCase();
          return (
            (rTitle.includes(targetTitleNorm) ||
              targetTitleNorm.includes(rTitle)) &&
            matchesRequestedYear(result.year, requestedYear) &&
            matchesType(result)
          );
        });

        const results =
          exactTitleAndYear.length > 0
            ? exactTitleAndYear
            : exactTitleOnly.length > 0
            ? exactTitleOnly
            : looseMatch;

        setAvailableSources(results);
        return results;
      } catch (err) {
        setSourceSearchError(err instanceof Error ? err.message : '搜索失败');
        setAvailableSources([]);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };

    const initAll = async () => {
      if (!currentSource && !currentId && !videoTitle && !searchTitle) {
        setError('缺少必要参数');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadingStage(currentSource && currentId ? 'fetching' : 'searching');
      setLoadingMessage(
        currentSource && currentId
          ? '📍 正在获取视频详情...'
          : '🔍 正在搜索播放源...'
      );

      let sourcesInfo = await fetchSourcesData(searchTitle || videoTitle);
      if (
        currentSource &&
        currentId &&
        !sourcesInfo.some(
          (s) => s.source === currentSource && s.id === currentId
        )
      ) {
        sourcesInfo = await fetchSourceDetail(currentSource, currentId);
      }
      if (sourcesInfo.length === 0) {
        setError('未找到匹配结果');
        setLoading(false);
        return;
      }

      let detailData: SearchResult = sourcesInfo[0];
      if (currentSource && currentId && !needPreferRef.current) {
        const target = sourcesInfo.find(
          (s) => s.source === currentSource && s.id === currentId
        );
        if (target) {
          detailData = target;
        } else {
          setError('未找到匹配结果');
          setLoading(false);
          return;
        }
      }

      if (
        (!currentSource || !currentId || needPreferRef.current) &&
        optimizationEnabled
      ) {
        setLoadingStage('preferring');
        setLoadingMessage('💯 正在优选最佳播放源...');
        detailData = await preferBestSource(sourcesInfo);
      }

      setNeedPrefer(false);
      setCurrentSource(detailData.source);
      setCurrentId(detailData.id);
      setVideoYear(detailData.year);
      setVideoTitle(detailData.title || videoTitleRef.current);
      setVideoCover(detailData.poster);
      setVideoDoubanId(detailData.douban_id || 0);
      setDetail(detailData);

      if (currentEpisodeIndexRef.current >= detailData.episodes.length) {
        setCurrentEpisodeIndex(0);
      }

      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', detailData.source);
      newUrl.searchParams.set('id', detailData.id);
      newUrl.searchParams.set('year', detailData.year);
      newUrl.searchParams.set('title', detailData.title);
      newUrl.searchParams.delete('prefer');
      window.history.replaceState({}, '', newUrl.toString());

      setLoadingStage('ready');
      setLoadingMessage('🔅 准备就绪，即将开始播放...');
      setTimeout(() => setLoading(false), 600);
    };

    initAll();
  }, []);

  // 监听 currentSource 与 currentId，恢复历史进度或换源临时进度
  useEffect(() => {
    const initFromHistory = async () => {
      if (!currentSource || !currentId) return;

      // 优先检查换源保存的 sessionStorage 临时进度
      const tempProgressKey = `temp_progress_${currentSource}_${currentId}_${currentEpisodeIndexRef.current}`;
      try {
        const tempProgressStr = sessionStorage.getItem(tempProgressKey);
        if (tempProgressStr) {
          const tempTime = parseFloat(tempProgressStr);
          sessionStorage.removeItem(tempProgressKey);
          if (!Number.isNaN(tempTime) && tempTime > 0) {
            resumeTimeRef.current = tempTime;
            historyRestoredKeyRef.current = generateStorageKey(
              currentSource,
              currentId
            );
            return;
          }
        }
      } catch {
        // ignore sessionStorage error
      }

      const key = generateStorageKey(currentSource, currentId);
      if (historyRestoredKeyRef.current === key) return;
      historyRestoredKeyRef.current = key;
      try {
        const allRecords = await getAllPlayRecords();
        const record = allRecords[key];
        if (record) {
          const targetIdx = Math.max(0, record.index - 1);
          if (targetIdx !== currentEpisodeIndexRef.current) {
            setCurrentEpisodeIndex(targetIdx);
          }
          resumeTimeRef.current = record.play_time;
        }
      } catch (_err) {
        console.debug('读取历史进度失败');
      }
    };
    initFromHistory();
  }, [currentSource, currentId]);

  useEffect(() => {
    const initSkipConfig = async () => {
      if (!currentSource || !currentId) return;
      try {
        const config = await getSkipConfig(currentSource, currentId);
        if (config) {
          setSkipConfig(config);
        } else {
          setSkipConfig({ enable: false, intro_time: 0, outro_time: 0 });
        }
      } catch (_err) {
        console.debug('读取云端跳过配置失败');
      }
    };
    initSkipConfig();
  }, [currentSource, currentId]);

  // 同步当前集数与标题到全屏顶部标题栏（手机横屏全屏自动连播下一集时实时刷新集数显示）
  useEffect(() => {
    if (!artPlayerRef.current) return;
    const epTitle =
      (detail as any)?.episodes_titles?.[currentEpisodeIndex] ||
      `第 ${currentEpisodeIndex + 1} 集`;
    const fullTitle =
      totalEpisodes > 1 ? `${videoTitle}  ${epTitle}` : videoTitle;

    artPlayerRef.current.title = `${videoTitle} - 第${
      currentEpisodeIndex + 1
    }集`;

    const playerRoot = getPlayerRoot();
    const titleLayerEl = playerRoot?.querySelector(
      '.art-layer-fullscreen-title .fullscreen-title-text'
    ) as HTMLElement | null;
    if (titleLayerEl) {
      titleLayerEl.textContent = fullTitle;
    }
  }, [currentEpisodeIndex, videoTitle, detail, totalEpisodes]);

  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string
  ) => {
    try {
      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);
      isEpisodeChangingRef.current = false;

      const currentPlayTime = artPlayerRef.current?.currentTime || 0;

      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deletePlayRecord(
            currentSourceRef.current,
            currentIdRef.current
          );
          await deleteSkipConfig(
            currentSourceRef.current,
            currentIdRef.current
          );
          await saveSkipConfig(newSource, newId, skipConfigRef.current);
        } catch (_err) {
          console.debug('清除旧源数据记录失败');
        }
      }

      const newDetail = availableSources.find(
        (s) => s.source === newSource && s.id === newId
      );
      if (!newDetail) {
        setIsVideoLoading(false);
        setError('未找到匹配结果');
        return;
      }

      let targetIndex = currentEpisodeIndex;
      if (!newDetail.episodes || targetIndex >= newDetail.episodes.length) {
        targetIndex = 0;
      }

      if (targetIndex !== currentEpisodeIndex) {
        resumeTimeRef.current = 0;
      } else if (
        (!resumeTimeRef.current || resumeTimeRef.current === 0) &&
        currentPlayTime > 1
      ) {
        resumeTimeRef.current = currentPlayTime;
        try {
          sessionStorage.setItem(
            `temp_progress_${newSource}_${newId}_${targetIndex}`,
            String(currentPlayTime)
          );
        } catch {
          // ignore
        }
      }

      // 标记新源由换源逻辑接管进度，不再被 initFromHistory 覆盖
      historyRestoredKeyRef.current = generateStorageKey(newSource, newId);

      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', newSource);
      newUrl.searchParams.set('id', newId);
      newUrl.searchParams.set('year', newDetail.year);
      newUrl.searchParams.set('index', String(targetIndex + 1));
      window.history.replaceState({}, '', newUrl.toString());

      setVideoTitle(newDetail.title || newTitle);
      setVideoYear(newDetail.year);
      setVideoCover(newDetail.poster);
      setVideoDoubanId(newDetail.douban_id || 0);
      setCurrentSource(newSource);
      setCurrentId(newId);
      setDetail(newDetail);
      setCurrentEpisodeIndex(targetIndex);
    } catch (err) {
      setIsVideoLoading(false);
      setError(err instanceof Error ? err.message : '换源失败');
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () =>
      document.removeEventListener('keydown', handleKeyboardShortcuts);
  }, []);

  const syncEpisodeIndexToUrl = (episodeIdx: number) => {
    try {
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('index', String(episodeIdx + 1));
      window.history.replaceState({}, '', newUrl.toString());
    } catch {
      // ignore
    }
  };

  const handleEpisodeChange = (episodeNumber: number) => {
    if (episodeNumber >= 0 && episodeNumber < totalEpisodes) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      isEpisodeChangingRef.current = true;
      shouldAutoPlayAfterSwitchRef.current = true;
      resumeTimeRef.current = null;
      setCurrentEpisodeIndex(episodeNumber);
      syncEpisodeIndexToUrl(episodeNumber);
    }
  };

  const handlePreviousEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx > 0) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      const nextIdx = idx - 1;
      isEpisodeChangingRef.current = true;
      shouldAutoPlayAfterSwitchRef.current = true;
      resumeTimeRef.current = null;
      setCurrentEpisodeIndex(nextIdx);
      syncEpisodeIndexToUrl(nextIdx);
    }
  };

  const handleNextEpisode = (isFromSkip = false) => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx < d.episodes.length - 1) {
      if (!isFromSkip && artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      const nextIdx = idx + 1;
      isEpisodeChangingRef.current = true;
      shouldAutoPlayAfterSwitchRef.current = true;
      resumeTimeRef.current = null;
      setCurrentEpisodeIndex(nextIdx);
      syncEpisodeIndexToUrl(nextIdx);
    }
  };

  const handleKeyboardShortcuts = (e: KeyboardEvent) => {
    if (
      (e.target as HTMLElement).tagName === 'INPUT' ||
      (e.target as HTMLElement).tagName === 'TEXTAREA'
    )
      return;
    if (e.altKey && e.key === 'ArrowLeft') {
      if (detailRef.current && currentEpisodeIndexRef.current > 0) {
        handlePreviousEpisode();
        e.preventDefault();
      }
    }
    if (e.altKey && e.key === 'ArrowRight') {
      const d = detailRef.current;
      const idx = currentEpisodeIndexRef.current;
      if (d && idx < d.episodes.length - 1) {
        handleNextEpisode();
        e.preventDefault();
      }
    }
    if (!e.altKey && e.key === 'ArrowLeft') {
      if (artPlayerRef.current && artPlayerRef.current.currentTime > 5) {
        artPlayerRef.current.currentTime -= 10;
        e.preventDefault();
      }
    }
    if (!e.altKey && e.key === 'ArrowRight') {
      if (
        artPlayerRef.current &&
        artPlayerRef.current.currentTime < artPlayerRef.current.duration - 5
      ) {
        artPlayerRef.current.currentTime += 10;
        e.preventDefault();
      }
    }
    if (e.key === 'ArrowUp') {
      if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }
    if (e.key === 'ArrowDown') {
      if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }
    if (e.key === ' ') {
      if (artPlayerRef.current) {
        artPlayerRef.current.toggle();
        e.preventDefault();
      }
    }
    if (e.key === 'f' || e.key === 'F') {
      if (artPlayerRef.current) {
        artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
        e.preventDefault();
      }
    }
  };

  const saveCurrentPlayProgress = async () => {
    if (
      !artPlayerRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !videoTitleRef.current ||
      !detailRef.current?.source_name
    )
      return;
    const player = artPlayerRef.current;
    const currentTime = player.currentTime || 0;
    const duration = player.duration || 0;
    if (currentTime < 1 || !duration) return;

    try {
      await savePlayRecord(currentSourceRef.current, currentIdRef.current, {
        title: videoTitleRef.current,
        source_name: detailRef.current?.source_name || '',
        year: detailRef.current?.year,
        cover: detailRef.current?.poster || '',
        index: currentEpisodeIndexRef.current + 1,
        total_episodes: detailRef.current?.episodes.length || 1,
        play_time: Math.floor(currentTime),
        total_time: Math.floor(duration),
        save_time: Date.now(),
        search_title: searchTitle,
      });
      lastSaveTimeRef.current = Date.now();
    } catch (_err) {
      console.debug('保存播放进度失败');
    }
  };

  useEffect(() => {
    const handleBeforeUnload = () => {
      saveCurrentPlayProgress();
      releaseWakeLock();
      cleanupPlayer();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveCurrentPlayProgress();
        releaseWakeLock();
      } else if (document.visibilityState === 'visible') {
        if (artPlayerRef.current && !artPlayerRef.current.paused)
          requestWakeLock();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentEpisodeIndex, detail, artPlayerRef.current]);

  useEffect(() => {
    if (!currentSource || !currentId) return;
    (async () => {
      try {
        const fav = await isFavorited(currentSource, currentId);
        setFavorited(fav);
      } catch (_err) {
        console.debug('获取收藏状态失败');
      }
    })();
  }, [currentSource, currentId]);

  useEffect(() => {
    if (!currentSource || !currentId) return;
    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        const key = generateStorageKey(currentSource, currentId);
        setFavorited(!!favorites[key]);
      }
    );
    return unsubscribe;
  }, [currentSource, currentId]);

  const handleToggleFavorite = async () => {
    if (
      !videoTitleRef.current ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    )
      return;
    try {
      if (favorited) {
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        setFavorited(false);
      } else {
        await saveFavorite(currentSourceRef.current, currentIdRef.current, {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
        });
        setFavorited(true);
      }
    } catch (_err) {
      console.debug('切换收藏失败');
    }
  };

  useEffect(() => {
    if (
      !Artplayer ||
      !Hls ||
      !videoUrl ||
      loading ||
      currentEpisodeIndex === null ||
      !artRef.current
    )
      return;

    if (
      !detail ||
      !detail.episodes ||
      currentEpisodeIndex >= detail.episodes.length ||
      currentEpisodeIndex < 0
    ) {
      setError(`选集索引无效，当前共 ${totalEpisodes} 集`);
      return;
    }

    if (!videoUrl) {
      setError('视频地址无效');
      return;
    }

    // 核心改进：如果播放器实例已存在，直接复用当前实例切换 URL，
    // 绝不销毁重建 DOM，从而在手机端重力感应横屏全屏（fullscreen / fullscreenWeb）时
    // 自动跳过片尾或连播下一集无需退出全屏或横屏状态！
    if (artPlayerRef.current && !loading) {
      setIsVideoLoading(false);

      const newType = getArtPlayerType(videoUrl);
      if (artPlayerRef.current.option) {
        artPlayerRef.current.option.type = newType;
      }

      const currentPlaybackRate = sanitizePlaybackRate(
        lastPlaybackRateRef.current || artPlayerRef.current.playbackRate || 1.0
      );

      isSourceSwitchingRef.current = true;

      if (isEpisodeChangingRef.current) {
        artPlayerRef.current
          .switchUrl(videoUrl)
          .then(() => {
            isEpisodeChangingRef.current = false;
            if (artPlayerRef.current) {
              artPlayerRef.current.currentTime = 0;
              artPlayerRef.current.title = `${videoTitle} - 第${
                currentEpisodeIndex + 1
              }集`;
              artPlayerRef.current.poster = videoCover;
              if (artPlayerRef.current.video) {
                ensureVideoSource(
                  artPlayerRef.current.video as HTMLVideoElement,
                  videoUrl
                );
              }
              if (Math.abs(currentPlaybackRate - 1.0) > 0.01) {
                artPlayerRef.current.playbackRate = currentPlaybackRate;
              }
              if (artPlayerRef.current.paused) {
                artPlayerRef.current.play().catch(() => {
                  // ignore autoplay restriction if any, video:canplay will retry
                });
              }
            }
            setTimeout(() => {
              isSourceSwitchingRef.current = false;
            }, 250);
          })
          .catch((err: any) => {
            console.warn('switchUrl 切换异常，回退到 switch:', err);
            isEpisodeChangingRef.current = false;
            isSourceSwitchingRef.current = false;
            if (artPlayerRef.current) {
              artPlayerRef.current.switch = videoUrl;
              artPlayerRef.current.currentTime = 0;
            }
          });
      } else {
        artPlayerRef.current
          .switchQuality(videoUrl)
          .then(() => {
            if (artPlayerRef.current) {
              artPlayerRef.current.title = `${videoTitle} - 第${
                currentEpisodeIndex + 1
              }集`;
              artPlayerRef.current.poster = videoCover;
              if (artPlayerRef.current.video) {
                ensureVideoSource(
                  artPlayerRef.current.video as HTMLVideoElement,
                  videoUrl
                );
              }
              if (Math.abs(currentPlaybackRate - 1.0) > 0.01) {
                artPlayerRef.current.playbackRate = currentPlaybackRate;
              }
              if (artPlayerRef.current.paused) {
                artPlayerRef.current.play().catch(() => {
                  // ignore
                });
              }
            }
            setTimeout(() => {
              isSourceSwitchingRef.current = false;
            }, 250);
          })
          .catch((err: any) => {
            console.warn('switchQuality 切换异常，回退到 switchUrl:', err);
            isSourceSwitchingRef.current = false;
            if (artPlayerRef.current) {
              artPlayerRef.current.switchUrl(videoUrl);
            }
          });
      }
      return;
    }

    if (artPlayerRef.current) cleanupPlayer();

    try {
      Artplayer.PLAYBACK_RATE = ALLOWED_PLAYBACK_RATES;
      Artplayer.USE_RAF = false;
      Artplayer.FULLSCREEN_WEB_IN_BODY = true;

      const isMobile = isMobileDevice();
      const savedFit =
        typeof window !== 'undefined'
          ? localStorage.getItem('video_object_fit') || 'contain'
          : 'contain';
      const fitTooltipMap: Record<string, string> = {
        contain: '默认(完整显示)',
        cover: '填充(裁切)',
        fill: '拉伸(变形)',
      };

      const initialEpTitle =
        (detail as any)?.episodes_titles?.[currentEpisodeIndex] ||
        `第 ${currentEpisodeIndex + 1} 集`;
      const initialFullTitle =
        totalEpisodes > 1
          ? `${videoTitle}  ${initialEpTitle}`
          : videoTitle || '';

      artPlayerRef.current = new Artplayer({
        container: artRef.current,
        url: videoUrl,
        type: getArtPlayerType(videoUrl),
        poster: videoCover,
        volume: 0.7,
        isLive: false,
        muted: false,
        autoplay: true,
        pip: true,
        autoSize: false,
        autoMini: false,
        screenshot: false,
        setting: true,
        loop: false,
        flip: false,
        playbackRate: true,
        aspectRatio: false,
        fullscreen: true,
        fullscreenWeb: true,
        subtitleOffset: false,
        miniProgressBar: false,
        mutex: true,
        playsInline: true,
        autoPlayback: false,
        airplay: true,
        theme: '#22c55e',
        lang: 'zh-cn',
        hotkey: false,
        fastForward: true,
        autoOrientation: true,
        lock: true,
        moreVideoAttr: {
          crossOrigin: 'anonymous',
          playsInline: true,
          'webkit-playsinline': 'true',
        } as any,
        layers: [
          {
            name: 'fullscreen-title',
            html: `<div class="fullscreen-title-text" style="padding: 8px 14px; border-radius: 8px; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); color: #ffffff; font-size: 14px; font-weight: 600; max-width: 70vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${initialFullTitle}</div>`,
            style: {
              position: 'absolute',
              top: '16px',
              left: '20px',
              zIndex: '50',
              pointerEvents: 'none',
              display: 'none',
              transition: 'opacity 0.3s ease',
            },
          },
          {
            name: 'fullscreen-clock',
            html: `<div class="fullscreen-clock-text" style="padding: 6px 12px; border-radius: 8px; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); color: #ffffff; font-size: 13px; font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;"></div>`,
            style: {
              position: 'absolute',
              top: '16px',
              right: '20px',
              zIndex: '50',
              pointerEvents: 'none',
              display: 'none',
              transition: 'opacity 0.3s ease',
            },
          },
          {
            name: 'resolution-badge',
            html: '',
            style: {
              position: 'absolute',
              top: '16px',
              right: '20px',
              zIndex: '45',
              pointerEvents: 'none',
              transition: 'opacity 0.4s ease',
              opacity: '0',
            },
          },
        ],
        customType: {
          m3u8: function (video: HTMLVideoElement, url: string, art: any) {
            if (!Hls) return;
            if (video.hls) {
              try {
                video.hls.destroy();
              } catch {
                // ignore
              }
            }
            if (art?.hls && art.hls !== video.hls) {
              try {
                art.hls.destroy();
              } catch {
                // ignore
              }
            }

            if (Hls.isSupported()) {
              let mediaErrorRecoveryCount = 0;
              const hls = new Hls({
                debug: false,
                enableWorker: !isIOSGlobal,
                preferManagedMediaSource: true,
                lowLatencyMode: false,
                maxBufferLength: isMobile ? 30 : 60,
                maxMaxBufferLength: isMobile ? 60 : 120,
                backBufferLength: isMobile ? 15 : 30,
                maxBufferSize: isMobile ? 60 * 1000 * 1000 : 100 * 1000 * 1000,
                fragLoadingTimeOut: 20000,
                manifestLoadingTimeOut: 15000,
                levelLoadingTimeOut: 15000,
                loader: blockAdEnabledRef.current
                  ? CustomHlsJsLoader
                  : Hls.DefaultConfig.loader,
              });

              hls.loadSource(url);
              hls.attachMedia(video);
              video.hls = hls;
              if (art) art.hls = hls;

              ensureVideoSource(video, url);

              hls.on(Hls.Events.ERROR, function (_event: any, data: any) {
                // 容忍非致命的分片解析或时间戳附加误差
                if (!data.fatal) {
                  if (
                    data.details === Hls.ErrorDetails.FRAG_PARSING_ERROR ||
                    data.details === Hls.ErrorDetails.BUFFER_APPEND_ERROR
                  ) {
                    console.debug(
                      '忽略非致命 HLS 分片/缓冲警告:',
                      data.details
                    );
                  }
                  return;
                }

                switch (data.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR:
                    hls.startLoad();
                    break;
                  case Hls.ErrorTypes.MEDIA_ERROR:
                    mediaErrorRecoveryCount++;
                    if (mediaErrorRecoveryCount === 1) {
                      hls.recoverMediaError();
                    } else if (mediaErrorRecoveryCount === 2) {
                      hls.swapAudioCodec();
                      hls.recoverMediaError();
                    } else {
                      hls.recoverMediaError();
                    }
                    break;
                  default:
                    hls.destroy();
                    setIsVideoLoading(false);
                    break;
                }
              });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
              video.src = url;
              ensureVideoSource(video, url);
            }
          },
        },
        icons: {
          loading:
            '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
        },
        settings: [
          {
            name: 'video-fit',
            html: '显示模式',
            tooltip: fitTooltipMap[savedFit] || '默认(完整显示)',
            selector: [
              {
                html: '默认(完整显示)',
                value: 'contain',
                default: savedFit === 'contain',
              },
              {
                html: '填充(裁切)',
                value: 'cover',
                default: savedFit === 'cover',
              },
              {
                html: '拉伸(变形)',
                value: 'fill',
                default: savedFit === 'fill',
              },
            ],
            onSelect: function (item: any) {
              const fitVal = item.value || 'contain';
              try {
                localStorage.setItem('video_object_fit', fitVal);
              } catch {
                // ignore
              }
              const vEl = artPlayerRef.current?.video as
                | HTMLVideoElement
                | undefined;
              if (vEl) {
                vEl.style.objectFit = fitVal;
              }
              return item.html;
            },
          },
          {
            html: '去广告',
            icon: '<text x="50%" y="50%" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">AD</text>',
            tooltip: blockAdEnabledRef.current ? '已开启' : '已关闭',
            onClick() {
              const newVal = !blockAdEnabledRef.current;
              try {
                localStorage.setItem('enable_blockad', String(newVal));
                if (artPlayerRef.current) {
                  resumeTimeRef.current = artPlayerRef.current.currentTime;
                  if (artPlayerRef.current.video?.hls) {
                    artPlayerRef.current.video.hls.destroy();
                  }
                  artPlayerRef.current.destroy();
                  artPlayerRef.current = null;
                }
                setBlockAdEnabled(newVal);
              } catch (_err) {
                console.debug('去广告状态切换出错');
              }
              return newVal ? '当前开启' : '当前关闭';
            },
          },
          {
            name: '跳过片头片尾',
            html: '跳过片头片尾',
            switch: skipConfigRef.current.enable,
            onSwitch: function (item) {
              const newConfig = {
                ...skipConfigRef.current,
                enable: !item.switch,
              };
              handleSkipConfigChange(newConfig);
              return !item.switch;
            },
          },
          {
            html: '删除跳过配置',
            onClick: function () {
              handleSkipConfigChange({
                enable: false,
                intro_time: 0,
                outro_time: 0,
              });
              return '';
            },
          },
          {
            name: '设置片头',
            html: '设置片头',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
            tooltip:
              skipConfigRef.current.intro_time === 0
                ? '设置片头时间'
                : `${formatTime(skipConfigRef.current.intro_time)}`,
            onClick: function () {
              const currentTime = artPlayerRef.current?.currentTime || 0;
              if (currentTime > 0) {
                handleSkipConfigChange({
                  ...skipConfigRef.current,
                  intro_time: currentTime,
                  enable: true,
                });
                return `${formatTime(currentTime)}`;
              }
            },
          },
          {
            name: '设置片尾',
            html: '设置片尾',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
            tooltip:
              skipConfigRef.current.outro_time >= 0
                ? '设置片尾时间'
                : `-${formatTime(-skipConfigRef.current.outro_time)}`,
            onClick: function () {
              const outroTime =
                -(
                  artPlayerRef.current?.duration -
                  artPlayerRef.current?.currentTime
                ) || 0;
              if (outroTime < 0) {
                handleSkipConfigChange({
                  ...skipConfigRef.current,
                  outro_time: outroTime,
                  enable: true,
                });
                return `-${formatTime(-outroTime)}`;
              }
            },
          },
        ],
        controls: [
          {
            position: 'left',
            index: 13,
            html: '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
            tooltip: '播放下一集',
            click: function () {
              handleNextEpisode();
            },
          },
        ],
      });

      // 全屏标题与实时时钟更新逻辑
      const updateClockText = () => {
        const playerRoot = getPlayerRoot();
        if (!playerRoot) return;
        const clockEl = playerRoot.querySelector(
          '.art-layer-fullscreen-clock .fullscreen-clock-text'
        ) as HTMLElement | null;
        if (clockEl) {
          const now = new Date();
          const hh = String(now.getHours()).padStart(2, '0');
          const mm = String(now.getMinutes()).padStart(2, '0');
          const ss = String(now.getSeconds()).padStart(2, '0');
          clockEl.textContent = `${hh}:${mm}:${ss}`;
        }
      };

      const syncFullscreenLayers = (isFull: boolean) => {
        const playerRoot = getPlayerRoot();
        if (!playerRoot) return;
        const titleLayer = playerRoot.querySelector(
          '.art-layer-fullscreen-title'
        ) as HTMLElement | null;
        const clockLayer = playerRoot.querySelector(
          '.art-layer-fullscreen-clock'
        ) as HTMLElement | null;
        const badgeLayer = playerRoot.querySelector(
          '.art-layer-resolution-badge'
        ) as HTMLElement | null;

        if (isFull) {
          if (titleLayer) {
            titleLayer.style.display = 'block';
            titleLayer.style.opacity = '1';
          }
          if (clockLayer) {
            updateClockText();
            clockLayer.style.display = 'block';
            clockLayer.style.opacity = '1';
          }
          if (badgeLayer) {
            badgeLayer.style.top = '54px';
          }
          if (!clockIntervalRef.current) {
            clockIntervalRef.current = setInterval(updateClockText, 1000);
          }
        } else {
          if (titleLayer) titleLayer.style.display = 'none';
          if (clockLayer) clockLayer.style.display = 'none';
          if (badgeLayer) {
            badgeLayer.style.top = '16px';
          }
          if (clockIntervalRef.current) {
            clearInterval(clockIntervalRef.current);
            clockIntervalRef.current = null;
          }
        }
      };

      // 显示并在 3 秒后自动隐藏分辨率徽章
      const showResolutionBadgeTemporarily = () => {
        const playerRoot = getPlayerRoot();
        if (!playerRoot || !detectedResolutionRef.current) return;
        const badgeLayer = playerRoot.querySelector(
          '.art-layer-resolution-badge'
        ) as HTMLElement | null;
        if (!badgeLayer) return;

        badgeLayer.innerHTML = buildResolutionBadgeHtml(
          detectedResolutionRef.current
        );
        badgeLayer.style.opacity = '1';

        if (badgeHideTimerRef.current) clearTimeout(badgeHideTimerRef.current);
        badgeHideTimerRef.current = setTimeout(() => {
          if (badgeLayer) badgeLayer.style.opacity = '0';
        }, 3000);
      };

      // 检测并更新真实视频分辨率
      const detectAndApplyResolution = () => {
        const videoEl = artPlayerRef.current?.video as
          | HTMLVideoElement
          | undefined;
        if (!videoEl) return;
        const label = getResolutionLabel(
          videoEl.videoWidth,
          videoEl.videoHeight
        );
        if (label) {
          setDetectedResolution(label);
          detectedResolutionRef.current = label;
          showResolutionBadgeTemporarily();

          if (currentSourceRef.current && currentIdRef.current) {
            const sourceKey = `${currentSourceRef.current}-${currentIdRef.current}`;
            setPrecomputedVideoInfo((prev) => {
              const next = new Map(prev);
              const existing = next.get(sourceKey);
              next.set(sourceKey, {
                quality: label,
                loadSpeed: existing?.loadSpeed || '未知',
                pingTime: existing?.pingTime || 0,
              });
              return next;
            });
          }
        }
      };

      artPlayerRef.current.on('fullscreen', (state: boolean) => {
        syncFullscreenLayers(state || !!artPlayerRef.current?.fullscreenWeb);
      });

      artPlayerRef.current.on('fullscreenWeb', (state: boolean) => {
        syncFullscreenLayers(state || !!artPlayerRef.current?.fullscreen);
      });

      artPlayerRef.current.on('control', (state: boolean) => {
        const playerRoot = getPlayerRoot();
        if (!playerRoot) return;
        const isFull =
          !!artPlayerRef.current?.fullscreen ||
          !!artPlayerRef.current?.fullscreenWeb;
        if (!isFull) return;
        const titleLayer = playerRoot.querySelector(
          '.art-layer-fullscreen-title'
        ) as HTMLElement | null;
        const clockLayer = playerRoot.querySelector(
          '.art-layer-fullscreen-clock'
        ) as HTMLElement | null;
        if (titleLayer) titleLayer.style.opacity = state ? '1' : '0';
        if (clockLayer) clockLayer.style.opacity = state ? '1' : '0';
      });

      artPlayerRef.current.on('ready', () => {
        setError(null);
        const vEl = artPlayerRef.current?.video as HTMLVideoElement | undefined;
        if (vEl && savedFit) {
          vEl.style.objectFit = savedFit;
        }
        const savedRate = sanitizePlaybackRate(lastPlaybackRateRef.current);
        if (artPlayerRef.current && Math.abs(savedRate - 1.0) > 0.01) {
          artPlayerRef.current.playbackRate = savedRate;
        }
        if (artPlayerRef.current && !artPlayerRef.current.paused) {
          requestWakeLock();
        }
      });

      artPlayerRef.current.on('play', () => requestWakeLock());
      artPlayerRef.current.on('pause', () => {
        releaseWakeLock();
        const player = artPlayerRef.current;
        if (player) {
          const duration = player.duration || 0;
          const currentTime = player.currentTime || 0;
          const remainingOutro =
            skipConfigRef.current.outro_time < 0
              ? -skipConfigRef.current.outro_time
              : skipConfigRef.current.outro_time;
          // 避免在片尾区域暂停时将片尾时间覆写为历史进度
          if (
            skipConfigRef.current.enable &&
            remainingOutro > 0 &&
            duration > remainingOutro &&
            currentTime >= duration - remainingOutro
          ) {
            return;
          }
        }
        saveCurrentPlayProgress();
      });

      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        requestWakeLock();
      }

      artPlayerRef.current.on('video:volumechange', () => {
        lastVolumeRef.current = artPlayerRef.current.volume;
      });

      artPlayerRef.current.on('video:ratechange', () => {
        if (!artPlayerRef.current) return;
        const currentRate = artPlayerRef.current.playbackRate;
        // 换源或换集期间浏览器可能会将倍速短暂重置为 1.0，此时不覆盖用户保存的倍速
        if (
          isSourceSwitchingRef.current &&
          Math.abs(currentRate - 1.0) < 0.01 &&
          Math.abs(lastPlaybackRateRef.current - 1.0) > 0.01
        ) {
          return;
        }
        const sanitized = sanitizePlaybackRate(currentRate);
        lastPlaybackRateRef.current = sanitized;
        try {
          localStorage.setItem(PLAYER_PLAYBACK_RATE_KEY, String(sanitized));
        } catch {
          // ignore
        }
      });

      artPlayerRef.current.on('video:loadedmetadata', () => {
        detectAndApplyResolution();
      });

      artPlayerRef.current.on('video:canplay', () => {
        if (resumeTimeRef.current && resumeTimeRef.current > 0) {
          try {
            const duration = artPlayerRef.current.duration || 0;
            let target = resumeTimeRef.current;
            if (duration && target >= duration - 2) {
              target = Math.max(0, duration - 5);
            }
            artPlayerRef.current.currentTime = target;
          } catch (_err) {
            console.debug('恢复播放进度失败');
          }
        }
        resumeTimeRef.current = null;

        setTimeout(() => {
          if (
            artPlayerRef.current &&
            Math.abs(artPlayerRef.current.volume - lastVolumeRef.current) > 0.01
          ) {
            artPlayerRef.current.volume = lastVolumeRef.current;
          }
          const targetRate = sanitizePlaybackRate(lastPlaybackRateRef.current);
          if (
            artPlayerRef.current &&
            Math.abs(artPlayerRef.current.playbackRate - targetRate) > 0.01
          ) {
            artPlayerRef.current.playbackRate = targetRate;
          }
          const vEl = artPlayerRef.current?.video as
            | HTMLVideoElement
            | undefined;
          const currentFit =
            localStorage.getItem('video_object_fit') || 'contain';
          if (vEl && vEl.style.objectFit !== currentFit) {
            vEl.style.objectFit = currentFit;
          }
          // 若是自动跳过片尾或选集触发的切换，确保在新集可播放时自动开始播放
          if (shouldAutoPlayAfterSwitchRef.current && artPlayerRef.current) {
            shouldAutoPlayAfterSwitchRef.current = false;
            if (artPlayerRef.current.paused) {
              artPlayerRef.current.play().catch(() => {
                // ignore
              });
            }
          }
        }, 0);

        detectAndApplyResolution();
        setIsVideoLoading(false);
      });

      artPlayerRef.current.on('video:timeupdate', () => {
        const player = artPlayerRef.current;
        if (!player) return;

        const currentTime = player.currentTime || 0;
        const duration = player.duration || 0;

        const introTime = skipConfigRef.current.intro_time;
        const outroTime = skipConfigRef.current.outro_time;
        const remainingOutro = outroTime < 0 ? -outroTime : outroTime;

        const now = Date.now();
        const interval =
          process.env.NEXT_PUBLIC_STORAGE_TYPE === 'upstash' ? 20000 : 5000;
        if (now - lastSaveTimeRef.current > interval) {
          const isInOutroZone =
            skipConfigRef.current.enable &&
            remainingOutro > 0 &&
            duration > remainingOutro &&
            currentTime >= duration - remainingOutro;
          if (!isInOutroZone) {
            saveCurrentPlayProgress();
            lastSaveTimeRef.current = now;
          }
        }

        if (!skipConfigRef.current.enable) return;
        if (resumeTimeRef.current && resumeTimeRef.current > 0) return;

        if (introTime > 0) {
          if (currentTime < introTime && !hasSkippedIntroRef.current) {
            if (
              player.video &&
              !player.video.seeking &&
              player.video.readyState >= 1
            ) {
              hasSkippedIntroRef.current = true;
              player.currentTime = introTime;
              player.notice.show = `已自动跳过片头 (${formatTime(introTime)})`;
            }
          } else if (currentTime >= introTime && !hasSkippedIntroRef.current) {
            hasSkippedIntroRef.current = true;
          }
        }

        if (remainingOutro > 0) {
          if (
            duration > remainingOutro &&
            currentTime >= duration - remainingOutro &&
            !hasSkippedOutroRef.current &&
            !isSkipControllerTriggeredRef.current
          ) {
            const d = detailRef.current;
            const idx = currentEpisodeIndexRef.current;
            if (d && d.episodes && idx < d.episodes.length - 1) {
              if (!player.paused) {
                hasSkippedOutroRef.current = true;
                isSkipControllerTriggeredRef.current = true;
                player.notice.show = `已自动跳过片尾 (${formatTime(
                  remainingOutro
                )})，即将播放下一集`;
                // 不调用 player.pause()，直接原位切换下一集 URL，保持手机横屏全屏与自动连播状态
                handleNextEpisode(true);
                return;
              }
            } else if (d && d.episodes && idx === d.episodes.length - 1) {
              hasSkippedOutroRef.current = true;
              player.notice.show = '已到达最后一集片尾';
            }
          }
        }
      });

      artPlayerRef.current.on('error', (_err: any) => {
        setIsVideoLoading(false);
        if (artPlayerRef.current?.currentTime > 0) return;
      });

      artPlayerRef.current.on('video:ended', () => {
        releaseWakeLock();
        if (
          videoEndedHandledRef.current ||
          isSkipControllerTriggeredRef.current
        ) {
          return;
        }
        videoEndedHandledRef.current = true;
        const d = detailRef.current;
        const idx = currentEpisodeIndexRef.current;
        if (d && d.episodes && idx < d.episodes.length - 1) {
          setTimeout(() => {
            handleNextEpisode(true);
          }, 500);
        }
      });

      if (artPlayerRef.current?.video) {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          videoUrl
        );
      }

      // 绑定用户交互显示分辨率徽章（绑定在 $player 上，兼容网页全屏挂载到 body 的情况）
      const playerEl = getPlayerRoot();
      if (playerEl) {
        const handleUserInteract = () => {
          showResolutionBadgeTemporarily();
        };
        playerEl.addEventListener('mousemove', handleUserInteract, {
          passive: true,
        });
        playerEl.addEventListener('touchstart', handleUserInteract, {
          passive: true,
        });
        playerEl.addEventListener('click', handleUserInteract, {
          passive: true,
        });
      }
    } catch (_err) {
      setIsVideoLoading(false);
      setError('播放器初始化失败');
    }
  }, [Artplayer, Hls, videoUrl, loading, blockAdEnabled]);

  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) clearInterval(saveIntervalRef.current);
      releaseWakeLock();
      cleanupPlayer();
    };
  }, []);

  if (loading) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>
                  {loadingStage === 'searching' && '🔍'}
                  {loadingStage === 'preferring' && '💯'}
                  {loadingStage === 'fetching' && '📍'}
                  {loadingStage === 'ready' && '🔅'}
                </div>
                <div className='absolute -inset-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl opacity-20 animate-spin'></div>
              </div>
              <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                <div className='absolute top-2 left-2 w-2 h-2 bg-green-400 rounded-full animate-bounce'></div>
                <div
                  className='absolute top-4 right-4 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.5s' }}
                ></div>
                <div
                  className='absolute bottom-3 left-6 w-1 h-1 bg-lime-400 rounded-full animate-bounce'
                  style={{ animationDelay: '1s' }}
                ></div>
              </div>
            </div>

            <div className='mb-6 w-full max-w-[20rem] mx-auto'>
              <div className='flex justify-center space-x-2 mb-4'>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'searching' || loadingStage === 'fetching'
                      ? 'bg-green-500 scale-125'
                      : loadingStage === 'preferring' ||
                        loadingStage === 'ready'
                      ? 'bg-green-500'
                      : 'bg-gray-300'
                  }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'preferring'
                      ? 'bg-green-500 scale-125'
                      : loadingStage === 'ready'
                      ? 'bg-green-500'
                      : 'bg-gray-300'
                  }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'ready'
                      ? 'bg-green-500 scale-125'
                      : 'bg-gray-300'
                  }`}
                ></div>
              </div>
              <div className='w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden'>
                <div
                  className='h-full bg-gradient-to-r from-green-500 to-emerald-600 rounded-full transition-all duration-1000 ease-out'
                  style={{
                    width:
                      loadingStage === 'searching' ||
                      loadingStage === 'fetching'
                        ? '33%'
                        : loadingStage === 'preferring'
                        ? '66%'
                        : '100%',
                  }}
                ></div>
              </div>
            </div>

            <div className='space-y-2'>
              <p className='text-xl font-semibold text-gray-800 dark:text-gray-200 animate-pulse'>
                {loadingMessage}
              </p>
              {loadingStage === 'preferring' && speedTestProgress.total > 0 && (
                <p className='text-sm text-gray-500 dark:text-gray-400'>
                  已完成 {speedTestProgress.completed} /{' '}
                  {speedTestProgress.total} 个播放源测速
                </p>
              )}
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>😵</div>
                <div className='absolute -inset-2 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl opacity-20 animate-pulse'></div>
              </div>
              <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                <div className='absolute top-2 left-2 w-2 h-2 bg-red-400 rounded-full animate-bounce'></div>
                <div
                  className='absolute top-4 right-4 w-1.5 h-1.5 bg-orange-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.5s' }}
                ></div>
                <div
                  className='absolute bottom-3 left-6 w-1 h-1 bg-yellow-400 rounded-full animate-bounce'
                  style={{ animationDelay: '1s' }}
                ></div>
              </div>
            </div>

            <div className='space-y-4 mb-8'>
              <h2 className='text-2xl font-bold text-gray-800 dark:text-gray-200'>
                哎呀，出现了一些问题
              </h2>
              <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4'>
                <p className='text-red-600 dark:text-red-400 font-medium'>
                  {error}
                </p>
              </div>
              <p className='text-sm text-gray-500 dark:text-gray-400'>
                请检查网络连接或尝试刷新页面
              </p>
            </div>

            <div className='space-y-3'>
              <button
                onClick={() =>
                  videoTitle
                    ? router.push(`/search?q=${encodeURIComponent(videoTitle)}`)
                    : router.back()
                }
                className='w-full px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium hover:from-green-600 hover:to-emerald-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl'
              >
                {videoTitle ? '🔍 返回搜索' : '← 返回上页'}
              </button>
              <button
                onClick={() => window.location.reload()}
                className='w-full px-6 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200'
              >
                🔄 重新尝试
              </button>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/play'>
      <div className='flex flex-col w-full max-w-full min-w-0 gap-3 py-4 px-4 sm:px-5 lg:px-[3rem] 2xl:px-20'>
        <div className='py-1'>
          <h1 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
            {videoTitle || '影片标题'}
            {totalEpisodes > 1 && (
              <span className='text-gray-500 dark:text-gray-400'>
                {` > ${
                  (detail as any)?.episodes_titles?.[currentEpisodeIndex] ||
                  `第 ${currentEpisodeIndex + 1} 集`
                }`}
              </span>
            )}
          </h1>
        </div>

        <div className='space-y-2'>
          <div className='hidden lg:flex justify-end'>
            <button
              onClick={() =>
                setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
              }
              className='group relative flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/80 hover:bg-white dark:bg-gray-800/80 dark:hover:bg-gray-800 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 shadow-sm hover:shadow-md transition-all duration-200'
              title={
                isEpisodeSelectorCollapsed ? '显示选集面板' : '隐藏选集面板'
              }
            >
              <svg
                className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${
                  isEpisodeSelectorCollapsed ? 'rotate-180' : 'rotate-0'
                }`}
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M9 5l7 7-7 7'
                />
              </svg>
              <span className='text-xs font-medium text-gray-600 dark:text-gray-300'>
                {isEpisodeSelectorCollapsed ? '显示' : '隐藏'}
              </span>
              <div
                className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full transition-all duration-200 ${
                  isEpisodeSelectorCollapsed
                    ? 'bg-orange-400 animate-pulse'
                    : 'bg-green-400'
                }`}
              ></div>
            </button>
          </div>

          <div
            className={`grid gap-4 lg:h-[500px] xl:h-[650px] 2xl:h-[750px] transition-all duration-300 ease-in-out ${
              isEpisodeSelectorCollapsed
                ? 'grid-cols-1'
                : 'grid-cols-1 md:grid-cols-4'
            }`}
          >
            <div
              className={`h-full min-w-0 transition-all duration-300 ease-in-out rounded-xl border border-white/0 dark:border-white/30 ${
                isEpisodeSelectorCollapsed ? 'col-span-1' : 'md:col-span-3'
              }`}
            >
              <div className='relative w-full h-[300px] lg:h-full'>
                <div
                  ref={artRef}
                  className='bg-black w-full h-full rounded-xl overflow-hidden shadow-lg'
                ></div>
                {isVideoLoading && (
                  <div className='absolute inset-0 bg-black/85 backdrop-blur-sm rounded-xl flex items-center justify-center z-[500] transition-all duration-300'>
                    <div className='text-center max-w-md mx-auto px-6'>
                      <div className='relative mb-8'>
                        <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                          <div className='text-white text-4xl'>🎰</div>
                          <div className='absolute -inset-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl opacity-20 animate-spin'></div>
                        </div>
                        <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                          <div className='absolute top-2 left-2 w-2 h-2 bg-green-400 rounded-full animate-bounce'></div>
                          <div
                            className='absolute top-4 right-4 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce'
                            style={{ animationDelay: '0.5s' }}
                          ></div>
                          <div
                            className='absolute bottom-3 left-6 w-1 h-1 bg-lime-400 rounded-full animate-bounce'
                            style={{ animationDelay: '1s' }}
                          ></div>
                        </div>
                      </div>
                      <div className='space-y-2'>
                        <p className='text-xl font-semibold text-white animate-pulse'>
                          {videoLoadingStage === 'sourceChanging'
                            ? '🔯 切换播放源...'
                            : '🔅 视频加载中...'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div
              className={`h-[300px] lg:h-full min-w-0 overflow-hidden transition-all duration-300 ease-in-out ${
                isEpisodeSelectorCollapsed
                  ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95'
                  : 'md:col-span-1 lg:opacity-100 lg:scale-100'
              }`}
            >
              <EpisodeSelector
                totalEpisodes={totalEpisodes}
                episodes_titles={(detail as any)?.episodes_titles || []}
                value={currentEpisodeIndex + 1}
                onChange={handleEpisodeChange}
                onSourceChange={handleSourceChange}
                currentSource={currentSource}
                currentId={currentId}
                videoTitle={searchTitle || videoTitle}
                videoYear={videoYear}
                availableSources={availableSources}
                sourceSearchLoading={sourceSearchLoading}
                sourceSearchError={sourceSearchError}
                precomputedVideoInfo={precomputedVideoInfo}
              />
            </div>
          </div>
        </div>

        <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
          <div className='md:col-span-3'>
            <div className='p-6 flex flex-col min-h-0'>
              <h1 className='text-3xl font-bold mb-2 tracking-wide flex items-center flex-shrink-0 text-center md:text-left w-full'>
                {videoTitle || '影片标题'}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleFavorite();
                  }}
                  className='ml-3 flex-shrink-0 hover:opacity-80 transition-opacity'
                >
                  <FavoriteIcon filled={favorited} />
                </button>
              </h1>
              <div className='flex flex-wrap items-center gap-3 text-base mb-4 opacity-80 flex-shrink-0'>
                {detail?.class && (
                  <span className='text-green-600 font-semibold'>
                    {detail.class}
                  </span>
                )}
                {(detail?.year || videoYear) && (
                  <span>{detail?.year || videoYear}</span>
                )}
                {detail?.source_name && (
                  <span className='border border-gray-500/60 px-2 py-[1px] rounded'>
                    {detail.source_name}
                  </span>
                )}
                {detail?.type_name && <span>{detail.type_name}</span>}
              </div>
              {detail?.desc && (
                <div
                  className='mt-0 text-base leading-relaxed opacity-90 overflow-y-auto pr-2 flex-1 min-h-0 scrollbar-hide'
                  style={{ whiteSpace: 'pre-line' }}
                >
                  {detail.desc}
                </div>
              )}
            </div>
          </div>

          <div className='hidden md:block md:col-span-1 md:order-first'>
            <div className='pl-0 py-4 pr-6'>
              <div className='relative bg-gray-300 dark:bg-gray-700 aspect-[2/3] flex items-center justify-center rounded-xl overflow-hidden'>
                {videoCover ? (
                  <>
                    <img
                      src={processImageUrl(videoCover)}
                      alt={videoTitle}
                      className='w-full h-full object-cover'
                    />
                    {videoDoubanId !== 0 && (
                      <a
                        href={`https://movie.douban.com/subject/${videoDoubanId.toString()}`}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='absolute top-3 left-3'
                      >
                        <div className='bg-green-500 text-white text-xs font-bold w-8 h-8 rounded-full flex items-center justify-center shadow-md hover:bg-green-600 hover:scale-[1.1] transition-all duration-300 ease-out'>
                          <svg
                            width='16'
                            height='16'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            strokeWidth='2'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                          >
                            <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'></path>
                            <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'></path>
                          </svg>
                        </div>
                      </a>
                    )}
                  </>
                ) : (
                  <span className='text-gray-600 dark:text-gray-400'>
                    封面图片
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

const FavoriteIcon = ({ filled }: { filled: boolean }) => {
  if (filled) {
    return (
      <svg
        className='h-7 w-7'
        viewBox='0 0 24 24'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
          fill='#ef4444'
          stroke='#ef4444'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    );
  }
  return (
    <Heart className='h-7 w-7 stroke-[1] text-gray-600 dark:text-gray-300' />
  );
};

export default function PlayPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PlayPageClient />
    </Suspense>
  );
}
