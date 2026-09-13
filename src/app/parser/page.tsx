'use client';

import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import PageLayout from '@/components/PageLayout';

const PARSE_LINES = [
  { name: '1线', url: 'https://jx.xmflv.cc/?url=' },
  { name: '2线', url: 'https://jx.xmflv.com/?url=' },
  { name: '3线', url: 'https://z1.m1907.top/?jx=' },
  { name: '4线', url: 'https://jx.77flv.cc/?url=' },
  { name: '5线', url: 'https://jx.playerjy.com/?url=' },
  { name: '6线', url: 'https://jx.xymp4.cc/?url=' },
  { name: '7线', url: 'https://jx.202617.xyz/tv.php?url=' },
  { name: '8线', url: 'https://jx.hls.one/?url=' },
  { name: '9线', url: 'https://jx.2s0.cn/player/?url=' },
  { name: '10线', url: 'https://jx.yparse.com/index.php?url=' },
  { name: '11线', url: 'https://bfq.txnp.cn/player?url=' },
  { name: '12线', url: 'https://super.playr.top/?url=' },
  { name: '13线', url: 'https://jx.dmflv.cc/?url=' },
  { name: '14线', url: 'https://yparse.ik9.cc/index.php?url=' },
  { name: '15线', url: 'https://www.playm3u8.cn/jiexi.php?url=' },
  { name: '16线', url: 'https://jiexi.789jiexi.icu:4433/?url=' },
  { name: '17线', url: 'https://json.fongmi.cc/web?url=' },
  { name: '18线', url: 'https://bd.jx.cn/?url=' },
  { name: '19线', url: 'https://www.ckplayer.vip/jiexi/?url=' },
  { name: '20线', url: 'https://www.huaqi.live/?url=' },
  { name: '21线', url: 'https://video.isyour.love/player/getplayer?url=' },
];

