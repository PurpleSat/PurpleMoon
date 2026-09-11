/* eslint-disable @next/next/no-img-element */

'use client';

import { ChevronLeft, ChevronRight, Play, Server, Tv } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SearchResult as GlobalSearchResult } from '@/lib/types';

import PageLayout from '@/components/PageLayout';

type Source = { key: string; name: string; api: string };
type Category = { type_id: string | number; type_name: string };
type Item = {
  id: string;
  title: string;
  poster: string;
  year: string;
  type_name?: string;
  remarks?: string;
};

export default function SourceBrowserPage() {
  const router = useRouter();

  const [sources, setSources] = useState<Source[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [activeSourceKey, setActiveSourceKey] = useState('');
  const activeSource = useMemo(
    () => sources.find((s) => s.key === activeSourceKey),
    [sources, activeSourceKey]
  );

  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | number>('');

  const [items, setItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const hasMore = page < pageCount;
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const lastFetchAtRef = useRef(0);
  const autoFillInProgressRef = useRef(false);

  // 详情预览状态
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<GlobalSearchResult | null>(null);
  const [previewItem, setPreviewItem] = useState<Item | null>(null);

  // ================= 导航滚动控制 =================
  const sourceScrollRef = useRef<HTMLDivElement>(null);
  const categoryScrollRef = useRef<HTMLDivElement>(null);

  const [canScrollSource, setCanScrollSource] = useState({ left: false, right: true });
  const [canScrollCategory, setCanScrollCategory] = useState({ left: false, right: true });

  const checkScroll = (
    ref: React.RefObject<HTMLDivElement>,
    setter: React.Dispatch<React.SetStateAction<{ left: boolean; right: boolean }>>
  ) => {
    if (ref.current) {
      const { scrollLeft, scrollWidth, clientWidth } = ref.current;
      setter({
        left: scrollLeft > 0,
        right: Math.ceil(scrollLeft + clientWidth) < scrollWidth - 2,
      });
    }
  };

  const handleScroll = (ref: React.RefObject<HTMLDivElement>, direction: 'left' | 'right') => {
    if (ref.current) {
      const amount = direction === 'left' ? -350 : 350;
      ref.current.scrollBy({ left: amount, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    checkScroll(sourceScrollRef, setCanScrollSource);
  }, [sources]);

  useEffect(() => {
    checkScroll(categoryScrollRef, setCanScrollCategory);
  }, [categories]);

  // ================= 获取数据逻辑 =================

  const handleSourceChange = (key: string) => {
    setActiveSourceKey(key);
    if (typeof window !== 'undefined') {
      localStorage.setItem('last_active_source', key);
    }
  };

  const fetchSources = useCallback(async () => {
    setLoadingSources(true);
    setSourceError(null);
    try {
      const res = await fetch('/api/source-browser/sites', { cache: 'no-store' });
      if (res.status === 401) throw new Error('登录状态已失效，请重新登录');
      if (res.status === 403) throw new Error('当前账号暂无可用资源站点');
      if (!res.ok) throw new Error('获取源失败');
      const data = await res.json();
      const list: Source[] = data.sources || [];
      setSources(list);
      
      if (list.length > 0) {
        const savedSource = typeof window !== 'undefined' ? localStorage.getItem('last_active_source') : null;
        const defaultPreferredKey = 'aiqiyi'; 

        if (savedSource && list.some((s) => s.key === savedSource)) {
          setActiveSourceKey(savedSource);
        } else if (list.some((s) => s.key === defaultPreferredKey)) {
          setActiveSourceKey(defaultPreferredKey);
        } else {
          setActiveSourceKey(list[0].key);
        }
      }
    } catch (e: unknown) {
      setSourceError(e instanceof Error ? e.message : '获取源失败');
    } finally {
      setLoadingSources(false);
    }
  }, []);

  const fetchCategories = useCallback(async (sourceKey: string) => {
    if (!sourceKey) return;
    setLoadingCategories(true);
    setCategoryError(null);
    try {
      const res = await fetch(`/api/source-browser/categories?source=${encodeURIComponent(sourceKey)}`);
      if (!res.ok) throw new Error('获取分类失败');
      const data = await res.json();
      const list: Category[] = data.categories || [];
      setCategories(list);
      if (list.length > 0) {
        setActiveCategory(list[0].type_id);
      } else {
        setActiveCategory('');
      }
    } catch (e: unknown) {
      setCategoryError(e instanceof Error ? e.message : '获取分类失败');
      setCategories([]);
      setActiveCategory('');
    } finally {
      setLoadingCategories(false);
    }
  }, []);

  const fetchItems = useCallback(
    async (sourceKey: string, typeId: string | number, p = 1, append = false) => {
      if (!sourceKey || !typeId) return;
      if (append) setLoadingMore(true);
      else setLoadingItems(true);
      setItemsError(null);
      try {
        const res = await fetch(
          `/api/source-browser/list?source=${encodeURIComponent(sourceKey)}&type_id=${encodeURIComponent(String(typeId))}&page=${p}`
        );
        if (!res.ok) throw new Error('获取列表失败');
        const data = (await res.json()) as {
          items?: Item[];
          meta?: { page?: number; pagecount?: number };
        };
        const list: Item[] = data.items || [];
        setItems((prev) => (append ? [...prev, ...list] : list));
        setPage(Number(data.meta?.page || p));
        setPageCount(Number(data.meta?.pagecount || 1));
      } catch (e: unknown) {
        setItemsError(e instanceof Error ? e.message : '获取列表失败');
        if (!append) setItems([]);
        setPage(1);
        setPageCount(1);
      } finally {
        if (append) setLoadingMore(false);
        else setLoadingItems(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  useEffect(() => {
    if (activeSourceKey) fetchCategories(activeSourceKey);
  }, [activeSourceKey, fetchCategories]);

  useEffect(() => {
    if (activeSourceKey && activeCategory) {
      setItems([]);
      setPage(1);
      setPageCount(1);
      fetchItems(activeSourceKey, activeCategory, 1, false);
    }
  }, [activeSourceKey, activeCategory, fetchItems]);

  // ================= 滚动与自动翻页 =================

  useEffect(() => {
    if (!loadMoreRef.current) return;
    const el = loadMoreRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          const now = Date.now();
          const intervalOk = now - lastFetchAtRef.current > 700;
          if (!loadingItems && !loadingMore && hasMore && activeSourceKey && intervalOk) {
            lastFetchAtRef.current = now;
            const next = page + 1;
            if (activeCategory) {
              fetchItems(activeSourceKey, activeCategory, next, true);
            }
          }
        }
      },
      { root: null, rootMargin: '200px', threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadingItems, loadingMore, hasMore, page, activeSourceKey, activeCategory, fetchItems]);

  useEffect(() => {
    const tryAutoFill = async () => {
      if (autoFillInProgressRef.current) return;
      if (!loadMoreRef.current) return;
      if (loadingItems || loadingMore || !hasMore) return;
      const sentinel = loadMoreRef.current.getBoundingClientRect();
      const inViewport = sentinel.top <= window.innerHeight + 100;
      if (!inViewport) return;

      autoFillInProgressRef.current = true;
      try {
        let iterations = 0;
        while (iterations < 5) {
          if (!hasMore) break;
          const now = Date.now();
          if (now - lastFetchAtRef.current <= 400) break;
          lastFetchAtRef.current = now;
          const next = page + iterations + 1;
          
          if (activeCategory) {
            await fetchItems(activeSourceKey, activeCategory, next, true);
          } else {
            break;
          }
          iterations++;

          if (!loadMoreRef.current) break;
          const rect = loadMoreRef.current.getBoundingClientRect();
          if (rect.top > window.innerHeight + 100) break;
        }
      } finally {
        autoFillInProgressRef.current = false;
      }
    };

    const id = setTimeout(tryAutoFill, 50);
    return () => clearTimeout(id);
  }, [items, page, pageCount, hasMore, loadingItems, loadingMore, activeSourceKey, activeCategory, fetchItems]);

  // ================= 详情预览相关 =================

  const openPreview = async (item: Item) => {
    setPreviewItem(item);
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewData(null);

    try {
      const res = await fetch(`/api/detail?source=${encodeURIComponent(activeSourceKey)}&id=${encodeURIComponent(item.id)}`);
      if (!res.ok) throw new Error('获取详情失败');
      const data = (await res.json()) as GlobalSearchResult;
      setPreviewData(data);
    } catch (e: unknown) {
      setPreviewError(e instanceof Error ? e.message : '获取详情失败');
    } finally {
      setPreviewLoading(false);
    }
  };

  const goPlay = (item: Item) => {
    const params = new URLSearchParams();
    params.set('source', activeSourceKey);
    params.set('id', item.id);
    const mergedTitle = (previewData?.title || item.title || '').toString();
    const mergedYear = (previewData?.year || item.year || '').toString();
    if (mergedTitle) params.set('title', mergedTitle);
    if (mergedYear) params.set('year', mergedYear);
    params.set('prefer', 'true');
    router.push(`/play?${params.toString()}`);
  };

  return (
    <PageLayout activePath='/source-browser'>
      <div className='flex flex-col min-h-screen pb-10 bg-gray-50 dark:bg-[#0a0a0a] transition-colors'>
        
        {/* 吸顶导航栏：源站与分类选择 */}
        <div className='sticky top-0 z-40 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200 dark:border-gray-800 transition-colors'>
          <div className='max-w-7xl mx-auto px-4 py-3 space-y-3'>
            
            {/* 1. 源站选择 */}
            <div className='flex items-center gap-2'>
              <div className='shrink-0 p-1.5 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg mr-1'>
                <Server className='w-4 h-4 text-emerald-500' />
              </div>
              
              <div className='relative flex-1 min-w-0'>
                {canScrollSource.left && (
                  <div className='absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-white dark:from-gray-900 to-transparent z-10 flex items-center justify-start pointer-events-none'>
                    <button
                      onClick={() => handleScroll(sourceScrollRef, 'left')}
                      className='pointer-events-auto w-6 h-6 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm text-gray-500 hover:text-emerald-500 transition-colors'
                    >
                      <ChevronLeft className='w-4 h-4' />
                    </button>
                  </div>
                )}

                <div 
                  ref={sourceScrollRef}
                  onScroll={() => checkScroll(sourceScrollRef, setCanScrollSource)}
                  className='flex items-center gap-2.5 overflow-x-auto scrollbar-hide scroll-smooth px-1 py-1'
                >
                  {loadingSources ? (
                    <span className='text-xs text-gray-500'>加载源站中...</span>
                  ) : sources.length === 0 ? (
                    <span className='text-xs text-gray-500'>{sourceError || '暂无可用源'}</span>
                  ) : (
                    sources.map((s) => (
                      <button
                        key={s.key}
                        onClick={() => handleSourceChange(s.key)}
                        className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                          activeSourceKey === s.key
                            ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                        }`}
                      >
                        {s.name}
                      </button>
                    ))
                  )}
                </div>

                {canScrollSource.right && sources.length > 0 && (
                  <div className='absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-white dark:from-gray-900 to-transparent z-10 flex items-center justify-end pointer-events-none'>
                    <button
                      onClick={() => handleScroll(sourceScrollRef, 'right')}
                      className='pointer-events-auto w-6 h-6 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm text-gray-500 hover:text-emerald-500 transition-colors'
                    >
                      <ChevronRight className='w-4 h-4' />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 2. 分类选择 */}
            {activeSourceKey && (
              <div className='flex items-center gap-2'>
                <div className='shrink-0 p-1.5 bg-blue-50 dark:bg-blue-900/30 rounded-lg mr-1'>
                  <Tv className='w-4 h-4 text-blue-500' />
                </div>
                
                <div className='relative flex-1 min-w-0'>
                  {canScrollCategory.left && (
                    <div className='absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-white dark:from-gray-900 to-transparent z-10 flex items-center justify-start pointer-events-none'>
                      <button
                        onClick={() => handleScroll(categoryScrollRef, 'left')}
                        className='pointer-events-auto w-6 h-6 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm text-gray-500 hover:text-blue-500 transition-colors'
                      >
                        <ChevronLeft className='w-4 h-4' />
                      </button>
                    </div>
                  )}

                  <div 
                    ref={categoryScrollRef}
                    onScroll={() => checkScroll(categoryScrollRef, setCanScrollCategory)}
                    className='flex items-center gap-2.5 overflow-x-auto scrollbar-hide scroll-smooth px-1 py-1'
                  >
                    {loadingCategories ? (
                      <span className='text-xs text-gray-500'>加载分类中...</span>
                    ) : categories.length === 0 ? (
                      <span className='text-xs text-gray-500'>{categoryError || '暂无分类'}</span>
                    ) : (
                      categories.map((c) => (
                        <button
                          key={String(c.type_id)}
                          onClick={() => setActiveCategory(c.type_id)}
                          className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                            activeCategory === c.type_id
                              ? 'bg-blue-500 text-white shadow-md shadow-blue-500/20'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                          }`}
                        >
                          {c.type_name}
                        </button>
                      ))
                    )}
                  </div>

                  {canScrollCategory.right && categories.length > 0 && (
                    <div className='absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-white dark:from-gray-900 to-transparent z-10 flex items-center justify-end pointer-events-none'>
                      <button
                        onClick={() => handleScroll(categoryScrollRef, 'right')}
                        className='pointer-events-auto w-6 h-6 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm text-gray-500 hover:text-blue-500 transition-colors'
                      >
                        <ChevronRight className='w-4 h-4' />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 视频列表网格 */}
        <div className='max-w-7xl mx-auto w-full px-4 pt-6'>
          {loadingItems && items.length === 0 ? (
            <div className='flex justify-center items-center py-20'>
              <div className='w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin'></div>
            </div>
          ) : itemsError && items.length === 0 ? (
            <div className='text-center py-20 text-red-500 text-sm'>{itemsError}</div>
          ) : items.length === 0 ? (
            <div className='text-center py-20 text-gray-400 text-sm'>暂无内容</div>
          ) : (
            <div className='grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3 sm:gap-4'>
              {items.map((item) => (
                <div
                  key={item.id}
                  onClick={() => openPreview(item)}
                  className='group flex flex-col cursor-pointer'
                >
                  {/* 海报卡片 */}
                  <div className='relative aspect-[3/4] w-full rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-800 shadow-sm transition-all duration-300 group-hover:shadow-xl group-hover:scale-[1.03] group-hover:ring-2 group-hover:ring-blue-500/50'>
                    {item.poster ? (
                      <img
                        src={item.poster}
                        alt={item.title}
                        className='w-full h-full object-cover'
                        loading='lazy'
                      />
                    ) : (
                      <div className='w-full h-full flex items-center justify-center text-gray-400'>
                        <Tv className='w-8 h-8 opacity-20' />
                      </div>
                    )}
                    
                    {/* 悬浮黑色蒙层与播放按钮 */}
                    <div className='absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center'>
                      <Play className='text-white w-10 h-10 drop-shadow-lg transform scale-90 group-hover:scale-100 transition-transform' />
                    </div>

                    {/* 右下角信息标签 (年份或更新备注) */}
                    {(item.remarks || item.year) && (
                      <div className='absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-md text-[10px] text-white font-medium'>
                        {item.remarks || item.year}
                      </div>
                    )}
                  </div>

                  {/* 标题 */}
                  <div className='mt-2 text-xs sm:text-sm font-medium text-gray-800 dark:text-gray-200 truncate group-hover:text-blue-500 transition-colors'>
                    {item.title}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 无限滚动触发器 */}
          <div ref={loadMoreRef} className='mt-8 flex items-center justify-center py-4'>
            {loadingMore ? (
              <div className='w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin'></div>
            ) : hasMore && items.length > 0 ? (
              <div className='text-xs text-gray-400'>向下滚动加载更多</div>
            ) : items.length > 0 ? (
              <div className='text-xs text-gray-400'>没有更多了</div>
            ) : null}
          </div>
        </div>

        {/* 详情预览弹窗 */}
        {previewOpen && (
          <div
            className='fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-3 py-6 sm:p-4 animate-in fade-in duration-200'
            role='dialog'
            onClick={() => setPreviewOpen(false)}
          >
            <div
              className='w-full max-w-4xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] border border-gray-200 dark:border-gray-800 animate-in zoom-in-95 duration-200'
              onClick={(e) => e.stopPropagation()}
            >
              {/* 弹窗头部 */}
              <div className='flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800'>
                <div className='font-bold text-lg text-gray-900 dark:text-white truncate pr-4'>
                  {previewItem?.title || '详情'}
                </div>
                <button
                  className='shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors'
                  onClick={() => setPreviewOpen(false)}
                >
                  <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                    <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M6 18L18 6M6 6l12 12' />
                  </svg>
                </button>
              </div>
              
              {/* 弹窗内容 */}
              <div className='p-5 overflow-y-auto flex-1'>
                {previewLoading ? (
                  <div className='flex flex-col items-center justify-center py-12'>
                    <div className='w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4'></div>
                  </div>
                ) : previewError ? (
                  <div className='text-sm text-red-500 py-4 text-center'>{previewError}</div>
                ) : !previewData ? (
                  <div className='text-sm text-gray-500 py-4 text-center'>暂无详情</div>
                ) : (
                  <div className='flex flex-col md:flex-row gap-5'>
                    {/* 封面 */}
                    <div className='shrink-0 w-32 md:w-48 mx-auto md:mx-0'>
                      <div className='aspect-[3/4] rounded-lg bg-gray-100 dark:bg-gray-800 overflow-hidden shadow-md border border-gray-200 dark:border-gray-700'>
                        {previewItem?.poster ? (
                          <img src={previewItem.poster} alt={previewItem.title} className='w-full h-full object-cover' />
                        ) : (
                          <div className='w-full h-full flex items-center justify-center'><Tv className='w-8 h-8 text-gray-400 opacity-30' /></div>
                        )}
                      </div>
                    </div>
                    
                    {/* 信息区 */}
                    <div className='flex-1 space-y-3 min-w-0'>
                      {/* 标题 */}
                      <div className='flex items-center gap-2 flex-wrap'>
                        <h2 className='text-xl font-bold text-gray-900 dark:text-white'>
                          {previewData.title || previewItem?.title}
                        </h2>
                      </div>

                      {/* 基础信息 */}
                      <div className='text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-4 gap-y-1'>
                        <span>年份：{previewData.year || previewItem?.year || '未知'}</span>
                        <span>分类：{previewItem?.type_name || previewData.class || '未知'}</span>
                        <span>来源：{activeSource?.name}</span>
                      </div>

                      {/* 简介 */}
                      {(() => {
                        const desc = (previewData?.desc?.trim()) || (previewItem?.remarks?.trim());
                        return desc ? (
                          <div className='text-xs sm:text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg leading-relaxed max-h-32 overflow-y-auto whitespace-pre-line border border-gray-100 dark:border-gray-800'>
                            {desc}
                          </div>
                        ) : null;
                      })()}

                    </div>
                  </div>
                )}
              </div>

              {/* 弹窗底部操作 */}
              <div className='px-5 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30 flex justify-end gap-3'>
                <button
                  onClick={() => setPreviewOpen(false)}
                  className='px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors'
                >
                  关闭
                </button>
                <button
                  onClick={() => previewItem && goPlay(previewItem)}
                  className='flex items-center gap-1.5 px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors shadow-sm'
                >
                  <Play className='w-4 h-4 fill-current' />
                  播放
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </PageLayout>
  );
}