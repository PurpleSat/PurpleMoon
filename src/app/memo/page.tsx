'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { Trash2, PenLine, Plus, ArrowUp } from 'lucide-react';

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

  // 根据内容自动调整 textarea 高度
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
        // 保存成功后输入框高度会因为 inputValue 清空而自动复原
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
      {/* pb-36 预留底部悬浮输入框的空间，防止挡住最后一张便利贴 */}
      <div className="flex flex-col gap-8 pt-8 pb-36 px-5 lg:px-[3rem] 2xl:px-20 max-w-6xl mx-auto min-h-[calc(100vh-80px)] relative">
        
        {/* 顶部标题 */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
            <span className="p-2 bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400 rounded-xl">
              <PenLine size={24} />
            </span>
            紫月纪
          </h1>
          <div className="text-sm text-gray-500 dark:text-gray-400 font-medium bg-gray-100 dark:bg-gray-800 px-4 py-1.5 rounded-full">
            共 {memos.length} 条记录
          </div>
        </div>

        {/* 瀑布流卡片区 (移至上方) */}
        <div className="mt-2">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-gray-100 dark:bg-gray-800/50 h-40 rounded-2xl animate-pulse"></div>
              ))}
            </div>
          ) : memos.length === 0 ? (
            <div className="text-center py-32">
              <span className="text-6xl mb-4 block opacity-30 grayscale filter">📝</span>
              <p className="text-gray-500 dark:text-gray-400 text-lg font-medium">一切伟大的构想，都源于一次随手记...</p>
            </div>
          ) : (
            <div className="columns-1 sm:columns-2 lg:columns-3 gap-6 space-y-6">
              {memos.map((memo) => (
                <div 
                  key={memo.id} 
                  className="break-inside-avoid group relative bg-white dark:bg-[#1E232D] p-6 rounded-2xl border border-gray-100 dark:border-gray-700/50 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col hover:border-green-500/30 dark:hover:border-green-500/30"
                >
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

      {/* ========================================================================= */}
      {/* 【重构】：底部悬浮对话式输入框 (Gemini 风格) */}
      {/* ========================================================================= */}
      <div className="fixed bottom-6 left-0 right-0 z-40 px-4 pointer-events-none flex flex-col items-center">
        {/* 输入框主容器 */}
        <div className="w-full max-w-4xl bg-white/90 dark:bg-[#1E232D]/95 backdrop-blur-xl rounded-[32px] shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.6)] border border-gray-200 dark:border-gray-700/80 p-2 flex items-end gap-2 transition-all duration-300 focus-within:shadow-[0_8px_40px_rgb(0,0,0,0.12)] focus-within:border-gray-300 dark:focus-within:border-gray-600 pointer-events-auto">
          
          {/* 左侧加号图标 (对齐 Gemini 风格) */}
          <button className="p-2.5 ml-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors flex-shrink-0 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800">
            <Plus size={24} strokeWidth={2.5} />
          </button>

          {/* 自适应高度的多行文本框 */}
          <textarea
            ref={textareaRef}
            rows={1}
            className="flex-1 max-h-[160px] bg-transparent outline-none resize-none py-3 px-2 text-base text-gray-900 dark:text-gray-100 placeholder-gray-500 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-300 dark:[&::-webkit-scrollbar-thumb]:bg-gray-600 [&::-webkit-scrollbar-thumb]:rounded-full"
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

          {/* 右侧发送按钮 (有文字时高亮亮起) */}
          <button
            onClick={handleAddMemo}
            disabled={!inputValue.trim() || isSubmitting}
            className={`p-2.5 mr-1 rounded-full transition-all duration-300 flex-shrink-0 ${
              inputValue.trim() 
                ? 'bg-black text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200 shadow-md transform active:scale-95' 
                : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600'
            }`}
          >
            <ArrowUp size={22} strokeWidth={2.5} />
          </button>
        </div>
        
        {/* 底部快捷键提示 (细微辅助语) */}
        <div className="mt-2 text-[11px] text-gray-400 dark:text-gray-500 pointer-events-auto tracking-wide">
          按 <span className="font-semibold">Enter</span> 保存记录，<span className="font-semibold">Shift + Enter</span> 换行
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
