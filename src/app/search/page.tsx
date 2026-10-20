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
  // 已有部分结果、其余资源站仍在搜索中
  const [isStreaming, setIsStreaming] = useState(false);
  // 用于取消上一次尚未结束的搜索，避免旧结果覆盖新结果
  const abortRef = useRef<AbortController | null>(null);
  // 🛡️ 逻辑修复 (LOG-04)：记录最近一次已触发的搜索词，防止 handleSearch 与 useEffect([searchParams]) 双重触发
  const lastTriggeredQueryRef = useRef<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  // 获取默认聚合设置：只读取用户本地设置，默认为 true
  const getDefaultAggregate = () => {
    if (typeof window !== 'undefined') {
      const userSetting = localStorage.getItem('defaultAggregateSearch');
      if (userSetting !== null) {
        return JSON.parse(userSetting);
      }
    }
    return true;
  };

  // 是否启用流式搜索：读取用户本地设置，默认开启；值缺失或损坏时按开启处理
  const getEnableStreamSearch = (): boolean => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('enableStreamSearch');
        if (saved !== null) {
          const parsed = JSON.parse(saved);
          if (typeof parsed === 'boolean') return parsed;
        }
      } catch {
        // 忽略，走默认值
      }
    }
    return true;
  };

  const [viewMode, setViewMode] = useState<'agg' | 'all'>(() => {
    return getDefaultAggregate() ? 'agg' : 'all';
  });

  // 聚合后的结果（按标题和年份分组）
  const aggregatedResults = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    searchResults.forEach((item) => {
      const key = `${item.title.replaceAll(' ', '')}-${
        item.year || 'unknown'
      }-${item.episodes.length === 1 ? 'movie' : 'tv'}`;
      const arr = map.get(key) || [];
      arr.push(item);
      map.set(key, arr);
    });
    const normalizedQuery = searchQuery.trim().replaceAll(' ', '').toLowerCase();
    return Array.from(map.entries()).sort((a, b) => {
      // 🛡️ 逻辑修复 (LOG-04)：使用精确相等比较代替 .includes()，确保同名作品真正排在最前
      const aExactMatch =
        a[1][0].title.replaceAll(' ', '').toLowerCase() === normalizedQuery;
      const bExactMatch =
        b[1][0].title.replaceAll(' ', '').toLowerCase() === normalizedQuery;

      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      // 年份排序
      if (a[1][0].year === b[1][0].year) {
        return a[0].localeCompare(b[0]);
      } else {
        const aYear = a[1][0].year;
        const bYear = b[1][0].year;

        if (aYear === 'unknown' && bYear === 'unknown') {
          return 0;
        } else if (aYear === 'unknown') {
          return 1;
        } else if (bYear === 'unknown') {
          return -1;
        } else {
          return aYear > bYear ? -1 : 1;
        }
      }
    });
  }, [searchResults, searchQuery]);

  useEffect(() => {
    !searchParams.get('q') && document.getElementById('searchInput')?.focus();

    getSearchHistory().then(setSearchHistory);

    const unsubscribe = subscribeToDataUpdates(
      'searchHistoryUpdated',
      (newHistory: string[]) => {
        setSearchHistory(newHistory);
      }
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    const query = searchParams.get('q');
    if (query) {
      const trimmed = query.trim().replace(/\s+/g, ' ');
      setSearchQuery(trimmed);
      if (lastTriggeredQueryRef.current !== trimmed) {
        lastTriggeredQueryRef.current = trimmed;
        fetchSearchResults(trimmed);
        addSearchHistory(trimmed);
      }
    } else {
      lastTriggeredQueryRef.current = null;
      setShowResults(false);
    }
  }, [searchParams]);

  // 排序：标题与搜索词完全一致的优先，其次按年份从新到旧，最后按标题
  const sortResults = (list: SearchResult[], query: string) => {
    const q = query.trim();
    return list.slice().sort((a, b) => {
      const aExactMatch = a.title === q;
      const bExactMatch = b.title === q;
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      if (a.year === b.year) {
        return a.title.localeCompare(b.title);
      }
      if (a.year === 'unknown') return 1;
      if (b.year === 'unknown') return -1;
      return parseInt(a.year) > parseInt(b.year) ? -1 : 1;
    });
  };

  const fetchSearchResults = async (query: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const isStale = () => abortRef.current !== controller;

    const trimmed = query.trim();
    const useStream = getEnableStreamSearch();
    setIsLoading(true);
    setIsStreaming(false);
    setSearchResults([]);

    const bySource = new Map<string, SearchResult[]>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      if (isStale()) return;
      const merged = Array.from(bySource.values()).flat();
      setSearchResults(sortResults(merged, trimmed));
      setShowResults(true);
      setIsLoading(false);
      setIsStreaming(true);
    };
    const scheduleFlush = () => {
      if (flushTimer === null) flushTimer = setTimeout(flush, 120);
    };

    const fallbackToPlainSearch = async () => {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal }
      );
      const data = await response.json();
      if (isStale()) return;
      setSearchResults(sortResults(data.results || [], trimmed));
    };

    try {
      if (!useStream) {
        await fallbackToPlainSearch();
        if (!isStale()) setShowResults(true);
        return;
      }

      const response = await fetch(
        `/api/search/stream?q=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal }
      );

      if (response.status === 429) {
        if (!isStale()) setSearchResults([]);
      } else if (!response.ok || !response.body) {
        await fallbackToPlainSearch();
      } else {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const handleLine = (line: string) => {
          if (!line.trim()) return;
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'results' && Array.isArray(msg.results)) {
              const prev = bySource.get(msg.source) || [];
              bySource.set(msg.source, prev.concat(msg.results));
              scheduleFlush();
            }
          } catch {
            // 忽略损坏的行
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            handleLine(buffer.slice(0, nl));
            buffer = buffer.slice(nl + 1);
          }
        }
        handleLine(buffer);

        if (flushTimer !== null) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (!isStale()) {
          setSearchResults(
            sortResults(Array.from(bySource.values()).flat(), trimmed)
          );
        }
      }
      if (!isStale()) setShowResults(true);
    } catch (error: any) {
      if (error?.name === 'AbortError' || isStale()) return;
      if (!useStream) {
        setSearchResults([]);
        return;
      }
      try {
        await fallbackToPlainSearch();
        if (!isStale()) setShowResults(true);
      } catch {
        if (!isStale()) setSearchResults([]);
      }
    } finally {
      if (flushTimer !== null) clearTimeout(flushTimer);
      if (!isStale()) {
        setIsLoading(false);
        setIsStreaming(false);
      }
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;

    setSearchQuery(trimmed);
    setIsLoading(true);
    setShowResults(true);

    // 标记本次搜索已由表单提交触发，避免 router.push 引发的 useEffect 再次重复发起请求
    lastTriggeredQueryRef.current = trimmed;
    fetchSearchResults(trimmed);
    addSearchHistory(trimmed);
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
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
          {isLoading ? (
            <div className='flex justify-center items-center h-40'>
              <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
            </div>
          ) : showResults ? (
            <section className='mb-12'>
              {/* 标题 + 聚合开关 */}
              <div className='mb-8 flex items-center justify-between'>
                <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                  搜索结果
                  {isStreaming && (
                    <span className='ml-3 inline-flex items-center gap-1.5 text-sm font-normal text-gray-500 dark:text-gray-400'>
                      <span className='inline-block h-3.5 w-3.5 animate-spin rounded-full border-b-2 border-green-500'></span>
                      仍在搜索其他资源站…
                    </span>
                  )}
                </h2>
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
                {searchResults.length === 0 && !isStreaming && (
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
                      clearSearchHistory();
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
                        const trimmed = item.trim();
                        setSearchQuery(trimmed);
                        lastTriggeredQueryRef.current = trimmed;
                        fetchSearchResults(trimmed);
                        addSearchHistory(trimmed);
                        router.push(
                          `/search?q=${encodeURIComponent(trimmed)}`
                        );
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
                        deleteSearchHistory(item);
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
