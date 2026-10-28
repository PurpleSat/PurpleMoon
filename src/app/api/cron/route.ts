/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { fetchVideoDetail } from '@/lib/fetchVideoDetail';
import { timingSafeEqual } from '@/lib/password';
import { SearchResult } from '@/lib/types';
import { parseRecordKey } from '@/lib/validation';

export const runtime = 'edge';

// 软截止时间（24秒），确保在 Serverless / Edge / 容器 30 秒超时限制前安全退出并返回成功状态
const CRON_SOFT_DEADLINE_MS = 24000;
const CRON_DETAIL_CONCURRENCY = 4;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('拦截：服务器未配置 CRON_SECRET 环境变量，出于安全考虑拒绝执行批量刷新任务。');
    return NextResponse.json({ error: 'Unauthorized: CRON_SECRET is not configured' }, { status: 401 });
  }

  if (!authHeader || !timingSafeEqual(authHeader, `Bearer ${cronSecret}`)) {
    console.warn(`拦截：检测到伪造的 Cron 触发请求！`);
    return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
  }

  try {
    console.log('Cron job triggered:', new Date().toISOString());

    await refreshRecordAndFavorites();

    return NextResponse.json({
      success: true,
      message: 'Cron job executed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Cron job failed:', error);

    return NextResponse.json(
      {
        success: false,
        message: 'Cron job failed',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

async function refreshRecordAndFavorites() {
  if (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage'
  ) {
    console.log('跳过刷新：当前使用 localstorage 存储模式');
    return;
  }

  const deadline = Date.now() + CRON_SOFT_DEADLINE_MS;
  const isTimeUp = () => Date.now() >= deadline;

  try {
    const users = await db.getAllUsers();
    if (process.env.USERNAME && !users.includes(process.env.USERNAME)) {
      users.push(process.env.USERNAME);
    }
    const detailCache = new Map<string, Promise<SearchResult | null>>();

    const getDetail = async (
      source: string,
      id: string,
      fallbackTitle: string
    ): Promise<SearchResult | null> => {
      const key = `${source}+${id}`;
      let promise = detailCache.get(key);
      if (!promise && !isTimeUp()) {
        promise = fetchVideoDetail({
          source,
          id,
          fallbackTitle: fallbackTitle.trim(),
        })
          .then((detail) => {
            const successPromise = Promise.resolve(detail);
            detailCache.set(key, successPromise);
            return detail;
          })
          .catch((err) => {
            console.error(`获取视频详情失败 (${source}+${id}):`, err);
            return null;
          });
        detailCache.set(key, promise);
      }
      return promise ? await promise : null;
    };

    for (const user of users) {
      if (isTimeUp()) {
        console.warn('Cron 达到软截止时间，提前安全结束剩余用户刷新');
        break;
      }
      console.log(`开始处理用户: ${user}`);

      try {
        const playRecords = await db.getAllPlayRecords(user);
        const recordEntries = Object.entries(playRecords);
        const totalRecords = recordEntries.length;
        let processedRecords = 0;

        for (let start = 0; start < recordEntries.length; start += CRON_DETAIL_CONCURRENCY) {
          if (isTimeUp()) break;
          const batch = recordEntries.slice(start, start + CRON_DETAIL_CONCURRENCY);
          await Promise.all(
            batch.map(async ([key, record]) => {
              try {
                const parsedKey = parseRecordKey(key);
                if (!parsedKey) {
                  console.warn(`跳过无效的播放记录键: ${key}`);
                  return;
                }
                const { source, id } = parsedKey;

                const detail = await getDetail(source, id, record.title);
                if (!detail) {
                  console.warn(`跳过无法获取详情的播放记录: ${key}`);
                  return;
                }

                const episodeCount = detail.episodes?.length || 0;
                if (episodeCount > 0 && episodeCount !== record.total_episodes) {
                  await db.savePlayRecord(user, source, id, {
                    title: detail.title || record.title,
                    source_name: record.source_name,
                    cover: detail.poster || record.cover,
                    index: record.index,
                    total_episodes: episodeCount,
                    play_time: record.play_time,
                    year: detail.year || record.year,
                    total_time: record.total_time,
                    save_time: record.save_time,
                    search_title: record.search_title,
                  });
                  console.log(
                    `更新播放记录: ${record.title} (${record.total_episodes} -> ${episodeCount})`
                  );
                }

                processedRecords++;
              } catch (err) {
                console.error(`处理播放记录失败 (${key}):`, err);
              }
            })
          );
        }

        console.log(`播放记录处理完成: ${processedRecords}/${totalRecords}`);
      } catch (err) {
        console.error(`获取用户播放记录失败 (${user}):`, err);
      }

      if (isTimeUp()) break;

      try {
        const favorites = await db.getAllFavorites(user);
        const favEntries = Object.entries(favorites);
        const totalFavorites = favEntries.length;
        let processedFavorites = 0;

        for (let start = 0; start < favEntries.length; start += CRON_DETAIL_CONCURRENCY) {
          if (isTimeUp()) break;
          const batch = favEntries.slice(start, start + CRON_DETAIL_CONCURRENCY);
          await Promise.all(
            batch.map(async ([key, fav]) => {
              try {
                const parsedKey = parseRecordKey(key);
                if (!parsedKey) {
                  console.warn(`跳过无效的收藏键: ${key}`);
                  return;
                }
                const { source, id } = parsedKey;

                const favDetail = await getDetail(source, id, fav.title);
                if (!favDetail) {
                  console.warn(`跳过无法获取详情的收藏: ${key}`);
                  return;
                }

                const favEpisodeCount = favDetail.episodes?.length || 0;
                if (favEpisodeCount > 0 && favEpisodeCount !== fav.total_episodes) {
                  await db.saveFavorite(user, source, id, {
                    title: favDetail.title || fav.title,
                    source_name: fav.source_name,
                    cover: favDetail.poster || fav.cover,
                    year: favDetail.year || fav.year,
                    total_episodes: favEpisodeCount,
                    save_time: fav.save_time,
                    search_title: fav.search_title,
                  });
                  console.log(
                    `更新收藏: ${fav.title} (${fav.total_episodes} -> ${favEpisodeCount})`
                  );
                }

                processedFavorites++;
              } catch (err) {
                console.error(`处理收藏失败 (${key}):`, err);
              }
            })
          );
        }

        console.log(`收藏处理完成: ${processedFavorites}/${totalFavorites}`);
      } catch (err) {
        console.error(`获取用户收藏失败 (${user}):`, err);
      }
    }

    console.log('刷新播放记录/收藏任务完成');
  } catch (err) {
    console.error('刷新播放记录/收藏任务启动失败', err);
  }
}
