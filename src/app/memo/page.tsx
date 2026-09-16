'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

import PageLayout from '@/components/PageLayout';
import { Memo } from '@/lib/types';

function MemoPageClient() {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // 用于自动调整输入框高度的 Ref
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // 根据内容自动调整 textarea 高度 (在常规文档流中会自动向下撑开)
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto'; // 重置高度以重新计算
      // 限制最大高度约 6 行 (每行约 24px，加上 padding，限制在 160px 左右)
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    }
  }, [inputValue]);

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
      <div className="flex flex-col gap-6 pt-8 pb-16 px-5 lg:px-[3rem] 2xl:px-20 max-w-6xl mx-auto min-h-[calc(100vh-80px)]">
        
        {/* ========================================================================= */}
        {/* 【重构】：极简输入框 (左侧数量、右侧Logo，垂直居中、向下生长) */}
        {/* ========================================================================= */}
        <div className="w-full flex flex-col items-center z-20 mt-2">
          <div className="w-full max-w-4xl bg-white dark:bg-[#1E232D] rounded-[32px] shadow-[0_8px_30px_rgb(0,0,0,0.06)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.4)] p-2 flex items-center gap-1 transition-all duration-300 focus-within:shadow-[0_8px_40px_rgb(0,0,0,0.12)] dark:focus-within:shadow-[0_8px_40px_rgb(0,0,0,0.6)]">
            
            {/* 左侧：记录数量展示 */}
            <div className="pl-4 sm:pl-5 pr-1 flex-shrink-0 select-none flex items-center">
              <span className="text-sm font-medium text-gray-400 dark:text-gray-500 whitespace-nowrap">
                {memos.length} 条
              </span>
            </div>

            {/* ========================================================================= */}
            {/* 【核心修复】：增加 border-0 focus:ring-0 focus:border-transparent 强制抹除插件样式 */}
            {/* ========================================================================= */}
            <textarea
              ref={textareaRef}
              rows={1}
              className="flex-1 max-h-[160px] bg-transparent border-0 focus:ring-0 focus:border-transparent outline-none resize-none py-3 px-3 text-base text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-200 dark:[&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-thumb]:rounded-full"
              placeholder="记录点什么吧..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                // 聊天式快捷键：Enter 直接发送，Shift + Enter 换行
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleAddMemo();
                }
              }}
            />

            {/* 右侧：Logo 替换发送按钮 */}
            <button
              onClick={handleAddMemo}
              disabled={!inputValue.trim() || isSubmitting}
              title="保存记录"
              className={`p-1 mr-2 rounded-full transition-all duration-300 flex-shrink-0 ${
                inputValue.trim() && !isSubmitting
                  ? 'hover:scale-110 active:scale-95 opacity-100 drop-shadow-md cursor-pointer' 
                  : 'opacity-40 grayscale cursor-not-allowed'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img 
                src="/logo.png" 
                alt="Logo 保存" 
                className={`w-9 h-9 object-contain transition-transform ${isSubmitting ? 'animate-pulse' : ''}`} 
              />
            </button>
          </div>
          
          {/* 快捷键提示 */}
          <div className="mt-3 text-[11px] text-gray-400 dark:text-gray-500 tracking-wide select-none">
            按 <span className="font-semibold">Enter</span> 保存，<span className="font-semibold">Shift + Enter</span> 换行
          </div>
        </div>
        {/* ========================================================================= */}

        {/* ========================================================================= */}
        {/* 【重构】：纵向逐条显示区 (与上方输入框 max-w-4xl 同宽居中) */}
        {/* ========================================================================= */}
        <div className="mt-4 w-full max-w-4xl mx-auto">
          {loading ? (
            <div className="flex flex-col gap-5">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-gray-100 dark:bg-gray-800/50 h-32 rounded-2xl animate-pulse"></div>
              ))}
            </div>
          ) : memos.length === 0 ? (
            <div className="text-center py-24">
              <span className="text-6xl mb-4 block opacity-30 grayscale filter">📝</span>
              <p className="text-gray-500 dark:text-gray-400 text-lg font-medium">还没有任何记录，开始写下你的第一条随手记吧</p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {memos.map((memo) => (
                <div 
                  key={memo.id} 
                  className="group relative bg-white dark:bg-[#1E232D] p-5 sm:p-6 rounded-2xl shadow-sm hover:shadow-md border border-gray-100 dark:border-gray-700/50 transition-all duration-300 flex flex-col"
                >
                  <div className="max-h-[350px] overflow-y-auto pr-2 mb-4 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-200 dark:[&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-thumb]:rounded-full">
                    <p className="text-gray-700 dark:text-gray-300 text-[15px] leading-relaxed break-words whitespace-pre-wrap">
                      {memo.content}
                    </p>
                  </div>
                  
                  <div className="flex items-center justify-between mt-auto pt-4 border-t border-gray-50 dark:border-gray-700/50">
                    <span className="text-xs text-gray-400 dark:text-gray-500 font-mono tracking-wider">
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
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-[#0F111A]">
        <div className="w-16 h-16 border-4 border-gray-900 dark:border-white border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <MemoPageClient />
    </Suspense>
  );
}
