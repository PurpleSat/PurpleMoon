/**
 * 退出登录时清空浏览器里的 Cache Storage（Service Worker 缓存）以及当前用户的本地混合缓存（localStorage）。
 * 共用设备上，上一位用户的页面/接口缓存不应留给下一位用户。
 * 任何失败都忽略：不能因为清缓存失败而影响退出流程。
 */
export async function clearClientCaches(): Promise<void> {
  try {
    if (typeof window === 'undefined') return;

    // 清理 localStorage 中所有 moontv_cache_* 用户缓存
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith('moontv_cache_')) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach((k) => window.localStorage.removeItem(k));
    } catch {
      // ignore localStorage errors
    }

    if ('caches' in window) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((k) => window.caches.delete(k)));
    }
  } catch {
    // ignore
  }
}
