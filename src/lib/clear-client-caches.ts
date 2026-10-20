/**
 * 退出登录时清空浏览器里的 Cache Storage（Service Worker 缓存）。
 * 共用设备上，上一位用户的页面/接口缓存不应留给下一位用户。
 * 任何失败都忽略：不能因为清缓存失败而影响退出流程。
 */
export async function clearClientCaches(): Promise<void> {
  try {
    if (typeof window === 'undefined' || !('caches' in window)) return;
    const keys = await window.caches.keys();
    await Promise.all(keys.map((k) => window.caches.delete(k)));
  } catch {
    // ignore
  }
}
