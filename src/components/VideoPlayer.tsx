'use client';

import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { useEffect, useRef } from 'react';

interface VideoPlayerProps {
  url: string;
  title?: string;
  poster?: string;
  lastStartTime?: number;
  timeUpdateInterval?: number;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onEnded?: () => void;
}

export default function VideoPlayer({
  url,
  title = '',
  poster = '',
  lastStartTime = 0,
  timeUpdateInterval = 15,
  onTimeUpdate,
  onEnded,
}: VideoPlayerProps) {
  const artRef = useRef<HTMLDivElement>(null);
  const playerInstance = useRef<Artplayer | null>(null);
  const lastSaveTime = useRef<number>(0);
  
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onEndedRef = useRef(onEnded);

  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    if (!artRef.current) return;

    const playM3u8 = (video: HTMLMediaElement, url: string, art: Artplayer) => {
      if (Hls.isSupported()) {
        if (art.hls) art.hls.destroy();
        
        const hls = new Hls({
          maxBufferLength: 60,
          maxMaxBufferLength: 600,
          maxBufferSize: 100 * 1024 * 1024,
          enableWorker: true,
        });

        hls.loadSource(url);
        hls.attachMedia(video);
        art.hls = hls;

        art.on('destroy', () => {
          hls.destroy();
          delete art.hls;
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                // eslint-disable-next-line no-console
                console.warn('网络波动，尝试恢复下载...');
                hls.startLoad(); 
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                // eslint-disable-next-line no-console
                console.warn('媒体数据损坏，尝试恢复画面...');
                hls.recoverMediaError();
                break;
              default:
                hls.destroy();
                art.notice.show = '视频源解析遇到致命错误';
                break;
            }
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
      } else {
        art.notice.show = '当前浏览器不支持该视频格式';
      }
    };

    const art = new Artplayer({
      container: artRef.current,
      url,
      customType: { m3u8: playM3u8 },
      title,
      poster,
      volume: 0.8,
      isLive: false,
      muted: false,
      autoplay: true,
      pip: true,
      autoSize: true,
      autoMini: true,
      screenshot: true,
      setting: true,
      loop: false,
      flip: true,
      playbackRate: true,
      aspectRatio: true,
      fullscreen: true,
      fullscreenWeb: true,
      subtitleOffset: true,
      miniProgressBar: true,
      mutex: true,
      backdrop: true,
      playsInline: true,
      autoPlayback: true,
      airplay: true,
      theme: '#e50914',
      lang: 'zh-cn',
      moreVideoAttr: { crossOrigin: 'anonymous' },
    });

    playerInstance.current = art;

    art.on('ready', () => {
      if (lastStartTime > 0) {
        art.currentTime = lastStartTime;
        art.notice.show = `已为您跳转至上次观看位置`;
      }
    });

    art.on('video:timeupdate', () => {
      const currentTime = art.currentTime;
      const duration = art.duration;
      
      if (currentTime - lastSaveTime.current >= timeUpdateInterval || currentTime < lastSaveTime.current) {
        lastSaveTime.current = currentTime;
        if (onTimeUpdateRef.current) {
          onTimeUpdateRef.current(currentTime, duration);
        }
      }
    });

    art.on('video:ended', () => {
      if (onEndedRef.current) onEndedRef.current();
    });

    art.on('fullscreen', (state) => {
      if (state && screen.orientation && screen.orientation.lock) {
        // 修复 ESLint 空函数报错，加入错误捕获日志
        screen.orientation.lock('landscape').catch((err) => {
          // eslint-disable-next-line no-console
          console.warn('Orientation lock failed:', err);
        });
      } else if (!state && screen.orientation && screen.orientation.unlock) {
        screen.orientation.unlock();
      }
    });

    const handleBeforeUnload = () => {
      if (playerInstance.current && onTimeUpdateRef.current) {
        const finalTime = playerInstance.current.currentTime;
        if (finalTime > 0 && Math.abs(finalTime - lastSaveTime.current) > 2) {
          onTimeUpdateRef.current(finalTime, playerInstance.current.duration);
        }
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      
      if (playerInstance.current) {
        if (onTimeUpdateRef.current) {
          const finalTime = playerInstance.current.currentTime;
          if (finalTime > 0 && Math.abs(finalTime - lastSaveTime.current) > 2) {
            onTimeUpdateRef.current(finalTime, playerInstance.current.duration);
          }
        }
        playerInstance.current.destroy(false);
        playerInstance.current = null;
      }
    };
  }, [url, title, poster, lastStartTime, timeUpdateInterval]); 

  return (
    <div className="w-full aspect-video rounded-xl overflow-hidden shadow-2xl bg-black relative group">
      <div ref={artRef} className="w-full h-full" />
    </div>
  );
}
