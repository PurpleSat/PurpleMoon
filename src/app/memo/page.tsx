'use client';

import { useEffect, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import PageLayout from '@/components/PageLayout';
import { Memo } from '@/lib/types';

export default function MemoPage() {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(true);

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
    if (!inputValue.trim()) return;
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
    return `${d.getMonth() + 1}-${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <PageLayout activePath="/memo">
      <div className="flex flex-col gap-6 py-6 px-5 lg:px-[3rem] 2xl:px-20 max-w-4xl mx-auto min-h-[calc(100vh-80px)]">
        
        {/* 顶部标题与输入框 (复用搜索框设计风格) */}
        <div className="flex flex-col gap-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            📝 我的随手记
          </h1>
          
          <div className="relative group flex items-center w-full bg-white dark:bg-gray-800/80 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden focus-within:ring-2 focus-within:ring-green-500/50 focus-within:border-green-500 transition-all">
            <input
              type="text"
              className="flex-1 bg-transparent px-5 py-4 text-base text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none"
              placeholder="记录点什么吧... (按回车保存)"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddMemo()}
            />
            <button
              onClick={handleAddMemo}
              disabled={!inputValue.trim()}
              className="px-6 py-4 bg-green-500 hover:bg-green-600 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              保存
            </button>
          </div>
        </div>

        {/* 便利贴内容区 (类似搜索历史标签池) */}
        <div className="mt-4">
          {loading ? (
            <div className="text-gray-400 text-sm animate-pulse">加载中...</div>
          ) : memos.length === 0 ? (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500 bg-white/50 dark:bg-gray-800/30 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
              <span className="text-3xl mb-2 block">📭</span>
              还没有任何记录，快来写下第一条随手记吧
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {memos.map((memo) => (
                <div 
                  key={memo.id} 
                  className="group relative bg-white dark:bg-[#1E232D] p-5 rounded-2xl border border-gray-100 dark:border-white/5 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between"
                >
                  <p className="text-gray-700 dark:text-gray-300 text-base leading-relaxed break-words whitespace-pre-wrap">
                    {memo.content}
                  </p>
                  
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100 dark:border-gray-700/50">
                    <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">
                      {formatDate(memo.created_at)}
                    </span>
                    <button
                      onClick={() => handleDelete(memo.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                      title="删除"
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
