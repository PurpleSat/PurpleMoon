/* eslint-disable @next/next/no-img-element */

import { useRouter } from 'next/navigation';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8, processImageUrl } from '@/lib/utils';

// 定义视频信息类型
interface VideoInfo {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  hasError?: boolean;
}

interface EpisodeSelectorProps {
  /** 总集数 */
  totalEpisodes: number;
  /** 分集标题数组 */
  episodes_titles?: string[];
  /** 每页显示多少集，默认 50 */
  episodesPerPage?: number;
  /** 当前选中的集数（1 开始） */
  value?: number;
  /** 用户点击选集后的回调 */
  onChange?: (episodeNumber: number) => void;
  /** 换源相关 */
  onSourceChange?: (source: string, id: string, title: string) => void;
  currentSource?: string;
  currentId?: string;
  videoTitle?: string;
  videoYear?: string;
  availableSources?: SearchResult[];
  sourceSearchLoading?: boolean;
  sourceSearchError?: string | null;
  /** 预计算的测速结果，避免重复测速 */
  precomputedVideoInfo?: Map<string, VideoInfo>;
}

/**
 * 选集组件，支持分页、分集标题显示、自动滚动聚焦，以及换源功能。
 */
const EpisodeSelector: React.FC<EpisodeSelectorProps> = ({
  totalEpisodes,
  episodes_titles = [],
  episodesPerPage = 50,
  value = 1,
  onChange,
  onSourceChange,
  currentSource,
  currentId,
  videoTitle,
  availableSources = [],
  sourceSearchLoading = false,
  sourceSearchError = null,
  precomputedVideoInfo,
}) => {
  const router = useRouter();
  const pageCount = Math.ceil(totalEpisodes / episodesPerPage);

  const [videoInfoMap, setVideoInfoMap] = useState<Map<string, VideoInfo>>(new Map());
  const [attemptedSources, setAttemptedSources] = useState<Set<string>>(new Set());

  const attemptedSourcesRef = useRef<Set<string>>(new Set());
  const videoInfoMapRef = useRef<Map<string, VideoInfo>>(new Map());

  useEffect(() => {
    attemptedSourcesRef.current = attemptedSources;
  }, [attemptedSources]);

  useEffect(() => {
    videoInfoMapRef.current = videoInfoMap;
  }, [videoInfoMap]);

  const [activeTab, setActiveTab] = useState<'episodes' | 'sources'>(
    totalEpisodes > 1 ? 'episodes' : 'sources'
  );

  const initialPage = Math.floor((value - 1) / episodesPerPage);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [descending, setDescending] = useState<boolean>(false);

  const getVideoInfo = useCallback(async (source: SearchResult) => {
    const sourceKey = `${source.source}-${source.id}`;
    if (attemptedSourcesRef.current.has(sourceKey)) return;

    if (!source.episodes || source.episodes.length === 0) return;
    const episodeUrl = source.episodes.length > 1 ? source.episodes[1] : source.episodes[0];

    setAttemptedSources((prev) => new Set(prev).add(sourceKey));

    try {
      const info = await getVideoResolutionFromM3u8(episodeUrl);
      setVideoInfoMap((prev) => new Map(prev).set(sourceKey, info));
    } catch (error) {
      setVideoInfoMap((prev) =>
        new Map(prev).set(sourceKey, {
          quality: '错误',
          loadSpeed: '未知',
          pingTime: 0,
          hasError: true,
        })
      );
    }
  }, []);

  useEffect(() => {
    if (precomputedVideoInfo && precomputedVideoInfo.size > 0) {
      setVideoInfoMap((prev) => {
        const newMap = new Map(prev);
        precomputedVideoInfo.forEach((value, key) => newMap.set(key, value));
        return newMap;
      });

      setAttemptedSources((prev) => {
        const newSet = new Set(prev);
        precomputedVideoInfo.forEach((info, key) => {
          if (!info.hasError) newSet.add(key);
        });
        return newSet;
      });

      precomputedVideoInfo.forEach((info, key) => {
        if (!info.hasError) attemptedSourcesRef.current.add(key);
      });
    }
  }, [precomputedVideoInfo]);

  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch { }
      }
    }
    return true;
  });

  useEffect(() => {
    const fetchVideoInfosInBatches = async () => {
      if (!optimizationEnabled || activeTab !== 'sources' || availableSources.length === 0) return;

      const pendingSources = availableSources.filter((source) => {
        const sourceKey = `${source.source}-${source.id}`;
        return !attemptedSourcesRef.current.has(sourceKey);
      });

      if (pendingSources.length === 0) return;

      const batchSize = Math.ceil(pendingSources.length / 2);
      for (let start = 0; start < pendingSources.length; start += batchSize) {
        const batch = pendingSources.slice(start, start + batchSize);
        await Promise.all(batch.map(getVideoInfo));
      }
    };
    fetchVideoInfosInBatches();
  }, [activeTab, availableSources, getVideoInfo, optimizationEnabled]);

  const categoriesAsc = useMemo(() => {
    return Array.from({ length: pageCount }, (_, i) => {
      const start = i * episodesPerPage + 1;
      const end = Math.min(start + episodesPerPage - 1, totalEpisodes);
      return `${start}-${end}`;
    });
  }, [pageCount, episodesPerPage, totalEpisodes]);

  const categories = categoriesAsc;
  const categoryContainerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const btn = buttonRefs.current[currentPage];
    const container = categoryContainerRef.current;
    if (btn && container) {
      const containerRect = container.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const scrollLeft = container.scrollLeft;
      const btnLeft = btnRect.left - containerRect.left + scrollLeft;
      const btnWidth = btnRect.width;
      const containerWidth = containerRect.width;
      const targetScrollLeft = btnLeft - (containerWidth - btnWidth) / 2;
      container.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
    }
  }, [currentPage, pageCount]);

  const handleSourceTabClick = () => setActiveTab('sources');
  const handleCategoryClick = useCallback((index: number) => setCurrentPage(index), []);
  const handleEpisodeClick = useCallback((episodeNumber: number) => onChange?.(episodeNumber), [onChange]);
  const handleSourceClick = useCallback(
    (source: SearchResult) => onSourceChange?.(source.source, source.id, source.title),
    [onSourceChange]
  );

  const currentStart = currentPage * episodesPerPage + 1;
  const currentEnd = Math.min(currentStart + episodesPerPage - 1, totalEpisodes);

  // 智能识别是否包含分集标题
  const hasValidTitles = episodes_titles && episodes_titles.length > 0 && episodes_titles.some(t => t && t.length > 2);
  const gridClass = hasValidTitles 
    ? 'grid-cols-[repeat(auto-fill,minmax(140px,1fr))]' 
    : 'grid-cols-[repeat(auto-fill,minmax(40px,1fr))]';

  return (
    <div className='md:ml-2 px-4 py-0 h-full rounded-xl bg-black/10 dark:bg-white/5 flex flex-col border border-white/0 dark:border-white/30 overflow-hidden'>
      <div className='flex mb-1 -mx-6 flex-shrink-0'>
        {totalEpisodes > 1 && (
          <div
            onClick={() => setActiveTab('episodes')}
            className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
              ${activeTab === 'episodes'
                ? 'text-green-600 dark:text-green-400'
                : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
              }
            `.trim()}
          >
            选集
          </div>
        )}
        <div
          onClick={handleSourceTabClick}
          className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
            ${activeTab === 'sources'
              ? 'text-green-600 dark:text-green-400'
              : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
            }
          `.trim()}
        >
          换源
        </div>
      </div>

      {activeTab === 'episodes' && (
        <>
          <div className='flex items-center gap-4 mb-4 border-b border-gray-300 dark:border-gray-700 -mx-6 px-6 flex-shrink-0'>
            <div className='flex-1 overflow-x-auto scrollbar-hide' ref={categoryContainerRef}>
              <div className='flex gap-2 min-w-max pb-1'>
                {categories.map((label, idx) => {
                  const isActive = idx === currentPage;
                  return (
                    <button
                      key={label}
                      ref={(el) => { buttonRefs.current[idx] = el; }}
                      onClick={() => handleCategoryClick(idx)}
                      className={`w-20 relative py-2 text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 text-center 
                        ${isActive
                          ? 'text-green-500 dark:text-green-400'
                          : 'text-gray-700 hover:text-green-600 dark:text-gray-300 dark:hover:text-green-400'
                        }
                      `.trim()}
                    >
                      {label}
                      {isActive && <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-green-500 dark:bg-green-400' />}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              className='flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-gray-700 hover:text-green-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-green-400 dark:hover:bg-white/20 transition-colors transform translate-y-[-4px]'
              onClick={() => setDescending((prev) => !prev)}
            >
              <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4' />
              </svg>
            </button>
          </div>

          <div className={`grid ${gridClass} auto-rows-[40px] gap-x-3 gap-y-3 overflow-y-auto h-full pb-4 scrollbar-hide`}>
            {(() => {
              const len = currentEnd - currentStart + 1;
              return Array.from({ length: len }, (_, i) => descending ? currentEnd - i : currentStart + i);
            })().map((episodeNumber) => {
              const isActive = episodeNumber === value;
              // 显示优先：分集标题 -> 纯数字
              const displayTitle = episodes_titles[episodeNumber - 1] || episodeNumber;
              return (
                <button
                  key={episodeNumber}
                  onClick={() => handleEpisodeClick(episodeNumber - 1)}
                  title={displayTitle.toString()}
                  className={`h-10 flex items-center justify-center text-sm font-medium rounded-md transition-all duration-200 px-2 truncate
                    ${isActive
                      ? 'bg-green-500 text-white shadow-lg shadow-green-500/25 dark:bg-green-600'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300 hover:scale-105 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20'
                    }`.trim()}
                >
                  {displayTitle}
                </button>
              );
            })}
          </div>
        </>
      )}

      {activeTab === 'sources' && (
        <div className='flex flex-col h-full mt-4'>
          {sourceSearchLoading && (
            <div className='flex items-center justify-center py-8'>
              <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
              <span className='ml-2 text-sm text-gray-600 dark:text-gray-300'>搜索中...</span>
            </div>
          )}

          {sourceSearchError && (
            <div className='flex items-center justify-center py-8'>
              <div className='text-center'>
                <div className='text-red-500 text-2xl mb-2'>⚠️</div>
                <p className='text-sm text-red-600 dark:text-red-400'>{sourceSearchError}</p>
              </div>
            </div>
          )}

          {!sourceSearchLoading && !sourceSearchError && availableSources.length === 0 && (
            <div className='flex items-center justify-center py-8'>
              <div className='text-center'>
                <div className='text-gray-400 text-2xl mb-2'>📺</div>
                <p className='text-sm text-gray-600 dark:text-gray-300'>暂无可用的换源</p>
              </div>
            </div>
          )}

          {!sourceSearchLoading && !sourceSearchError && availableSources.length > 0 && (
            <div className='flex-1 overflow-y-auto space-y-2 pb-20 scrollbar-hide'>
              {availableSources
                .sort((a, b) => {
                  const aIsCurrent = a.source?.toString() === currentSource?.toString() && a.id?.toString() === currentId?.toString();
                  const bIsCurrent = b.source?.toString() === currentSource?.toString() && b.id?.toString() === currentId?.toString();
                  if (aIsCurrent && !bIsCurrent) return -1;
                  if (!aIsCurrent && bIsCurrent) return 1;
                  return 0;
                })
                .map((source, index) => {
                  const isCurrentSource = source.source?.toString() === currentSource?.toString() && source.id?.toString() === currentId?.toString();
                  return (
                    <div
                      key={`${source.source}-${source.id}`}
                      onClick={() => !isCurrentSource && handleSourceClick(source)}
                      className={`flex items-start gap-3 px-2 py-3 rounded-lg transition-all select-none duration-200 relative
                      ${isCurrentSource
                          ? 'bg-green-500/10 dark:bg-green-500/20 border-green-500/30 border'
                          : 'hover:bg-gray-200/50 dark:hover:bg-white/10 hover:scale-[1.02] cursor-pointer'
                        }`.trim()}
                    >
                      <div className='flex-shrink-0 w-12 h-20 bg-gray-300 dark:bg-gray-600 rounded overflow-hidden'>
                        {source.episodes && source.episodes.length > 0 && (
                          <img
                            src={processImageUrl(source.poster)}
                            alt={source.title}
                            className='w-full h-full object-cover'
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                            }}
                          />
                        )}
                      </div>

                      <div className='flex-1 min-w-0 flex flex-col justify-between h-20'>
                        <div className='flex items-start justify-between gap-3 h-6'>
                          <div className='flex-1 min-w-0 relative group/title'>
                            <h3 className='font-medium text-base truncate text-gray-900 dark:text-gray-100 leading-none'>
                              {source.title}
                            </h3>
                          </div>
                          {(() => {
                            const sourceKey = `${source.source}-${source.id}`;
                            const videoInfo = videoInfoMap.get(sourceKey);

                            if (videoInfo && videoInfo.quality !== '未知') {
                              if (videoInfo.hasError) {
                                return (
                                  <div className='bg-gray-500/10 dark:bg-gray-400/20 text-red-600 dark:text-red-400 px-1.5 py-0 rounded text-xs flex-shrink-0 min-w-[50px] text-center'>
                                    检测失败
                                  </div>
                                );
                              } else {
                                const isUltraHigh = ['4K', '2K'].includes(videoInfo.quality);
                                const isHigh = ['1080p', '720p'].includes(videoInfo.quality);
                                const textColorClasses = isUltraHigh
                                  ? 'text-purple-600 dark:text-purple-400'
                                  : isHigh
                                    ? 'text-green-600 dark:text-green-400'
                                    : 'text-yellow-600 dark:text-yellow-400';

                                return (
                                  <div className={`bg-gray-500/10 dark:bg-gray-400/20 ${textColorClasses} px-1.5 py-0 rounded text-xs flex-shrink-0 min-w-[50px] text-center`}>
                                    {videoInfo.quality}
                                  </div>
                                );
                              }
                            }
                            return null;
                          })()}
                        </div>

                        <div className='flex items-center justify-between'>
                          <span className='text-xs px-2 py-1 border border-gray-500/60 rounded text-gray-700 dark:text-gray-300'>
                            {source.source_name}
                          </span>
                          {source.episodes.length > 1 && (
                            <span className='text-xs text-gray-500 dark:text-gray-400 font-medium'>
                              {source.episodes.length} 集
                            </span>
                          )}
                        </div>

                        <div className='flex items-end h-6'>
                          {(() => {
                            const sourceKey = `${source.source}-${source.id}`;
                            const videoInfo = videoInfoMap.get(sourceKey);
                            if (videoInfo) {
                              if (!videoInfo.hasError) {
                                return (
                                  <div className='flex items-end gap-3 text-xs'>
                                    <div className='text-green-600 dark:text-green-400 font-medium text-xs'>
                                      {videoInfo.loadSpeed}
                                    </div>
                                    <div className='text-orange-600 dark:text-orange-400 font-medium text-xs'>
                                      {videoInfo.pingTime}ms
                                    </div>
                                  </div>
                                );
                              } else {
                                return <div className='text-red-500/90 dark:text-red-400 font-medium text-xs'>无测速数据</div>;
                              }
                            }
                          })()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              <div className='flex-shrink-0 mt-auto pt-2 border-t border-gray-400 dark:border-gray-700'>
                <button
                  onClick={() => {
                    if (videoTitle) {
                      router.push(`/search?q=${encodeURIComponent(videoTitle)}`);
                    }
                  }}
                  className='w-full text-center text-xs text-gray-500 dark:text-gray-400 hover:text-green-500 dark:hover:text-green-400 transition-colors py-2'
                >
                  影片匹配有误？点击去搜索
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default EpisodeSelector;
