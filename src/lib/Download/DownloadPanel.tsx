'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { useDownload } from './DownloadContext';
import {
  buildIndexedDBVideoCacheKey,
  getIndexedDBVideoSegments,
} from './indexeddb-video-cache';
import { M3U8DownloadTask, M3U8SegmentLogStatus } from './m3u8-downloader';

export function DownloadPanel() {
  const {
    tasks,
    showDownloadPanel,
    setShowDownloadPanel,
    startTask,
    pauseTask,
    cancelTask,
    retryFailedSegments,
    getProgress,
  } = useDownload();
  const [logTaskId, setLogTaskId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);
  const [logFilter, setLogFilter] = useState<'all' | M3U8SegmentLogStatus>(
    'all'
  );
  const [downloadMode, setDownloadMode] = useState<
    'browser' | 'indexeddb'
  >(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('downloadMode');
      if (saved === 'indexeddb') return 'indexeddb';
    }
    return 'browser';
  });
  const [threadsPerTask, setThreadsPerTask] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = Number(localStorage.getItem('downloadThreadsPerTask') || 6);
      if (Number.isFinite(saved) && saved >= 1 && saved <= 16) return saved;
    }
    return 6;
  });

  const logTask = useMemo(
    () => tasks.find((task) => task.id === logTaskId) || null,
    [logTaskId, tasks]
  );

  const filteredLogs = useMemo(() => {
    if (!logTask) return [];
    const logs =
      logFilter === 'all'
        ? logTask.segmentLogs
        : logTask.segmentLogs.filter((log) => log.status === logFilter);
    return [...logs].reverse();
  }, [logFilter, logTask]);

  if (!showDownloadPanel || !mounted || typeof document === 'undefined') {
    return null;
  }

  const handleModeChange = (mode: 'browser' | 'indexeddb') => {
    setDownloadMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('downloadMode', mode);
    }
  };

  const handleThreadsChange = (threads: number) => {
    setThreadsPerTask(threads);
    if (typeof window !== 'undefined') {
      localStorage.setItem('downloadThreadsPerTask', String(threads));
    }
  };

  const getStatusText = (status: M3U8DownloadTask['status']) => {
    switch (status) {
      case 'ready':
        return '等待中';
      case 'downloading':
        return '下载中';
      case 'pause':
        return '已暂停';
      case 'done':
        return '已完成';
      case 'error':
        return '错误';
      default:
        return '未知';
    }
  };

  const getStatusColor = (status: M3U8DownloadTask['status']) => {
    switch (status) {
      case 'ready':
        return 'text-gray-500 dark:text-zinc-400';
      case 'downloading':
        return 'text-emerald-600 dark:text-emerald-400';
      case 'pause':
        return 'text-amber-600 dark:text-amber-400';
      case 'done':
        return 'text-emerald-600 dark:text-emerald-400';
      case 'error':
        return 'text-rose-600 dark:text-rose-400';
      default:
        return 'text-gray-500 dark:text-zinc-400';
    }
  };

  const getDownloadModeText = (mode: M3U8DownloadTask['downloadMode']) => {
    switch (mode) {
      case 'filesystem':
        return '本地目录';
      case 'indexeddb':
        return '离线缓存';
      case 'browser':
      default:
        return '浏览器导出';
    }
  };

  const getLogBadgeClass = (status: M3U8SegmentLogStatus) => {
    switch (status) {
      case 'downloading':
        return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300';
      case 'success':
        return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300';
      case 'retry':
        return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300';
      case 'timeout':
      case 'error':
        return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-300';
      case 'aborted':
        return 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-500/30 dark:bg-zinc-500/10 dark:text-zinc-300';
      default:
        return 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-500/30 dark:bg-gray-500/10 dark:text-gray-300';
    }
  };

  const getLogStatusText = (status: M3U8SegmentLogStatus) => {
    switch (status) {
      case 'queued':
        return '排队';
      case 'downloading':
        return '下载中';
      case 'success':
        return '成功';
      case 'retry':
        return '重试';
      case 'error':
        return '失败';
      case 'timeout':
        return '超时';
      case 'aborted':
        return '中止';
      default:
        return status;
    }
  };

  const formatTime = (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString();

  const logStats = logTask
    ? {
        total: logTask.segmentLogs.length,
        success: logTask.finishList.filter(
          (item) => item.status === 'is-success'
        ).length,
        downloading: logTask.finishList.filter(
          (item) => item.status === 'is-downloading'
        ).length,
        error: logTask.finishList.filter((item) => item.status === 'is-error')
          .length,
      }
    : null;

  return createPortal(
    <div
      className='fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-6'
      style={{ zIndex: 9999 }}
    >
      <div className='flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#121316]'>
        {/* 标题栏 */}
        <div className='flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white/90 p-4 dark:border-white/[0.08] dark:bg-[#1C1E24]'>
          <div>
            <h2 className='text-lg sm:text-xl font-bold text-gray-900 dark:text-zinc-100'>
              视频分片下载管理
            </h2>
            <p className='mt-0.5 text-xs text-gray-500 dark:text-zinc-400'>
              自动过滤 M3U8 切片广告 · 支持 AES-128 解密、失败分片单独重试与分片日志追踪
            </p>
          </div>

          <div className='flex items-center gap-2 sm:gap-3'>
            {/* 下载模式选择 */}
            <div className='flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-[#121316] p-1 text-xs'>
              <button
                type='button'
                onClick={() => handleModeChange('browser')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  downloadMode === 'browser'
                    ? 'bg-emerald-500 text-white'
                    : 'text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-zinc-200'
                }`}
                title='下载完成后自动合并为单个 .ts 视频文件导出'
              >
                合并导出
              </button>
              <button
                type='button'
                onClick={() => handleModeChange('indexeddb')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  downloadMode === 'indexeddb'
                    ? 'bg-emerald-500 text-white'
                    : 'text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-zinc-200'
                }`}
                title='分片持久化存入浏览器 IndexedDB 离线缓存库，播放页自动命中秒开'
              >
                离线缓存
              </button>
            </div>

            {/* 并发线程数选择 */}
            <select
              value={threadsPerTask}
              onChange={(e) => handleThreadsChange(Number(e.target.value))}
              className='rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#121316] px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-zinc-200 focus:outline-none focus:border-emerald-500'
              title='单任务分片并发下载线程数'
            >
              <option value={4}>4 线程</option>
              <option value={6}>6 线程</option>
              <option value={8}>8 线程</option>
              <option value={12}>12 线程</option>
              <option value={16}>16 线程</option>
            </select>

            <button
              onClick={() => setShowDownloadPanel(false)}
              className='cursor-pointer rounded-lg p-2 text-gray-500 transition-colors duration-200 hover:bg-gray-100 hover:text-gray-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
              aria-label='关闭下载任务列表'
            >
              <svg
                className='h-5 w-5'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M6 18L18 6M6 6l12 12'
                />
              </svg>
            </button>
          </div>
        </div>

        {/* 任务列表 */}
        <div className='flex-1 overflow-y-auto p-4 space-y-3'>
          {tasks.length === 0 ? (
            <div className='flex min-h-[280px] flex-col items-center justify-center text-gray-500 dark:text-zinc-400'>
              <svg
                className='mb-3 h-14 w-14 opacity-50'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='1.5'
                  d='M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4'
                />
              </svg>
              <p className='text-sm font-medium'>暂无下载任务</p>
              <p className='text-xs text-gray-400 dark:text-zinc-500 mt-1'>
                在播放页面点击「下载」按钮即可选择集数创建分片下载任务
              </p>
            </div>
          ) : (
            tasks.map((task) => {
              const progress = getProgress(task.id);
              return (
                <div
                  key={task.id}
                  className='rounded-xl border border-gray-200 bg-gray-50/80 p-4 transition-colors duration-200 dark:border-white/[0.06] dark:bg-[#1C1E24]'
                >
                  <div className='mb-3 flex items-start justify-between gap-4'>
                    <div className='min-w-0 flex-1'>
                      <h3 className='mb-1 truncate text-sm font-semibold text-gray-900 dark:text-zinc-100'>
                        {task.title}
                      </h3>
                      <p className='truncate text-xs text-gray-500 dark:text-zinc-400'>
                        {task.url}
                      </p>
                    </div>
                    <div className='flex shrink-0 items-center gap-2'>
                      <span
                        className={`text-xs font-semibold ${getStatusColor(
                          task.status
                        )}`}
                      >
                        {getStatusText(task.status)}
                      </span>
                      <span className='rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-500 dark:border-white/10 dark:text-zinc-400'>
                        {task.type}
                      </span>
                      <span className='rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-500 dark:border-white/10 dark:text-zinc-400'>
                        {getDownloadModeText(task.downloadMode)}
                      </span>
                    </div>
                  </div>

                  {/* 进度条 */}
                  <div className='mb-3'>
                    <div className='mb-1 flex items-center justify-between text-xs text-gray-600 dark:text-zinc-300'>
                      <span>
                        {task.finishNum} / {task.rangeDownload.targetSegment} 分片
                      </span>
                      <span>{progress.toFixed(1)}%</span>
                    </div>
                    <div className='h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-zinc-800'>
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          task.status === 'downloading'
                            ? 'bg-emerald-500 motion-safe:animate-pulse'
                            : task.status === 'done'
                            ? 'bg-emerald-500'
                            : task.status === 'error'
                            ? 'bg-rose-500'
                            : 'bg-zinc-500'
                        }`}
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* 错误信息 */}
                  {task.errorNum > 0 && (
                    <div className='mb-3 flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-400/30 dark:bg-rose-400/10'>
                      <div
                        className='text-xs text-rose-600 dark:text-rose-300'
                        role='alert'
                      >
                        {task.errorNum} 个分片下载失败
                      </div>
                      <button
                        onClick={() => retryFailedSegments(task.id)}
                        className='cursor-pointer text-xs font-medium text-emerald-600 underline transition-colors hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300'
                      >
                        重试失败分片
                      </button>
                    </div>
                  )}

                  {/* 操作按钮 */}
                  <div className='flex flex-wrap items-center gap-2'>
                    <button
                      onClick={() => {
                        setLogTaskId(task.id);
                        setLogFilter('all');
                      }}
                      className='flex cursor-pointer items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors duration-200 hover:bg-gray-100 dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
                    >
                      <svg
                        className='h-4 w-4'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth='2'
                          d='M9 17v-6m4 6V7m4 10v-3M5 19h14M5 5h14'
                        />
                      </svg>
                      分片日志
                      {task.segmentLogs.length > 0 && (
                        <span className='rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-700 dark:bg-zinc-700 dark:text-zinc-200'>
                          {task.segmentLogs.length}
                        </span>
                      )}
                    </button>

                    {task.status === 'downloading' && (
                      <button
                        onClick={() => pauseTask(task.id)}
                        className='flex cursor-pointer items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-200 hover:bg-amber-600'
                      >
                        暂停
                      </button>
                    )}

                    {(task.status === 'pause' ||
                      task.status === 'ready' ||
                      task.status === 'error') && (
                      <button
                        onClick={() => startTask(task.id)}
                        className='flex cursor-pointer items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-200 hover:bg-emerald-600'
                      >
                        {task.status === 'error' ? '重试' : '继续下载'}
                      </button>
                    )}

                    {task.status === 'done' &&
                      task.downloadMode === 'indexeddb' && (
                        <button
                          onClick={async () => {
                            try {
                              const key =
                                task.indexedDBCacheKey ||
                                (task.source &&
                                task.videoId &&
                                task.episodeIndex !== undefined
                                  ? buildIndexedDBVideoCacheKey(
                                      task.source,
                                      task.videoId,
                                      task.episodeIndex
                                    )
                                  : `task::${task.id}`);
                              const segs = await getIndexedDBVideoSegments(key);
                              if (segs.length > 0) {
                                const blob = new Blob(
                                  segs.map((s) => s.data),
                                  { type: 'video/MP2T' }
                                );
                                const a = document.createElement('a');
                                a.href = URL.createObjectURL(blob);
                                a.download = `${task.title}.ts`;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                setTimeout(
                                  () => URL.revokeObjectURL(a.href),
                                  5000
                                );
                              }
                            } catch (e) {
                              // ignore export error
                            }
                          }}
                          className='flex cursor-pointer items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-200 hover:bg-emerald-600'
                        >
                          导出视频文件
                        </button>
                      )}

                    <button
                      onClick={() => cancelTask(task.id)}
                      className='flex cursor-pointer items-center gap-1 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-200 hover:bg-rose-600'
                    >
                      删除
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 底部统计 */}
        {tasks.length > 0 && (
          <div className='border-t border-gray-200 bg-gray-50 p-4 dark:border-white/[0.08] dark:bg-[#1C1E24]'>
            <div className='grid grid-cols-2 gap-2 text-xs sm:text-sm text-gray-600 dark:text-zinc-300 sm:grid-cols-4'>
              <span>总任务数: {tasks.length}</span>
              <span>
                下载中: {tasks.filter((t) => t.status === 'downloading').length}
              </span>
              <span>
                已完成: {tasks.filter((t) => t.status === 'done').length}
              </span>
              <span>
                已暂停: {tasks.filter((t) => t.status === 'pause').length}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 分片级下载日志弹窗 */}
      {logTask && (
        <div
          className='fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-6'
          style={{ zIndex: 10000 }}
        >
          <div className='flex max-h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#121316]'>
            <div className='border-b border-gray-200 bg-white/95 p-4 dark:border-white/[0.08] dark:bg-[#1C1E24]'>
              <div className='flex items-start justify-between gap-4'>
                <div className='min-w-0'>
                  <h3 className='truncate text-lg font-bold text-gray-900 dark:text-zinc-100'>
                    分片下载日志
                  </h3>
                  <p className='mt-0.5 truncate text-xs text-gray-500 dark:text-zinc-400'>
                    {logTask.title}
                  </p>
                </div>
                <button
                  onClick={() => setLogTaskId(null)}
                  className='cursor-pointer rounded-lg p-2 text-gray-500 transition-colors duration-200 hover:bg-gray-100 hover:text-gray-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
                  aria-label='关闭分片下载日志'
                >
                  <svg
                    className='h-5 w-5'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth='2'
                      d='M6 18L18 6M6 6l12 12'
                    />
                  </svg>
                </button>
              </div>

              {logStats && (
                <div className='mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4'>
                  <div className='rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-[#121316]'>
                    <div className='text-xs text-gray-500 dark:text-zinc-400'>
                      日志总数
                    </div>
                    <div className='mt-1 text-lg font-semibold text-gray-900 dark:text-zinc-100'>
                      {logStats.total}
                    </div>
                  </div>
                  <div className='rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-400/30 dark:bg-emerald-400/10'>
                    <div className='text-xs text-emerald-700 dark:text-emerald-300'>
                      成功分片
                    </div>
                    <div className='mt-1 text-lg font-semibold text-emerald-700 dark:text-emerald-200'>
                      {logStats.success}
                    </div>
                  </div>
                  <div className='rounded-xl border border-sky-200 bg-sky-50 p-3 dark:border-sky-400/30 dark:bg-sky-400/10'>
                    <div className='text-xs text-sky-700 dark:text-sky-300'>
                      下载中
                    </div>
                    <div className='mt-1 text-lg font-semibold text-sky-700 dark:text-sky-200'>
                      {logStats.downloading}
                    </div>
                  </div>
                  <div className='rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-400/30 dark:bg-rose-400/10'>
                    <div className='text-xs text-rose-700 dark:text-rose-300'>
                      失败分片
                    </div>
                    <div className='mt-1 text-lg font-semibold text-rose-700 dark:text-rose-200'>
                      {logStats.error}
                    </div>
                  </div>
                </div>
              )}

              <div className='mt-4 flex flex-wrap gap-2'>
                {(
                  [
                    'all',
                    'downloading',
                    'success',
                    'retry',
                    'timeout',
                    'error',
                    'aborted',
                  ] as Array<'all' | M3U8SegmentLogStatus>
                ).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setLogFilter(filter)}
                    className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-200 ${
                      logFilter === filter
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:bg-[#121316] dark:text-zinc-300 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {filter === 'all' ? '全部' : getLogStatusText(filter)}
                  </button>
                ))}
              </div>
            </div>

            <div className='flex-1 overflow-y-auto p-4'>
              {filteredLogs.length === 0 ? (
                <div className='flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 text-gray-500 dark:border-white/10 dark:text-zinc-400'>
                  <p className='text-sm'>暂无匹配的分片日志</p>
                </div>
              ) : (
                <div className='space-y-2'>
                  {filteredLogs.map((log) => (
                    <div
                      key={log.id}
                      className='grid gap-3 rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-white/[0.06] dark:bg-[#1C1E24] md:grid-cols-[110px_90px_1fr_150px]'
                    >
                      <div className='font-mono text-xs text-gray-500 dark:text-zinc-400'>
                        {formatTime(log.timestamp)}
                      </div>
                      <div>
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${getLogBadgeClass(
                            log.status
                          )}`}
                        >
                          {getLogStatusText(log.status)}
                        </span>
                      </div>
                      <div className='min-w-0'>
                        <div className='truncate text-gray-900 dark:text-zinc-100'>
                          {log.message}
                        </div>
                        <div className='mt-0.5 truncate font-mono text-xs text-gray-400 dark:text-zinc-500'>
                          segment #{log.index + 1}
                        </div>
                      </div>
                      <div className='flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-zinc-400 md:justify-end'>
                        {typeof log.retryCount === 'number' && (
                          <span>重试 {log.retryCount}</span>
                        )}
                        {typeof log.durationMs === 'number' && (
                          <span>{log.durationMs}ms</span>
                        )}
                        {typeof log.httpStatus === 'number' && (
                          <span>HTTP {log.httpStatus}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
