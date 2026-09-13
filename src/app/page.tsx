/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import { RefreshCw } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';

// 客户端收藏与播放记录 API
import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import ContinueWatching from '@/components/ContinueWatching';
import PageLayout from '@/components/PageLayout';
import { useSite } from '@/components/SiteProvider';
import VideoCard from '@/components/VideoCard';

function HomeClient() {
  const [activeTab, setActiveTab] = useState<'home' | 'favorites'>('home');
  const { announcement } = useSite();
  const [showAnnouncement, setShowAnnouncement] = useState(false);

  // 随机预览模块状态
  const [previewItems, setPreviewItems] = useState<any[]>([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 获取随机预览数据
  const fetchRandomPreview = async () => {
    setIsRefreshing(true);
    if (previewItems.length === 0) setIsPreviewLoading(true);
    
    try {
      const res = await fetch('/api/release-calendar');
      if (!res.ok) throw new Error('Network response was not ok');
      const data = await res.json();
      
      let items: any[] = [];
      // 兼容不同的数据结构返回形式
      if (Array.isArray(data)) {
        items = data;
      } else if (data.results && Array.isArray(data.results)) {
        items = data.results;
      } else if (data.data && Array.isArray(data.data)) {
        items = data.data;
      } else {
        // 如果是按日期分类的对象结构，将其全部提取展平为一维数组
        Object.values(data).forEach((val) => {
          if (Array.isArray(val)) {
            items = items.concat(val);
          }
        });
      }

      // 过滤出有效数据（必须有标题和封面图）
      let validItems = items.filter(
        (item) => item && item.title && (item.cover || item.poster || item.pic)
      );

      // 随机打乱数组顺序 (Fisher-Yates 洗牌简易版)
      validItems = validItems.sort(() => 0.5 - Math.random());

      // 截取前 12 个并在本地格式化为 VideoCard 所需的字段格式
      const selected = validItems.slice(0, 12).map((item) => ({
        id: item.id || item.douban_id || String(Math.random()),
        source: item.source || 'douban', // 若接口无 source，默认分配 fallback 防止报错
        title: item.title,
        poster: item.cover || item.poster || item.pic || '',
        year: item.year || '',
        episodes: item.episodes || item.total_episodes || 1,
        search_title: item.title,
        type: item.type || (item.episodes > 1 ? 'tv' : 'movie'),
      }));

      setPreviewItems(selected);
    } catch (error) {
      console.error('获取预览数据失败:', error);
    } finally {
      setIsPreviewLoading(false);
      setTimeout(() => setIsRefreshing(false), 500); // 让旋转动画多持续一会儿，提升体感
    }
  };

  // 页面初次加载时获取一次预览数据
  useEffect(() => {
    fetchRandomPreview();
  }, []);

  // 检查公告弹窗状态
  useEffect(() => {
    if (typeof window !== 'undefined' && announcement) {
      const hasSeenAnnouncement = localStorage.getItem('hasSeenAnnouncement');
      if (hasSeenAnnouncement !== announcement) {
        setShowAnnouncement(true);
      } else {
        setShowAnnouncement(Boolean(!hasSeenAnnouncement && announcement));
      }
    }
  }, [announcement]);

  // 收藏夹数据类型
  type FavoriteItem = {
    id: string;
    source: string;
    title: string;
    poster: string;
    episodes: number;
    source_name: string;
    currentEpisode?: number;
    search_title?: string;
  };

  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);

  // 处理收藏数据更新的函数
  const updateFavoriteItems = async (allFavorites: Record<string, any>) => {
    const allPlayRecords = await getAllPlayRecords();

    // 根据保存时间排序（从近到远）
    const sorted = Object.entries(allFavorites)
      .sort(([, a], [, b]) => b.save_time - a.save_time)
      .map(([key, fav]) => {
        const plusIndex = key.indexOf('+');
        const source = key.slice(0, plusIndex);
        const id = key.slice(plusIndex + 1);

        // 查找对应的播放记录，获取当前集数
        const playRecord = allPlayRecords[key];
        const currentEpisode = playRecord?.index;

        return {
          id,
          source,
          title: fav.title,
          year: fav.year,
          poster: fav.cover,
          episodes: fav.total_episodes,
          source_name: fav.source_name,
          currentEpisode,
          search_title: fav?.search_title,
        } as FavoriteItem;
      });
    setFavoriteItems(sorted);
  };

  // 当切换到收藏夹时加载收藏数据
  useEffect(() => {
    if (activeTab !== 'favorites') return;

    const loadFavorites = async () => {
      const allFavorites = await getAllFavorites();
      await updateFavoriteItems(allFavorites);
    };

    loadFavorites();

    // 监听收藏更新事件
    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, any>) => {
        updateFavoriteItems(newFavorites);
      }
    );

    return unsubscribe;
  }, [activeTab]);

  const handleCloseAnnouncement = (announcement: string) => {
    setShowAnnouncement(false);
    localStorage.setItem('hasSeenAnnouncement', announcement); // 记录已查看弹窗
  };

  return (
    <PageLayout>
      <div className='px-2 sm:px-10 py-4 sm:py-8 overflow-visible'>
        {/* 顶部 Tab 切换 */}
        <div className='mb-8 flex justify-center'>
          <CapsuleSwitch
            options={[
              { label: '首页', value: 'home' },
              { label: '收藏夹', value: 'favorites' },
            ]}
            active={activeTab}
            onChange={(value) => setActiveTab(value as 'home' | 'favorites')}
          />
        </div>

        <div className='max-w-[95%] mx-auto'>
          {activeTab === 'favorites' ? (
            // 收藏夹视图
            <section className='mb-8'>
              <div className='mb-4 flex items-center justify-between'>
                <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                  我的收藏
                </h2>
                {favoriteItems.length > 0 && (
                  <button
                    className='text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    onClick={async () => {
                      await clearAllFavorites();
                      setFavoriteItems([]);
                    }}
                  >
                    清空
                  </button>
                )}
              </div>
              <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
                {favoriteItems.map((item) => (
                  <div key={item.id + item.source} className='w-full'>
                    <VideoCard
                      query={item.search_title}
                      {...item}
                      from='favorite'
                      type={item.episodes > 1 ? 'tv' : ''}
                    />
                  </div>
                ))}
                {favoriteItems.length === 0 && (
                  <div className='col-span-full text-center text-gray-500 py-8 dark:text-gray-400'>
                    暂无收藏内容
                  </div>
                )}
              </div>
            </section>
          ) : (
            // 首页视图
            <>
              <ContinueWatching />

              {/* ===== 随机预览模块 ===== */}
              <section className='mt-8 sm:mt-12 mb-8'>
                <div className='mb-5 flex items-center justify-between px-1 sm:px-0'>
                  <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2.5'>
                    <span className="bg-gradient-to-b from-red-500 to-rose-600 w-1.5 h-5 rounded-full inline-block"></span>
                    近期热播推荐
                  </h2>
                  <button
                    onClick={fetchRandomPreview}
                    disabled={isRefreshing}
                    className='group flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800/60 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors text-sm text-gray-600 dark:text-gray-300 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-50'
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
                    换一换
                  </button>
                </div>

                {isPreviewLoading ? (
                  // 加载时的骨架屏 (Skeleton)
                  <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
                    {Array.from({ length: 12 }).map((_, i) => (
                      <div key={i} className="w-full animate-pulse">
                        <div className="w-full aspect-[2/3] bg-gray-200 dark:bg-gray-800 rounded-xl"></div>
                        <div className="mt-3 h-4 bg-gray-200 dark:bg-gray-800 rounded w-3/4"></div>
                        <div className="mt-2 h-3 bg-gray-200 dark:bg-gray-800 rounded w-1/2"></div>
                      </div>
                    ))}
                  </div>
                ) : (
                  // 加载完毕的视频卡片列表
                  <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
                    {previewItems.map((item, idx) => (
                      <div key={idx} className='w-full'>
                        <VideoCard
                          query={item.search_title}
                          id={item.id}
                          source={item.source}
                          title={item.title}
                          poster={item.poster}
                          year={item.year}
                          episodes={item.episodes}
                          from='home'
                          type={item.type}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
      
      {/* 公告弹窗 */}
      {announcement && showAnnouncement && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm dark:bg-black/70 p-4 transition-opacity duration-300 ${
            showAnnouncement ? '' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className='w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900 transform transition-all duration-300 hover:shadow-2xl'>
            <div className='flex justify-between items-start mb-4'>
              <h3 className='text-2xl font-bold tracking-tight text-gray-800 dark:text-white border-b border-green-500 pb-1'>
                提示
              </h3>
              <button
                onClick={() => handleCloseAnnouncement(announcement)}
                className='text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-white transition-colors'
                aria-label='关闭'
              ></button>
            </div>
            <div className='mb-6'>
              <div className='relative overflow-hidden rounded-lg mb-4 bg-green-50 dark:bg-green-900/20'>
                <div className='absolute inset-y-0 left-0 w-1.5 bg-green-500 dark:bg-green-400'></div>
                <p className='ml-4 text-gray-600 dark:text-gray-300 leading-relaxed'>
                  {announcement}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleCloseAnnouncement(announcement)}
              className='w-full rounded-lg bg-gradient-to-r from-green-600 to-green-700 px-4 py-3 text-white font-medium shadow-md hover:shadow-lg hover:from-green-700 hover:to-green-800 dark:from-green-600 dark:to-green-700 dark:hover:from-green-700 dark:hover:to-green-800 transition-all duration-300 transform hover:-translate-y-0.5'
            >
              我知道了
            </button>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeClient />
    </Suspense>
  );
}
