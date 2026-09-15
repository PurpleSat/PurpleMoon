'use client';

import { Suspense, useEffect, useState } from 'react';
import { Trash2, PenLine } from 'lucide-react';

import PageLayout from '@/components/PageLayout';
import { Memo } from '@/lib/types';

function MemoPageClient() {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 获取便利贴
  const fetchMemos = async () => {
    try {
      const res = await fetch('/api/memos');
      if (res.ok) {
        const data = await res.json();
        setMemos(data.memos || []);
      }
    } catch (e) {
      console.error('获取便利贴失败', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMemos();
  }, []);

  // 添加便利贴
  const handleAddMemo = async () => {
    if (!inputValue.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/memos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: inputValue }),
      });
      if (res.ok) {
        setInputValue('');
        fetchMemos(); // 重新拉取最新列表
      }
    } catch (e) {
      console.error('添加失败', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 删除便利贴
  const handleDelete = async (id: number) => {
    try {
      const res = await fetch('/api/memos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setMemos((prev) => prev.filter((m) => m.id !== id));
      }
    } catch (e) {
      console.error('删除失败', e);
    }
  };

  // 格式化时间戳
  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <PageLayout activePath="/memo">
      <div className="flex flex-col gap-8 py-8 px-5 lg:px-[3rem] 2xl:px-20 max-w-6xl mx-auto min-h-[calc(100vh-80px)]">
        
        {/* 顶部标题 */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
            <span className="p-2 bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400 rounded-xl">
              <PenLine size={24} />
            </span>
            随手记
          </h1>
          <div className="text-sm text-gray-500 dark:text-gray-400 font-medium bg-gray-100 dark:bg-gray-800 px-4 py-1.5 rounded-full">
            共 {memos.length} 条记录
          </div>
        </div>

        {/* 输入区 (升级为多行文本框) */}
        <div className="w-full bg-white dark:bg-[#1E232D] rounded-2xl shadow-md hover:shadow-lg border border-gray-200 dark:border-white/5 overflow-hidden transition-all duration-300 focus-within:ring-2 focus-within:ring-green-500/50 focus-within:border-green-500">
          <textarea
            className="w-full bg-transparent px-6 py-5 text-base text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none resize-none min-h-[140px] leading-relaxed [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-gray-200 dark:[&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-thumb]:rounded-full"
            placeholder="今天有什么灵感或待办？写在这里吧..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              // 多行文本框需要用 Ctrl/Cmd + Enter 快捷保存，单独的 Enter 留作正常换行
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleAddMemo();
              }
            }}
          />
          <div className="flex justify-between items-center px-5 py-3 bg-gray-50 dark:bg-black/20 border-t border-gray-100 dark:border-white/5">
            <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:block">
              提示：按 <kbd className="bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-300">Ctrl</kbd> + <kbd className="bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-300">Enter</kbd> 快捷保存
            </span>
            <span className="text-xs text-gray-400 sm:hidden">
              {inputValue.length} 字
            </span>
            <button
              onClick={handleAddMemo}
              disabled={!inputValue.trim() || isSubmitting}
              className="px-6 py-2 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white text-sm font-semibold rounded-lg transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transform active:scale-95"
            >
              {isSubmitting ? '保存中...' : '保存记录'}
            </button>
          </div>
        </div>

        {/* 瀑布流卡片区 */}
        <div className="mt-2">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-gray-100 dark:bg-gray-800/50 h-40 rounded-2xl animate-pulse"></div>
              ))}
            </div>
          ) : memos.length === 0 ? (
            <div className="text-center py-20 bg-white/50 dark:bg-[#1E232D]/50 rounded-3xl border border-dashed border-gray-300 dark:border-gray-700">
              <span className="text-5xl mb-4 block opacity-50">📭</span>
              <p className="text-gray-500 dark:text-gray-400 text-lg font-medium">还没有任何记录，开始写下你的第一条便利贴吧</p>
            </div>
          ) : (
            // 【核心修改】：使用 columns-X 替代 grid，实现完美瀑布流布局
            <div className="columns-1 sm:columns-2 lg:columns-3 gap-6 space-y-6">
              {memos.map((memo) => (
                <div 
                  key={memo.id} 
                  // break-inside-avoid 防止卡片在瀑布流中被从中间截断
                  className="break-inside-avoid group relative bg-white dark:bg-[#1E232D] p-6 rounded-2xl border border-gray-100 dark:border-white/5 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col"
                >
                  {/* 【核心修改】：限制最大高度，超长文本内部滚动，配合隐形滚动条 */}
                  <div className="max-h-[350px] overflow-y-auto pr-2 mb-4 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-200 dark:[&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-thumb]:rounded-full">
                    <p className="text-gray-700 dark:text-gray-300 text-[15px] leading-relaxed break-words whitespace-pre-wrap">
                      {memo.content}
                    </p>
                  </div>
                  
                  <div className="flex items-center justify-between mt-auto pt-4 border-t border-gray-100 dark:border-gray-700/50">
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 font-mono tracking-wider">
                      {formatDate(memo.created_at)}
                    </span>
                    <button
                      onClick={() => handleDelete(memo.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                      title="删除这条记录"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </PageLayout>
  );
}

export default function MemoPage() {
  // Suspense 包裹以兼容 Next.js App Router 的服务端渲染逻辑
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-[#0F111A]">
        <div className="w-16 h-16 border-4 border-green-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <MemoPageClient />
    </Suspense>
  );
}
