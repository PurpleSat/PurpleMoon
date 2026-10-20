import { NextResponse } from 'next/server';

/**
 * 本地存储模式（localstorage）下没有服务端数据库：
 * 播放记录 / 收藏 / 搜索历史 / 跳过片头片尾 / 便签这些接口在该模式下没有可用的存储对象。
 * 以前直接解引用 null 抛 TypeError，返回含糊的 500；现在明确返回 400，前端据此提示或回退到浏览器本地存储。
 */
export function rejectIfLocalStorageMode(): NextResponse | null {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType !== 'localstorage') return null;
  return NextResponse.json(
    { error: '当前为本地存储模式，该功能仅在数据库模式下可用' },
    { status: 400 }
  );
}
