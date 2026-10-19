/* eslint-disable no-console */

'use client';

import { LogOut, User, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface UserInfo {
  authenticated: boolean;
  username?: string;
  role?: 'owner' | 'admin' | 'user';
  group?: string | null;
  groupEnabled?: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  owner: '站长',
  admin: '管理员',
  user: '普通用户',
};

export const UserCenterButton: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [info, setInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 打开时锁定背景滚动
  useEffect(() => {
    if (!isOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [isOpen]);

  const handleOpen = async () => {
    setIsOpen(true);
    setLoading(true);
    try {
      const res = await fetch('/api/me', { cache: 'no-store' });
      setInfo(res.ok ? await res.json() : { authenticated: false });
    } catch (error) {
      console.error('获取用户信息失败:', error);
      setInfo({ authenticated: false });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      // 调用注销API来清除cookie
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('注销请求失败:', error);
    }
    window.location.reload();
  };

  const groupText = !info?.authenticated
    ? '—'
    : info.role === 'owner'
    ? '不受限制'
    : info.group || (info.groupEnabled ? '未分组' : '默认');

  const rows: { label: string; value: string }[] = [
    { label: '用户名', value: info?.authenticated ? info.username || '—' : '—' },
    {
      label: '用户级别',
      value: info?.authenticated ? ROLE_LABEL[info.role || 'user'] : '—',
    },
    { label: '所属分组', value: groupText },
  ];

  const panel = (
    <>
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={() => setIsOpen(false)}
      />
      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-sm bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] p-6'>
        <div className='flex items-center justify-between mb-5'>
          <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
            用户中心
          </h3>
          <button
            onClick={() => setIsOpen(false)}
            className='w-8 h-8 p-1 rounded-full text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors'
            aria-label='Close'
          >
            <X className='w-full h-full' />
          </button>
        </div>

        <div className='divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'>
          {rows.map((row) => (
            <div
              key={row.label}
              className='flex items-center justify-between gap-4 px-4 py-3'
            >
              <span className='text-sm text-gray-500 dark:text-gray-400'>
                {row.label}
              </span>
              {loading ? (
                <span className='h-4 w-20 rounded bg-gray-200 animate-pulse dark:bg-gray-700' />
              ) : (
                <span className='text-sm font-medium text-gray-800 dark:text-gray-200 break-all text-right'>
                  {row.value}
                </span>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className='mt-5 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-red-600 border border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/20 disabled:opacity-60 transition-colors'
        >
          <LogOut className='w-4 h-4' />
          退出登录
        </button>
      </div>
    </>
  );

  return (
    <>
      <button
        onClick={handleOpen}
        className='w-10 h-10 p-2 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors'
        aria-label='User Center'
        title='用户中心'
      >
        <User className='w-full h-full' />
      </button>

      {isOpen && mounted && createPortal(panel, document.body)}
    </>
  );
};
