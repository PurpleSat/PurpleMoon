export const ClientCache = {
  async get(key: string) {
    if (typeof window === 'undefined') return null;
    const itemStr = localStorage.getItem(key);
    if (!itemStr) return null;
    try {
      const item = JSON.parse(itemStr);
      if (Date.now() > item.expiry) {
        localStorage.removeItem(key);
        return null;
      }
      return item.value;
    } catch {
      return null;
    }
  },
  async set(key: string, value: any, ttlMinutes: number) {
    if (typeof window === 'undefined') return;
    const item = {
      value,
      expiry: Date.now() + ttlMinutes * 60 * 1000,
    };
    localStorage.setItem(key, JSON.stringify(item));
  }
};