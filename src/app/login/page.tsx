/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @next/next/no-img-element */

'use client';

import { ArrowLeft, ArrowRight, Lock, ShieldCheck, User, UserPlus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { useSite } from '@/components/SiteProvider';
import { ThemeToggle } from '@/components/ThemeToggle';

function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  
  // 模式切换：false = 登录, true = 注册
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  
  const [shouldAskUsername, setShouldAskUsername] = useState(false);
  const [enableRegister, setEnableRegister] = useState(false);
  const { siteName } = useSite();

  const requireInviteCode = process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true';

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storageType = (window as any).RUNTIME_CONFIG?.STORAGE_TYPE;
      setShouldAskUsername(storageType && storageType !== 'localstorage');
      setEnableRegister(Boolean((window as any).RUNTIME_CONFIG?.ENABLE_REGISTER));
    }
  }, []);

  const handleLogin = async (e?: React.FormEvent<HTMLFormElement>) => {
    if (e) e.preventDefault();
    setError(null);
    if (!password || (shouldAskUsername && !username)) return;

    try {
      setLoading(true);
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          ...(shouldAskUsername ? { username } : {}),
        }),
      });

      if (res.ok) {
        const redirect = searchParams.get('redirect') || '/';
        router.replace(redirect);
      } else if (res.status === 401) {
        setError('密码错误或用户不存在');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? '服务器错误');
      }
    } catch (error) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e?: React.FormEvent<HTMLFormElement>) => {
    if (e) e.preventDefault();
    setError(null);
    if (!password || !username) return;

    if (requireInviteCode && !inviteCode) {
      setError('系统已开启邀请制，必须填写邀请码才可注册');
      return;
    }

    try {
      setLoading(true);
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, inviteCode }),
      });

      if (res.ok) {
        const redirect = searchParams.get('redirect') || '/';
        router.replace(redirect);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? '服务器错误');
      }
    } catch (error) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isRegisterMode) {
      handleRegister();
    } else {
      handleLogin();
    }
  };

  return (
    <div className='min-h-screen flex flex-col bg-white dark:bg-[#0a0a0a] selection:bg-black selection:text-white dark:selection:bg-white dark:selection:text-black transition-colors'>
      
      {/* 顶部 Header：左侧站点名，右侧模式切换 */}
      <header className="w-full flex items-center justify-between p-6 sm:p-8 shrink-0">
        <div className="text-xl font-black tracking-tight text-gray-900 dark:text-white">
          {siteName || '紫月 TV'}
        </div>
        <ThemeToggle />
      </header>

      {/* 中部核心表单区（沉浸式无边框） */}
      <main className="flex-1 flex items-center justify-center px-6 w-full">
        <div className='w-full max-w-[340px] sm:max-w-[380px]'>
          
          {/* 极简标题 */}
          <div className="mb-10 text-center">
            <h1 className='text-3xl sm:text-4xl font-black text-gray-900 dark:text-white tracking-tight mb-3'>
              {isRegisterMode ? '注册' : '登录'}
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">
              {isRegisterMode ? 'Create a new account' : 'Welcome back to you!'}
            </p>
          </div>

          <form onSubmit={onSubmit} className='space-y-4 sm:space-y-5'>
            {/* 用户名输入框 (胶囊风格) */}
            {shouldAskUsername && (
              <div>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                    <User className="h-5 w-5 text-gray-400 group-focus-within:text-gray-900 dark:group-focus-within:text-white transition-colors" />
                  </div>
                  <input
                    id='username'
                    type='text'
                    autoComplete='username'
                    className='block w-full pl-12 pr-6 py-4 bg-gray-100 dark:bg-zinc-900 border border-transparent rounded-full text-[15px] font-medium focus:ring-2 focus:ring-black dark:focus:ring-white focus:bg-white dark:focus:bg-black outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 transition-all'
                    placeholder='Username'
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* 密码输入框 (胶囊风格) */}
            <div>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400 group-focus-within:text-gray-900 dark:group-focus-within:text-white transition-colors" />
                </div>
                <input
                  id='password'
                  type='password'
                  autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
                  className='block w-full pl-12 pr-6 py-4 bg-gray-100 dark:bg-zinc-900 border border-transparent rounded-full text-[15px] font-medium focus:ring-2 focus:ring-black dark:focus:ring-white focus:bg-white dark:focus:bg-black outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 transition-all'
                  placeholder='Password'
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            {/* 注册模式下的邀请码输入框 (胶囊风格) */}
            {isRegisterMode && shouldAskUsername && enableRegister && requireInviteCode && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                    <ShieldCheck className="h-5 w-5 text-gray-400 group-focus-within:text-gray-900 dark:group-focus-within:text-white transition-colors" />
                  </div>
                  <input
                    id='inviteCode'
                    type='text'
                    className='block w-full pl-12 pr-6 py-4 bg-gray-100 dark:bg-zinc-900 border border-transparent rounded-full text-[15px] font-medium focus:ring-2 focus:ring-black dark:focus:ring-white focus:bg-white dark:focus:bg-black outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 transition-all'
                    placeholder='Invite Code'
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* 错误提示 */}
            {error && (
              <div className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-2xl p-3.5">
                <p className='text-[13px] font-bold text-red-600 dark:text-red-500 text-center'>{error}</p>
              </div>
            )}

            {/* 纯黑主操作按钮 */}
            <button
              type='submit'
              disabled={!password || loading || (shouldAskUsername && !username)}
              className='w-full flex items-center justify-center gap-2 py-4 mt-2 rounded-full bg-black hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-200 text-white dark:text-black text-[15px] font-bold transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed'
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
              ) : isRegisterMode ? (
                <>
                  <UserPlus className="w-[18px] h-[18px]" />
                  Sign up
                </>
              ) : (
                <>
                  <Lock className="w-[18px] h-[18px]" />
                  Sign in
                </>
              )}
            </button>
          </form>

          {/* 注册/登录切换按钮 */}
          {shouldAskUsername && enableRegister && (
            <div className="mt-6">
              <button
                type='button'
                onClick={() => {
                  setIsRegisterMode(!isRegisterMode);
                  setError(null);
                }}
                className='w-full flex items-center justify-center gap-2 py-4 rounded-full bg-transparent border border-gray-200 dark:border-zinc-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-900 text-[14px] font-bold transition-all'
              >
                {isRegisterMode ? (
                  <>
                    <ArrowLeft className="w-4 h-4" />
                    Back to Sign in
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    Sign up
                    <ArrowRight className="w-4 h-4 ml-1 opacity-60" />
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </main>

      {/* 底部 Footer：Logo 与 用户协议 */}
      <footer className="w-full pb-8 pt-4 flex flex-col items-center justify-center gap-3 shrink-0">
        <div className="w-11 h-11 rounded-2xl bg-gray-50 dark:bg-zinc-900 flex items-center justify-center shadow-sm overflow-hidden border border-gray-200 dark:border-zinc-800">
          <img src="/logo.png" alt="Logo" className="w-full h-full object-cover" onError={(e) => e.currentTarget.style.display = 'none'} />
        </div>
        <div className="text-[11px] font-semibold tracking-wide text-gray-400 dark:text-gray-600 flex items-center gap-2.5 uppercase">
          <a href="#" className="hover:text-black dark:hover:text-white transition-colors cursor-pointer">用户协议</a>
          <span className="opacity-50">|</span>
          <a href="#" className="hover:text-black dark:hover:text-white transition-colors cursor-pointer">隐私条款</a>
        </div>
      </footer>

    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-[#0a0a0a]">
        <div className="w-8 h-8 border-4 border-black dark:border-white border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <LoginPageClient />
    </Suspense>
  );
}
