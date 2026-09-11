/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useState, Suspense } from 'react';
import { Calendar, Filter, Search, Clock, Film, Tv, MapPin, Tag, ChevronUp, LayoutGrid, CalendarDays, GitCommit } from 'lucide-react';

import { ReleaseCalendarItem, ReleaseCalendarResult } from '@/lib/types';
import PageLayout from '@/components/PageLayout';

function ReleaseCalendarClient() {
  const [data, setData] = useState<ReleaseCalendarResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 过滤状态
  const [filters, setFilters] = useState({
    type: '' as 'movie' | 'tv' | '',
    region: '',
    genre: '',
    dateFrom: '',
    dateTo: '',
    search: '',
  });

  // 分页状态
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30; // 增加每页数量以适应海报视图

  // 视图模式
  const [viewMode, setViewMode] = useState<'grid' | 'timeline' | 'calendar'>('grid');
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [currentCalendarDate, setCurrentCalendarDate] = useState(new Date());
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  const toggleDateExpanded = (dateStr: string) => {
    setExpandedDates(prev => {
      const newSet = new Set(prev);
      if (newSet.has(dateStr)) newSet.delete(dateStr);
      else newSet.add(dateStr);
      return newSet;
    });
  };

  const cleanExpiredCache = () => {
    const CACHE_DURATION = 2 * 60 * 60 * 1000;
    const now = Date.now();
    const cacheTimeKey = 'release_calendar_all_data_time';
    const cachedTime = localStorage.getItem(cacheTimeKey);

    if (cachedTime && now - parseInt(cachedTime) >= CACHE_DURATION) {
      localStorage.removeItem('release_calendar_all_data');
      localStorage.removeItem(cacheTimeKey);
    }
  };

  const fetchData = async (reset = false) => {
    try {
      setLoading(true);
      setError(null);
      cleanExpiredCache();

      const apiUrl = reset ? '/api/release-calendar?refresh=true' : '/api/release-calendar';
      const response = await fetch(apiUrl);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `请求失败，状态码: ${response.status}`);
      }

      const result: ReleaseCalendarResult = await response.json();
      const filteredData = applyClientSideFilters(result);
      setData(filteredData);
      setCurrentPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  };

  const applyClientSideFilters = (data: ReleaseCalendarResult): ReleaseCalendarResult => {
    return applyClientSideFiltersWithParams(data, filters);
  };

  const applyClientSideFiltersWithParams = (data: ReleaseCalendarResult, filterParams: typeof filters): ReleaseCalendarResult => {
    let filteredItems = [...data.items];

    if (filterParams.type) filteredItems = filteredItems.filter(item => item.type === filterParams.type);
    if (filterParams.region && filterParams.region !== '全部') filteredItems = filteredItems.filter(item => item.region.includes(filterParams.region!));
    if (filterParams.genre && filterParams.genre !== '全部') filteredItems = filteredItems.filter(item => item.genre.includes(filterParams.genre!));
    if (filterParams.dateFrom) filteredItems = filteredItems.filter(item => item.releaseDate >= filterParams.dateFrom!);
    if (filterParams.dateTo) filteredItems = filteredItems.filter(item => item.releaseDate <= filterParams.dateTo!);
    if (filterParams.search) {
      const q = filterParams.search.toLowerCase();
      filteredItems = filteredItems.filter(item =>
        item.title.toLowerCase().includes(q) ||
        item.director.toLowerCase().includes(q) ||
        item.actors.toLowerCase().includes(q)
      );
    }

    return { ...data, items: filteredItems, total: filteredItems.length, hasMore: false };
  };

  const applyFilters = () => {
    setCurrentPage(1);
    fetchData(false);
  };

  const handleRefreshClick = async () => {
    try {
      localStorage.removeItem('release_calendar_all_data');
      localStorage.removeItem('release_calendar_all_data_time');
      await fetchData(true);
    } catch (error) {
      // Ignore
    }
  };

  const resetFilters = () => {
    const resetState = { type: '' as const, region: '', genre: '', dateFrom: '', dateTo: '', search: '' };
    setFilters(resetState);
    setCurrentPage(1);
    const cachedData = localStorage.getItem('release_calendar_all_data');
    if (cachedData) {
      setData(applyClientSideFiltersWithParams(JSON.parse(cachedData), resetState));
    } else {
      fetchData(false);
    }
  };

  const totalItems = data?.items.length || 0;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const currentItems = data?.items.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage) || [];

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    const handleScroll = () => setShowBackToTop((document.body.scrollTop || document.documentElement.scrollTop) > 300);
    document.body.addEventListener('scroll', handleScroll, { passive: true });
    return () => document.body.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    try { document.body.scrollTo({ top: 0, behavior: 'smooth' }); } 
    catch (e) { document.body.scrollTop = 0; document.documentElement.scrollTop = 0; }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const getTypeIcon = (type: 'movie' | 'tv' | string) => type === 'movie' ? <Film className="w-4 h-4" /> : <Tv className="w-4 h-4" />;
  const getTypeLabel = (type: 'movie' | 'tv' | string) => type === 'movie' ? '电影' : type === 'tv' ? '电视剧' : '未知';

  return (
    <PageLayout activePath="/release-calendar">
      <div className="flex flex-col min-h-screen pb-10 bg-gray-50 dark:bg-[#0a0a0a] transition-colors">
        
        {/* 吸顶导航栏 & 过滤器 (Glassmorphism) */}
        <div className="sticky top-0 z-40 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200 dark:border-gray-800 transition-colors">
          <div className="max-w-7xl mx-auto px-4 py-3">
            
            {/* 顶部标题与视图切换 */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                  <Calendar className="w-5 h-5 text-blue-500" />
                </div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">上映日程</h1>
                {data && (
                  <span className="px-2 py-0.5 ml-2 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full">
                    {data.total} 部作品
                  </span>
                )}
              </div>

              {/* 视图切换按钮 */}
              <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                {[
                  { id: 'grid', icon: LayoutGrid, label: '网格' },
                  { id: 'timeline', icon: GitCommit, label: '时间线' },
                  { id: 'calendar', icon: CalendarDays, label: '日历' }
                ].map(view => (
                  <button
                    key={view.id}
                    onClick={() => setViewMode(view.id as any)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      viewMode === view.id
                        ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                        : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                    }`}
                  >
                    <view.icon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{view.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 过滤器胶囊列表 (可横向滚动) */}
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
              <div className="relative shrink-0">
                <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400 w-3.5 h-3.5" />
                <input
                  type="text"
                  placeholder="搜索名称或演员..."
                  value={filters.search}
                  onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                  className="pl-8 pr-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 border-transparent focus:border-blue-500 focus:bg-white dark:focus:bg-gray-900 rounded-full text-gray-900 dark:text-white placeholder-gray-500 transition-all w-40 sm:w-48 outline-none ring-0"
                />
              </div>

              <select
                value={filters.type}
                onChange={(e) => setFilters(prev => ({ ...prev, type: e.target.value as any }))}
                className="shrink-0 px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-full border-none focus:ring-2 focus:ring-blue-500 outline-none appearance-none cursor-pointer"
              >
                <option value="">全部类型</option>
                {data?.filters.types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>

              <select
                value={filters.region}
                onChange={(e) => setFilters(prev => ({ ...prev, region: e.target.value }))}
                className="shrink-0 px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-full border-none focus:ring-2 focus:ring-blue-500 outline-none appearance-none cursor-pointer"
              >
                <option value="">全球地区</option>
                {data?.filters.regions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>

              <div className="shrink-0 flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-full px-2 py-1">
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                  className="text-xs bg-transparent border-none text-gray-700 dark:text-gray-300 focus:ring-0 outline-none p-0.5 cursor-pointer w-[105px]"
                />
                <span className="text-gray-400 text-xs">-</span>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
                  className="text-xs bg-transparent border-none text-gray-700 dark:text-gray-300 focus:ring-0 outline-none p-0.5 cursor-pointer w-[105px]"
                />
              </div>

              <div className="shrink-0 flex items-center gap-1.5 ml-auto pl-2 border-l border-gray-200 dark:border-gray-700">
                <button onClick={applyFilters} className="p-1.5 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors shadow-sm shadow-blue-500/30" title="应用过滤">
                  <Filter className="w-3.5 h-3.5" />
                </button>
                <button onClick={handleRefreshClick} className={`p-1.5 bg-green-500 text-white rounded-full hover:bg-green-600 transition-colors shadow-sm shadow-green-500/30 ${loading ? 'animate-spin' : ''}`} title="强制刷新">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 内容区域 */}
        <div className="max-w-7xl mx-auto w-full px-4 pt-6">
          {loading && !data ? (
            <div className="flex justify-center items-center py-32">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : error ? (
            <div className="text-center py-20 text-red-500 text-sm bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-100 dark:border-red-900/50">
              <p>获取数据失败</p>
              <p className="mt-1 text-xs opacity-70">{error}</p>
            </div>
          ) : (
            <>
              {/* 1. 海报优先的网格视图 (Grid View) */}
              {viewMode === 'grid' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {currentItems.filter((item, i, self) => i === self.findIndex(t => t.title === item.title)).map((item) => {
                    const isToday = item.releaseDate === new Date().toISOString().split('T')[0];
                    return (
                      <div key={item.id} className="group relative aspect-[2/3] w-full rounded-xl overflow-hidden bg-gray-200 dark:bg-gray-800 shadow-sm transition-all duration-300 hover:shadow-2xl hover:scale-[1.03] hover:ring-2 hover:ring-blue-500/50 cursor-pointer">
                        {/* 海报图片 */}
                        {item.poster ? (
                          <img src={item.poster} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 bg-gradient-to-br from-gray-100 to-gray-300 dark:from-gray-800 dark:to-gray-900 p-4 text-center">
                            {getTypeIcon(item.type)}
                            <span className="mt-2 text-xs font-medium text-gray-500 line-clamp-2">{item.title}</span>
                          </div>
                        )}
                        
                        {/* 顶部状态标签 */}
                        {isToday && (
                          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-red-600/90 backdrop-blur-md text-[10px] text-white font-bold tracking-wider shadow-lg">
                            TODAY
                          </div>
                        )}

                        {/* 底部渐变遮罩 & 信息展示 */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3">
                          <h3 className="text-white font-bold text-sm line-clamp-2 mb-1 drop-shadow-md">
                            {item.title}
                          </h3>
                          <div className="flex items-center gap-1.5 text-gray-300 text-[10px] mb-2 font-medium">
                            <span className="px-1 py-0.5 rounded-sm bg-white/20">{getTypeLabel(item.type)}</span>
                            <span className="px-1 py-0.5 rounded-sm bg-white/20 flex items-center gap-0.5"><Clock className="w-2.5 h-2.5"/>{formatDate(item.releaseDate)}</span>
                          </div>
                          <p className="text-gray-400 text-[10px] line-clamp-2 leading-tight">
                            {item.director !== '暂无评分' && item.director !== '未知' ? item.director : item.actors}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 2. 苹果风时间线视图 (Timeline View) */}
              {viewMode === 'timeline' && (
                <div className="max-w-4xl mx-auto relative pt-4 pb-8">
                  {/* 发光主轴线 */}
                  <div className="absolute left-[27px] md:left-1/2 top-0 bottom-0 w-0.5 bg-gradient-to-b from-blue-500/20 via-purple-500/20 to-pink-500/20 dark:from-blue-500/50 dark:via-purple-500/50 dark:to-pink-500/50 rounded-full"></div>

                  <div className="space-y-12">
                    {Object.entries((data?.items || []).reduce((acc, item) => {
                      if (!acc[item.releaseDate]) acc[item.releaseDate] = [];
                      acc[item.releaseDate].push(item);
                      return acc;
                    }, {} as Record<string, ReleaseCalendarItem[]>)).sort(([a], [b]) => a.localeCompare(b)).map(([date, items], index) => {
                      const todayStr = new Date().toISOString().split('T')[0];
                      const isToday = date === todayStr;
                      const uniqueItems = items.filter((item, i, self) => i === self.findIndex(t => t.title === item.title));

                      return (
                        <div key={date} className="relative flex flex-col md:flex-row items-start justify-between group">
                          
                          {/* 时间线中心发光圆点 */}
                          <div className="absolute left-7 md:left-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-[3px] border-white dark:border-gray-900 shadow-sm z-10 flex items-center justify-center transition-all group-hover:scale-125
                            ${isToday ? 'bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.6)] animate-pulse' : 'bg-gray-300 dark:bg-gray-600'}">
                          </div>

                          {/* 左侧：日期 (PC端) */}
                          <div className="hidden md:flex w-[calc(50%-2rem)] flex-col items-end pr-4 mt-[-4px]">
                            <span className={`text-lg font-bold ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'}`}>
                              {formatDate(date)}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-500 font-medium">
                              {uniqueItems.length} 部作品
                            </span>
                          </div>

                          {/* 移动端日期头部 */}
                          <div className="md:hidden pl-16 mb-3 mt-[-4px] w-full">
                            <span className={`text-lg font-bold ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'}`}>
                              {formatDate(date)}
                            </span>
                          </div>

                          {/* 右侧/下方：内容卡片 */}
                          <div className="w-full md:w-[calc(50%-2rem)] pl-16 md:pl-4 space-y-3">
                            {uniqueItems.map((item, i) => (
                              <div key={`${item.id}-${i}`} className="flex gap-3 p-3 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800/60 hover:shadow-md transition-shadow">
                                {item.poster ? (
                                  <img src={item.poster} alt={item.title} className="w-12 h-16 object-cover rounded-md shadow-sm shrink-0" loading="lazy" />
                                ) : (
                                  <div className="w-12 h-16 bg-gray-100 dark:bg-gray-700 rounded-md flex items-center justify-center text-gray-400 shrink-0">
                                    {getTypeIcon(item.type)}
                                  </div>
                                )}
                                <div className="flex-1 min-w-0 py-0.5">
                                  <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate group-hover:text-blue-500 transition-colors">
                                    {item.title}
                                  </h4>
                                  <div className="flex items-center gap-1.5 mt-1">
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{getTypeLabel(item.type)}</span>
                                    <span className="text-[10px] text-gray-500 truncate">{item.genre}</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 3. 现代化日历视图 (Calendar View) */}
              {viewMode === 'calendar' && (
                <div className="bg-white dark:bg-gray-900/50 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800/60 p-4 sm:p-6">
                  {/* 月份导航 */}
                  <div className="flex items-center justify-between mb-6">
                    <button onClick={() => setCurrentCalendarDate(new Date(currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1)))} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors">
                      <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                    </button>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">
                      {currentCalendarDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })}
                    </h3>
                    <button onClick={() => setCurrentCalendarDate(new Date(currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1)))} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors">
                      <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                    </button>
                  </div>

                  {/* 星期 Header */}
                  <div className="grid grid-cols-7 gap-1 mb-2">
                    {['日', '一', '二', '三', '四', '五', '六'].map(day => (
                      <div key={day} className="text-center text-xs font-semibold text-gray-400 dark:text-gray-500 py-2">
                        {day}
                      </div>
                    ))}
                  </div>

                  {/* 日历格子 */}
                  <div className="grid grid-cols-7 gap-1 sm:gap-2">
                    {(() => {
                      const todayStr = new Date().toISOString().split('T')[0];
                      const currentMonth = currentCalendarDate.getMonth();
                      const startDate = new Date(currentCalendarDate.getFullYear(), currentMonth, 1);
                      startDate.setDate(startDate.getDate() - startDate.getDay());

                      const days = [];
                      const current = new Date(startDate);
                      const allItems = data?.items || [];

                      for (let i = 0; i < 42; i++) {
                        const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
                        const isCurrentMonth = current.getMonth() === currentMonth;
                        const isToday = dateStr === todayStr;
                        const dayItems = allItems.filter(item => item.releaseDate === dateStr).filter((item, index, self) => index === self.findIndex(t => t.title === item.title));

                        days.push(
                          <div key={dateStr} className={`min-h-[80px] sm:min-h-[100px] p-1.5 sm:p-2 rounded-xl border ${
                            isToday ? 'border-blue-500/50 bg-blue-50/50 dark:bg-blue-900/10 shadow-[0_0_10px_rgba(59,130,246,0.1)]' 
                            : isCurrentMonth ? 'border-gray-100 dark:border-gray-800/60 bg-transparent hover:bg-gray-50 dark:hover:bg-gray-800/50' 
                            : 'border-transparent opacity-40'
                          } transition-colors flex flex-col`}>
                            
                            <span className={`text-[10px] sm:text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1 ${
                              isToday ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-700 dark:text-gray-300'
                            }`}>
                              {current.getDate()}
                            </span>

                            <div className="flex-1 space-y-1 overflow-hidden">
                              {(expandedDates.has(dateStr) ? dayItems : dayItems.slice(0, 2)).map((item, idx) => (
                                <div key={idx} className={`text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded truncate ${
                                  item.type === 'movie' ? 'bg-amber-100/70 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-purple-100/70 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
                                }`}>
                                  {item.title}
                                </div>
                              ))}
                              {dayItems.length > 2 && (
                                <button onClick={() => toggleDateExpanded(dateStr)} className="text-[9px] text-gray-500 hover:text-blue-500 w-full text-left pl-1">
                                  {expandedDates.has(dateStr) ? '收起' : `+${dayItems.length - 2} 更多`}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                        current.setDate(current.getDate() + 1);
                      }
                      return days;
                    })()}
                  </div>
                </div>
              )}

              {/* 分页组件 (仅在 Grid 模式显示) */}
              {viewMode === 'grid' && totalPages > 1 && (
                <div className="flex justify-center items-center mt-10 space-x-3">
                  <button onClick={() => setCurrentPage(p => Math.max(p - 1, 1))} disabled={currentPage === 1} className="w-8 h-8 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-all shadow-sm">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    {currentPage} / {totalPages}
                  </span>
                  <button onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))} disabled={currentPage === totalPages} className="w-8 h-8 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-all shadow-sm">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* 缺省状态 */}
              {currentItems.length === 0 && (
                <div className="text-center py-20">
                  <Calendar className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-700 mb-3" />
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white">暂无排期数据</h3>
                  <p className="text-xs text-gray-500 mt-1">请尝试清除过滤条件</p>
                </div>
              )}
            </>
          )}

          {/* 悬浮返回顶部 */}
          {showBackToTop && (
            <button onClick={scrollToTop} className="fixed bottom-20 right-6 z-50 bg-white/80 dark:bg-gray-800/80 backdrop-blur-md text-gray-600 dark:text-gray-300 p-2.5 rounded-full shadow-lg border border-gray-200 dark:border-gray-700 hover:text-blue-500 transition-all duration-300 hover:-translate-y-1">
              <ChevronUp className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

// 补充缺失的 Lucide 图标依赖
const ChevronLeft = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m15 18-6-6 6-6"/></svg>;
const ChevronRight = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m9 18 6-6-6-6"/></svg>;

export default function ReleaseCalendarPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-[#0a0a0a]">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <ReleaseCalendarClient />
    </Suspense>
  );
}