function ParserPageClient() {
  const router = useRouter();
  
  const [isAuthChecking, setIsAuthChecking] = useState(true);

  const [parserLine, setParserLine] = useState(PARSE_LINES[0].url);
  const [parserInputUrl, setParserInputUrl] = useState('');
  const [activeIframeSrc, setActiveIframeSrc] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const checkAuth = () => {
      const isLoggedIn = 
        localStorage.getItem('token') || 
        localStorage.getItem('user_token') || 
        localStorage.getItem('user') ||
        document.cookie.includes('token=');

      if (!isLoggedIn) {
        router.replace('/login?callbackUrl=/parser');
      } else {
        setIsAuthChecking(false);
      }
    };

    checkAuth();
  }, [router]);

  const handleParsePlay = () => {
    const url = parserInputUrl.trim();
    if (!url) {
      if (inputRef.current) {
        inputRef.current.style.borderColor = '#e11d48';
        inputRef.current.style.boxShadow = '0 0 0 3px rgba(225, 29, 72, 0.2)';
        inputRef.current.focus();
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.style.borderColor = '';
            inputRef.current.style.boxShadow = '';
          }
        }, 800);
      }
      return;
    }
    setActiveIframeSrc(`${parserLine}${url}`);
  };

  if (isAuthChecking) {
    return (
      <PageLayout activePath="/parser">
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)]">
          <div className="relative w-16 h-16 bg-gradient-to-r from-red-500 to-rose-600 rounded-2xl flex items-center justify-center transform animate-pulse shadow-xl border border-red-400/30">
            <div className="absolute -inset-2 bg-gradient-to-r from-red-500 to-rose-600 rounded-2xl opacity-20 animate-spin"></div>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-white animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <p className="mt-4 text-gray-500 dark:text-gray-400 font-medium tracking-wider text-sm">正在验证安全访问凭证...</p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath="/parser">
      <div className="flex flex-col gap-6 py-6 px-5 lg:px-[3rem] 2xl:px-20 min-h-[calc(100vh-80px)] relative overflow-hidden">
        
        <div className="absolute top-[-10vh] left-1/2 -translate-x-1/2 w-[80vw] max-w-[800px] aspect-square bg-[radial-gradient(circle,rgba(225,29,72,0.12)_0%,rgba(15,17,26,0)_70%)] pointer-events-none -z-10" />

        <div className="w-full max-w-5xl mx-auto flex flex-col gap-6 relative z-10">
          
          <div className="text-center mt-4 md:mt-8 mb-4">
            <div className="flex items-center justify-center gap-3 mb-2">
              <img 
                src="/image/logo.png" 
                alt="红月Logo" 
                className="h-10 md:h-12 w-auto object-contain drop-shadow-md select-none pointer-events-none"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-red-500 to-rose-600 bg-clip-text text-transparent inline-block tracking-wide">
                VIP 视频无界解析
              </h1>
            </div>
            <p className="text-gray-500 dark:text-gray-400 text-sm md:text-base mt-1">
              突破平台限制，粘贴腾讯、爱奇艺、优酷等外部视频播放页链接即可观看
            </p>
          </div>

          <div className="w-full aspect-video bg-black/90 dark:bg-black rounded-2xl overflow-hidden shadow-2xl border border-gray-200/20 dark:border-gray-800 relative group">
            {!activeIframeSrc ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 dark:text-gray-400">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-lg font-medium tracking-wide">等待解析信号接入...</p>
              </div>
            ) : (
              <iframe
                src={activeIframeSrc}
                className="w-full h-full border-0"
                allowFullScreen
                scrolling="no"
              />
            )}
          </div>

          <div className="flex flex-col md:flex-row gap-4 bg-white/60 dark:bg-[#1E232D]/65 backdrop-blur-xl p-5 md:p-6 rounded-2xl border border-gray-200/50 dark:border-white/10 shadow-xl">
            <input
              ref={inputRef}
              type="text"
              value={parserInputUrl}
              onChange={(e) => setParserInputUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleParsePlay()}
              placeholder="在此处粘贴 VIP 视频源链接..."
              className="flex-1 bg-white dark:bg-black/30 border border-gray-300 dark:border-gray-700/50 rounded-xl px-5 py-4 text-base text-gray-800 dark:text-gray-100 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20 transition-all placeholder-gray-400"
            />
            
            <div className="flex gap-4">
              <select
                value={parserLine}
                onChange={(e) => setParserLine(e.target.value)}
                className="w-full md:w-48 bg-white dark:bg-black/30 border border-gray-300 dark:border-gray-700/50 rounded-xl px-4 py-4 text-base text-gray-800 dark:text-gray-100 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20 transition-all cursor-pointer appearance-none"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 1.2rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.2em' }}
              >
                {PARSE_LINES.map((line) => (
                  <option key={line.url} value={line.url} className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
                    ⚡ {line.name}
                  </option>
                ))}
              </select>
              
              <button
                onClick={handleParsePlay}
                className="px-8 py-4 bg-gradient-to-r from-red-500 to-rose-600 text-white text-base font-semibold rounded-xl hover:from-red-600 hover:to-rose-700 shadow-[0_8px_20px_-6px_rgba(225,29,72,0.5)] hover:shadow-[0_12px_25px_-6px_rgba(225,29,72,0.7)] transform active:translate-y-[1px] transition-all flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                立即播放
              </button>
            </div>
          </div>
          
          <div className="text-center text-sm text-gray-400 dark:text-gray-500 mt-6 mb-8">
            &copy; {new Date().getFullYear()} 紫月-TV 视频解析引擎
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

export default function ParserPage() {
  return (
    <Suspense fallback={
      <PageLayout activePath="/parser">
        <div className="flex items-center justify-center min-h-[calc(100vh-80px)]">
          <div className="w-16 h-16 border-4 border-red-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      </PageLayout>
    }>
      <ParserPageClient />
    </Suspense>
  );
}
