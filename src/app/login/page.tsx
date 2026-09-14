/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @next/next/no-img-element */

'use client';

import { Lock, ShieldCheck, User } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { useSite } from '@/components/SiteProvider';

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
  
  // 调用全局变量
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
        setError('Invalid username or password');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Server error');
      }
    } catch (error) {
      setError('Network error, please try again later');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e?: React.FormEvent<HTMLFormElement>) => {
    if (e) e.preventDefault();
    setError(null);
    if (!password || !username) return;

    if (requireInviteCode && !inviteCode) {
      setError('An invite code is required to sign up');
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
        setError(data.error ?? 'Server error');
      }
    } catch (error) {
      setError('Network error, please try again later');
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
      
      {/* 顶部 Header：左侧站点名，右侧包含“Sign up”按钮 */}
      <header className="w-full flex items-center justify-between p-6 sm:p-8 shrink-0">
        <div className="text-xl font-black tracking-tight text-gray-900 dark:text-white">
          {/* 【修改点】：重新调用 siteName 变量，并赋予默认值 */}
          {siteName || 'PurpleMoon'}
        </div>
        
        <div className="flex items-center gap-5 sm:gap-6">
          {shouldAskUsername && enableRegister && (
            <button
              type='button'
              onClick={() => {
                setIsRegisterMode(!isRegisterMode);
                setError(null);
              }}
              className='text-[15px] font-bold text-gray-500 hover:text-black dark:text-gray-400 dark:hover:text-white transition-colors'
            >
              {isRegisterMode ? 'Sign in' : 'Sign up'}
            </button>
          )}
        </div>
      </header>

      {/* 中部核心表单区（沉浸式无边框） */}
      <main className="flex-1 flex items-center justify-center px-6 w-full">
        <div className='w-full max-w-[340px] sm:max-w-[380px]'>
          
          {/* 极简标题 */}
          <div className="mb-10 text-center">
            <h1 className={`text-3xl sm:text-4xl font-black text-gray-900 dark:text-white tracking-tight ${isRegisterMode ? 'mb-2' : ''}`}>
              {isRegisterMode ? 'Sign up' : 'Sign in'}
            </h1>
            {isRegisterMode && (
              <div className="flex flex-col items-center gap-1.5 mt-3">
                <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">
                  Registration by invitation code only
                </p>
                <p className="text-gray-400 dark:text-gray-500 text-xs">
                  Request an invite: <a href="mailto:admin@400821.xyz" className="text-gray-700 dark:text-gray-300 hover:text-black dark:hover:text-white transition-colors underline underline-offset-2">admin@400821.xyz</a>
                </p>
              </div>
            )}
          </div>

          <form onSubmit={onSubmit} className='space-y-4 sm:space-y-5'>
            {/* 用户名输入框 */}
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
                    className='block w-full pl-12 pr-6 py-4 bg-gray-100 dark:bg-zinc-900 border border-transparent rounded-full text-[15px] font-medium focus:border-black dark:focus:border-white focus:ring-0 focus:bg-white dark:focus:bg-black outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 transition-all'
                    placeholder='Username'
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* 密码输入框 */}
            <div>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400 group-focus-within:text-gray-900 dark:group-focus-within:text-white transition-colors" />
                </div>
                <input
                  id='password'
                  type='password'
                  autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
                  className='block w-full pl-12 pr-6 py-4 bg-gray-100 dark:bg-zinc-900 border border-transparent rounded-full text-[15px] font-medium focus:border-black dark:focus:border-white focus:ring-0 focus:bg-white dark:focus:bg-black outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 transition-all'
                  placeholder='Password'
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            {/* 注册模式下的邀请码输入框 */}
            {isRegisterMode && shouldAskUsername && enableRegister && requireInviteCode && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                    <ShieldCheck className="h-5 w-5 text-gray-400 group-focus-within:text-gray-900 dark:group-focus-within:text-white transition-colors" />
                  </div>
                  <input
                    id='inviteCode'
                    type='text'
                    className='block w-full pl-12 pr-6 py-4 bg-gray-100 dark:bg-zinc-900 border border-transparent rounded-full text-[15px] font-medium focus:border-black dark:focus:border-white focus:ring-0 focus:bg-white dark:focus:bg-black outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 transition-all'
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

            {/* 纯黑主操作按钮：Continue */}
            <button
              type='submit'
              disabled={!password || loading || (shouldAskUsername && !username)}
              className='w-full flex items-center justify-center gap-2 py-4 mt-2 rounded-full bg-black hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-200 text-white dark:text-black text-[15px] font-bold transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed'
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
              ) : (
                'Continue'
              )}
            </button>
          </form>
        </div>
      </main>

      {/* 底部 Footer：Logo 与 用户协议 */}
      <footer className="w-full pb-8 pt-4 flex flex-col items-center justify-center gap-4 shrink-0">
        <div className="w-16 h-16 flex items-center justify-center pointer-events-none select-none">
          <img 
            src="/logo.png" 
            alt="Logo" 
            className="w-full h-full object-contain drop-shadow-sm dark:drop-shadow-none" 
            onError={(e) => e.currentTarget.style.display = 'none'} 
          />
        </div>
        <div className="text-[11px] font-semibold tracking-wide text-gray-400 dark:text-gray-600 flex items-center gap-2.5 uppercase">
          <a href="#" className="hover:text-black dark:hover:text-white transition-colors cursor-pointer">Terms of Service</a>
          <span className="opacity-50">|</span>
          <a href="#" className="hover:text-black dark:hover:text-white transition-colors cursor-pointer">Privacy Policy</a>
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
