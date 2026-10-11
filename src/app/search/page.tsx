/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any */
'use client';

import { Search, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';

import {
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';

import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

function SearchPageClient() {
  // 搜索历史
  const [searchHistory, setSearchHistory] = useState<string[]>([]);

  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchProgress, setSearchProgress] = useState<{ completed: number; total: number }>({
    completed: 0,
    total: 0,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  // 获取默认聚合设置：只读取用户本地设置，默认为 true
  const getDefaultAggregate = () => {
    if (typeof window !== 'undefined') {
      const userSetting = localStorage.getItem('defaultAggregateSearch');
      if (userSetting !== null) {
        return JSON.parse(userSetting);
      }
    }
    return true; // 默认启用聚合
  };

  const [viewMode, setViewMode] = useState<'agg' | 'all'>(() => {
    return getDefaultAggregate() ? 'agg' : 'all';
  });

  // 排序辅助函数
  const sortSearchResults = (results: SearchResult[], currentQuery: string) => {
    const trimmedQuery = currentQuery.trim().replaceAll(' ', '');
    return [...results].sort((a, b) => {
      // 优先排序：标题与搜索词完全一致的排在前面
      const aExactMatch = a.title.replaceAll(' ', '') === trimmedQuery;
      const bExactMatch = b.title.replaceAll(' ', '') === trimmedQuery;

      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      // 如果都匹配或都不匹配，则按原来的逻辑排序
      if (a.year === b.year) {
        return a.title.localeCompare(b.title);
      } else {
        // 处理 unknown 的情况
        if (a.year === 'unknown' && b.year === 'unknown') {
          return 0;
        } else if (a.year === 'unknown') {
          return 1; // a 排在后面
        } else if (b.year === 'unknown') {
          return -1; // b 排在后面
        } else {
          // 都是数字年份，按数字大小排序（大的在前面）
          return parseInt(a.year) > parseInt(b.year) ? -1 : 1;
        }
      }
    });
  };

  // 聚合后的结果（按标题和年份分组）
  const aggregatedResults = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    searchResults.forEach((item) => {
      // 使用 title + year + type 作为键，year 必然存在，但依然兜底 'unknown'
      const key = `${item.title.replaceAll(' ', '')}-${
        item.year || 'unknown'
      }-${item.episodes.length === 1 ? 'movie' : 'tv'}`;
      const arr = map.get(key) || [];
      arr.push(item);
      map.set(key, arr);
    });
    return Array.from(map.entries()).sort((a, b) => {
      // 优先排序：标题与搜索词完全一致的排在前面
      const aExactMatch = a[1][0].title
        .replaceAll(' ', '')
        .includes(searchQuery.trim().replaceAll(' ', ''));
      const bExactMatch = b[1][0].title
        .replaceAll(' ', '')
        .includes(searchQuery.trim().replaceAll(' ', ''));

      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      // 年份排序
      if (a[1][0].year === b[1][0].year) {
        return a[0].localeCompare(b[0]);
      } else {
        // 处理 unknown 的情况
        const aYear = a[1][0].year;
        const bYear = b[1][0].year;

        if (aYear === 'unknown' && bYear === 'unknown') {
          return 0;
        } else if (aYear === 'unknown') {
          return 1; // a 排在后面
        } else if (bYear === 'unknown') {
          return -1; // b 排在后面
        } else {
          // 都是数字年份，按数字大小排序（大的在前面）
          return aYear > bYear ? -1 : 1;
        }
      }
    });
  }, [searchResults, searchQuery]);

  useEffect(() => {
    // 无搜索参数时聚焦搜索框
    !searchParams.get('q') && document.getElementById('searchInput')?.focus();

    // 初始加载搜索历史
    getSearchHistory().then(setSearchHistory);

    // 监听搜索历史更新事件
    const unsubscribe = subscribeToDataUpdates(
      'searchHistoryUpdated',
      (newHistory: string[]) => {
        setSearchHistory(newHistory);
      }
    );

    return () => {
      unsubscribe();
      abortControllerRef.current?.abort();
    };
  }, []);

  // 当搜索参数变化时更新搜索状态（单向驱动，杜绝提交时重复请求两次）
  useEffect(() => {
    const query = searchParams.get('q');
    if (query) {
      const trimmed = query.trim();
      setSearchQuery(trimmed);
      fetchSearchResults(trimmed);

      // 保存到搜索历史 (事件监听会自动更新界面)
      addSearchHistory(trimmed);
    } else {
      setShowResults(false);
      setSearchResults([]);
      setSearchProgress({ completed: 0, total: 0 });
    }
  }, [searchParams]);

  // 边搜边显示的流式搜索请求函数
  const fetchSearchResults = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    // 中止任何之前正在进行的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setIsLoading(true);
      setShowResults(true);
      setSearchResults([]);
      setSearchProgress({ completed: 0, total: 0 });

      const response = await fetch(
        `/api/search?q=${encodeURIComponent(trimmed)}&stream=1`,
        {
          signal: controller.signal,
          headers: {
            Accept: 'text/event-stream, application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream') && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            const trimmedPart = part.trim();
            if (!trimmedPart) continue;

            const lines = trimmedPart.split('\n');
            for (const line of lines) {
              if (line.startsWith('data:')) {
                const jsonStr = line.replace(/^data:\s*/, '').trim();
                if (!jsonStr) continue;
                try {
                  const event = JSON.parse(jsonStr);
                  if (event.type === 'start') {
                    setSearchProgress((prev) => ({
                      ...prev,
                      total: event.totalSites || 0,
                    }));
                  } else if (event.type === 'progress') {
                    setSearchProgress({
                      completed: event.completed || 0,
                      total: event.total || 0,
                    });
                  } else if (event.type === 'chunk' && Array.isArray(event.results) && event.results.length > 0) {
                    setSearchResults((prev) => {
                      const existingMap = new Set<string>();
                      for (const item of prev) {
                        existingMap.add(`${item.source}-${item.id}`);
                      }
                      const newItems: SearchResult[] = [];
                      for (const item of event.results) {
                        const key = `${item.source}-${item.id}`;
                        if (!existingMap.has(key)) {
                          existingMap.add(key);
                          newItems.push(item);
                        }
                      }
                      if (newItems.length === 0) return prev;
                      return sortSearchResults([...prev, ...newItems], trimmed);
                    });
                  } else if (event.type === 'done') {
                    setIsLoading(false);
                  }
                } catch {
                  // 忽略个别异常分片
                }
              }
            }
          }
        }
      } else {
        // 兼容降级非流式 JSON
        const data = await response.json();
        if (data && Array.isArray(data.results)) {
          setSearchResults(sortSearchResults(data.results, trimmed));
        } else {
          setSearchResults([]);
        }
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        // 请求被主动中止，无需处理
        return;
      }
      console.error('搜索异常:', error);
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  // 提交搜索：去重优化，统一由 router.push 驱动，解决重复发送两次请求问题
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;

    setSearchQuery(trimmed);

    const currentUrlQ = searchParams.get('q')?.trim().replace(/\s+/g, ' ');
    if (currentUrlQ === trimmed) {
      // 词未变更时 router.push 不会产生变更，手动重新搜索
      fetchSearchResults(trimmed);
      addSearchHistory(trimmed);
    } else {
      // 路由跳转会更新 searchParams 并由 useEffect 统一触发搜索，杜绝重复请求
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    }
  };

  return (
    <PageLayout activePath='/search'>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible mb-10'>
        {/* 搜索框 */}
        <div className='mb-8'>
          <form onSubmit={handleSearch} className='max-w-2xl mx-auto'>
            <div className='relative'>
              <Search className='absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500' />
              <input
                id='searchInput'
                type='text'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder='搜索电影、电视剧...'
                className='w-full h-12 rounded-lg bg-gray-50/80 py-3 pl-10 pr-4 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400 focus:bg-white border border-gray-200/50 shadow-sm dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:bg-gray-700 dark:border-gray-700'
              />
            </div>
          </form>
        </div>

        {/* 搜索结果或搜索历史 */}
        <div className='max-w-[95%] mx-auto mt-12 overflow-visible'>
          {isLoading && searchResults.length === 0 ? (
            // 首次搜索、首条结果尚未返回时的等待状态
            <div className='flex flex-col justify-center items-center h-40 gap-3'>
              <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
              <p className='text-sm text-gray-500 dark:text-gray-400'>
                正在并发检索资源源...
              </p>
            </div>
          ) : showResults ? (
            <section className='mb-12'>
              {/* 标题 + 流式进行提示 + 聚合开关 */}
              <div className='mb-8 flex items-center justify-between'>
                <div className='flex items-center gap-3'>
                  <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                    搜索结果
                  </h2>
                  {isLoading && (
                    <div className='flex items-center gap-2 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/40 px-2.5 py-1 rounded-full border border-green-200/60 dark:border-green-800/60 animate-pulse'>
                      <span className='inline-block w-2 h-2 rounded-full bg-green-500'></span>
                      <span>
                        正在实时检索更多源 {searchProgress.total > 0 ? `(${searchProgress.completed}/${searchProgress.total})` : '...'}
                      </span>
                    </div>
                  )}
                </div>
                {/* 聚合开关 */}
                <label className='flex items-center gap-2 cursor-pointer select-none'>
                  <span className='text-sm text-gray-700 dark:text-gray-300'>
                    聚合
                  </span>
                  <div className='relative'>
                    <input
                      type='checkbox'
                      className='sr-only peer'
                      checked={viewMode === 'agg'}
                      onChange={() =>
                        setViewMode(viewMode === 'agg' ? 'all' : 'agg')
                      }
                    />
                    <div className='w-9 h-5 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                    <div className='absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4'></div>
                  </div>
                </label>
              </div>
              <div
                key={`search-results-${viewMode}`}
                className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'
              >
                {viewMode === 'agg'
                  ? aggregatedResults.map(([mapKey, group]) => {
                      return (
                        <div key={`agg-${mapKey}`} className='w-full'>
                          <VideoCard
                            from='search'
                            items={group}
                            query={
                              searchQuery.trim() !== group[0].title
                                ? searchQuery.trim()
                                : ''
                            }
                          />
                        </div>
                      );
                    })
                  : searchResults.map((item) => (
                      <div
                        key={`all-${item.source}-${item.id}`}
                        className='w-full'
                      >
                        <VideoCard
                          id={item.id}
                          title={item.title}
                          poster={item.poster}
                          episodes={item.episodes.length}
                          source={item.source}
                          source_name={item.source_name}
                          query={
                            searchQuery.trim() !== item.title
                              ? searchQuery.trim()
                              : ''
                          }
                          year={item.year}
                          from='search'
                          type={item.episodes.length > 1 ? 'tv' : 'movie'}
                        />
                      </div>
                    ))}
                {searchResults.length === 0 && !isLoading && (
                  <div className='col-span-full text-center text-gray-500 py-8 dark:text-gray-400'>
                    未找到相关结果
                  </div>
                )}
              </div>
            </section>
          ) : searchHistory.length > 0 ? (
            // 搜索历史
            <section className='mb-12'>
              <h2 className='mb-4 text-xl font-bold text-gray-800 text-left dark:text-gray-200'>
                搜索历史
                {searchHistory.length > 0 && (
                  <button
                    onClick={() => {
                      clearSearchHistory(); // 事件监听会自动更新界面
                    }}
                    className='ml-3 text-sm text-gray-500 hover:text-red-500 transition-colors dark:text-gray-400 dark:hover:text-red-500'
                  >
                    清空
                  </button>
                )}
              </h2>
              <div className='flex flex-wrap gap-2'>
                {searchHistory.map((item) => (
                  <div key={item} className='relative group'>
                    <button
                      onClick={() => {
                        const trimmedItem = item.trim();
                        setSearchQuery(trimmedItem);
                        const currentUrlQ = searchParams.get('q')?.trim();
                        if (currentUrlQ === trimmedItem) {
                          fetchSearchResults(trimmedItem);
                        } else {
                          router.push(
                            `/search?q=${encodeURIComponent(trimmedItem)}`
                          );
                        }
                      }}
                      className='px-4 py-2 bg-gray-500/10 hover:bg-gray-300 rounded-full text-sm text-gray-700 transition-colors duration-200 dark:bg-gray-700/50 dark:hover:bg-gray-600 dark:text-gray-300'
                    >
                      {item}
                    </button>
                    {/* 删除按钮 */}
                    <button
                      aria-label='删除搜索历史'
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        deleteSearchHistory(item); // 事件监听会自动更新界面
                      }}
                      className='absolute -top-1 -right-1 w-4 h-4 opacity-0 group-hover:opacity-100 bg-gray-400 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] transition-colors'
                    >
                      <X className='w-3 h-3' />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </PageLayout>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageClient />
    </Suspense>
  );
}
