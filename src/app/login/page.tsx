/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @next/next/no-img-element */

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { User, Lock, UserPlus, ArrowRight, ArrowLeft, ShieldCheck } from 'lucide-react';

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
    <div className='relative min-h-screen flex items-center justify-center px-4 overflow-hidden'>
      <div className='absolute top-4 right-4 z-50'>
        <ThemeToggle />
      </div>

      <div className='relative z-10 w-full max-w-[420px] rounded-3xl bg-gradient-to-b from-white/90 via-white/70 to-white/40 dark:from-zinc-900/90 dark:via-zinc-900/70 dark:to-zinc-900/40 backdrop-blur-xl shadow-2xl p-8 sm:p-10 dark:border dark:border-zinc-800 transition-all'>
        
        {/* Logo & 标题区域 */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 mb-4 rounded-2xl bg-white/60 dark:bg-zinc-800/60 backdrop-blur-sm flex items-center justify-center shadow-sm overflow-hidden border border-gray-200 dark:border-zinc-700/50">
            <img src="/logo.png" alt="Logo" className="w-full h-full object-cover" onError={(e) => e.currentTarget.style.display = 'none'} />
          </div>
          {/* 已还原为原生的 siteName 引用方式 */}
          <h1 className='tracking-tight text-center text-3xl font-extrabold text-red-600 dark:text-red-500 drop-shadow-sm'>
            {siteName}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm font-medium mt-2">
            {isRegisterMode ? 'Create a new account' : 'Welcome to you!'}
          </p>
        </div>

        <form onSubmit={onSubmit} className='space-y-5'>
          {/* 用户名输入框 */}
          {shouldAskUsername && (
            <div>
              <label htmlFor='username' className='block text-[13px] font-bold text-gray-700 dark:text-gray-300 mb-1.5 ml-1'>
                Username:
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <User className="h-[18px] w-[18px] text-gray-400 dark:text-gray-500" />
                </div>
                <input
                  id='username'
                  type='text'
                  autoComplete='username'
                  className='block w-full pl-10 pr-4 py-3.5 bg-white/60 dark:bg-zinc-800/60 backdrop-blur-md border-0 ring-1 ring-gray-200 dark:ring-white/10 rounded-xl text-sm focus:ring-2 focus:ring-red-500 focus:outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 transition-all'
                  placeholder='Please enter your username or ID.'
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* 密码输入框 */}
          <div>
            <label htmlFor='password' className='block text-[13px] font-bold text-gray-700 dark:text-gray-300 mb-1.5 ml-1'>
              Password:
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Lock className="h-[18px] w-[18px] text-gray-400 dark:text-gray-500" />
              </div>
              <input
                id='password'
                type='password'
                autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
                className='block w-full pl-10 pr-4 py-3.5 bg-white/60 dark:bg-zinc-800/60 backdrop-blur-md border-0 ring-1 ring-gray-200 dark:ring-white/10 rounded-xl text-sm focus:ring-2 focus:ring-red-500 focus:outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 transition-all'
                placeholder='Please enter the password.'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {/* 注册模式下的邀请码输入框 */}
          {isRegisterMode && shouldAskUsername && enableRegister && requireInviteCode && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
              <label htmlFor='inviteCode' className='block text-[13px] font-bold text-gray-700 dark:text-gray-300 mb-1.5 ml-1'>
                Invite Code:
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <ShieldCheck className="h-[18px] w-[18px] text-gray-400 dark:text-gray-500" />
                </div>
                <input
                  id='inviteCode'
                  type='text'
                  className='block w-full pl-10 pr-4 py-3.5 bg-white/60 dark:bg-zinc-800/60 backdrop-blur-md border-0 ring-1 ring-gray-200 dark:ring-white/10 rounded-xl text-sm focus:ring-2 focus:ring-red-500 focus:outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 transition-all'
                  placeholder='Please enter the invite code.'
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50/80 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-xl p-3 backdrop-blur-sm">
              <p className='text-[13px] font-medium text-red-600 dark:text-red-400 text-center'>{error}</p>
            </div>
          )}

          {/* 动态主操作按钮 */}
          <button
            type='submit'
            disabled={!password || loading || (shouldAskUsername && !username)}
            className='w-full flex items-center justify-center gap-2 py-3.5 mt-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[15px] font-bold transition-all shadow-lg shadow-red-600/30 disabled:opacity-50 disabled:cursor-not-allowed'
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
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

        {/* 底部切换区域 */}
        {shouldAskUsername && enableRegister && (
          <>
            <div className="flex items-center my-6">
              <div className="flex-grow border-t border-gray-200 dark:border-zinc-700/50"></div>
              <div className="flex-grow border-t border-gray-200 dark:border-zinc-700/50"></div>
            </div>

            <button
              type='button'
              onClick={() => {
                setIsRegisterMode(!isRegisterMode);
                setError(null);
              }}
              className='w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-white/40 dark:bg-zinc-800/40 backdrop-blur-md border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-white/80 dark:hover:bg-zinc-700/60 text-[14px] font-bold transition-all shadow-sm'
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
                  <ArrowRight className="w-4 h-4 ml-1 opacity-70" />
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-red-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <LoginPageClient />
    </Suspense>
  );
}
