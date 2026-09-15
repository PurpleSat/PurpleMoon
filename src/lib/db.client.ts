/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-function */
'use client';

/**
 * 仅在浏览器端使用的数据库工具。
 * 支持 D1/Upstash/Redis 等存储模式的乐观更新与混合缓存。
 */

import { getAuthInfoFromBrowserCookie } from './auth';

// ---- 类型 ----
export interface PlayRecord {
  title: string;
  source_name: string;
  year: string;
  cover: string;
  index: number; 
  total_episodes: number; 
  play_time: number; 
  total_time: number; 
  save_time: number; 
  search_title?: string; 
}

export interface Favorite {
  title: string;
  source_name: string;
  year: string;
  cover: string;
  total_episodes: number;
  save_time: number;
  search_title?: string;
}

// 【新增】：跳过片头片尾配置类型
export interface SkipConfig {
  enable: boolean;
  intro_time: number;
  outro_time: number;
}

// ---- 缓存数据结构 ----
interface CacheData<T> {
  data: T;
  timestamp: number;
  version: string;
}

interface UserCacheStore {
  playRecords?: CacheData<Record<string, PlayRecord>>;
  favorites?: CacheData<Record<string, Favorite>>;
  searchHistory?: CacheData<string[]>;
  skipConfigs?: CacheData<Record<string, SkipConfig>>; // 【新增】
}

// ---- 常量 ----
const PLAY_RECORDS_KEY = 'moontv_play_records';
const FAVORITES_KEY = 'moontv_favorites';
const SEARCH_HISTORY_KEY = 'moontv_search_history';
const SKIP_CONFIG_KEY = 'moontv_skip_config'; // 【新增】

// 缓存相关常量
const CACHE_PREFIX = 'moontv_cache_';
const CACHE_VERSION = '1.0.0';
const CACHE_EXPIRE_TIME = 60 * 60 * 1000; 

// ---- 环境变量 ----
const STORAGE_TYPE = (() => {
  const raw =
    (typeof window !== 'undefined' &&
      (window as any).RUNTIME_CONFIG?.STORAGE_TYPE) ||
    (process.env.STORAGE_TYPE as
      | 'localstorage'
      | 'redis'
      | 'd1'
      | 'upstash'
      | undefined) ||
    'localstorage';
  return raw;
})();

const SEARCH_HISTORY_LIMIT = 20;

// ---- 缓存管理器 ----
class HybridCacheManager {
  private static instance: HybridCacheManager;

  static getInstance(): HybridCacheManager {
    if (!HybridCacheManager.instance) {
      HybridCacheManager.instance = new HybridCacheManager();
    }
    return HybridCacheManager.instance;
  }

  private getCurrentUsername(): string | null {
    const authInfo = getAuthInfoFromBrowserCookie();
    return authInfo?.username || null;
  }

  private getUserCacheKey(username: string): string {
    return `${CACHE_PREFIX}${username}`;
  }

  private getUserCache(username: string): UserCacheStore {
    if (typeof window === 'undefined') return {};

    try {
      const cacheKey = this.getUserCacheKey(username);
      const cached = localStorage.getItem(cacheKey);
      return cached ? JSON.parse(cached) : {};
    } catch (error) {
      console.warn('获取用户缓存失败:', error);
      return {};
    }
  }

  private saveUserCache(username: string, cache: UserCacheStore): void {
    if (typeof window === 'undefined') return;

    try {
      const cacheKey = this.getUserCacheKey(username);
      localStorage.setItem(cacheKey, JSON.stringify(cache));
    } catch (error) {
      console.warn('保存用户缓存失败:', error);
    }
  }

  private isCacheValid<T>(cache: CacheData<T>): boolean {
    const now = Date.now();
    return (
      cache.version === CACHE_VERSION &&
      now - cache.timestamp < CACHE_EXPIRE_TIME
    );
  }

  private createCacheData<T>(data: T): CacheData<T> {
    return {
      data,
      timestamp: Date.now(),
      version: CACHE_VERSION,
    };
  }

  getCachedPlayRecords(): Record<string, PlayRecord> | null {
    const username = this.getCurrentUsername();
    if (!username) return null;
    const userCache = this.getUserCache(username);
    const cached = userCache.playRecords;
    if (cached && this.isCacheValid(cached)) return cached.data;
    return null;
  }

  cachePlayRecords(data: Record<string, PlayRecord>): void {
    const username = this.getCurrentUsername();
    if (!username) return;
    const userCache = this.getUserCache(username);
    userCache.playRecords = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  getCachedFavorites(): Record<string, Favorite> | null {
    const username = this.getCurrentUsername();
    if (!username) return null;
    const userCache = this.getUserCache(username);
    const cached = userCache.favorites;
    if (cached && this.isCacheValid(cached)) return cached.data;
    return null;
  }

  cacheFavorites(data: Record<string, Favorite>): void {
    const username = this.getCurrentUsername();
    if (!username) return;
    const userCache = this.getUserCache(username);
    userCache.favorites = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  getCachedSearchHistory(): string[] | null {
    const username = this.getCurrentUsername();
    if (!username) return null;
    const userCache = this.getUserCache(username);
    const cached = userCache.searchHistory;
    if (cached && this.isCacheValid(cached)) return cached.data;
    return null;
  }

  cacheSearchHistory(data: string[]): void {
    const username = this.getCurrentUsername();
    if (!username) return;
    const userCache = this.getUserCache(username);
    userCache.searchHistory = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  // 【新增】：跳过片头配置缓存
  getCachedSkipConfigs(): Record<string, SkipConfig> | null {
    const username = this.getCurrentUsername();
    if (!username) return null;
    const userCache = this.getUserCache(username);
    const cached = userCache.skipConfigs;
    if (cached && this.isCacheValid(cached)) return cached.data;
    return null;
  }

  cacheSkipConfigs(data: Record<string, SkipConfig>): void {
    const username = this.getCurrentUsername();
    if (!username) return;
    const userCache = this.getUserCache(username);
    userCache.skipConfigs = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  clearUserCache(username?: string): void {
    const targetUsername = username || this.getCurrentUsername();
    if (!targetUsername) return;
    try {
      const cacheKey = this.getUserCacheKey(targetUsername);
      localStorage.removeItem(cacheKey);
    } catch (error) {
      console.warn('清除用户缓存失败:', error);
    }
  }

  clearExpiredCaches(): void {
    if (typeof window === 'undefined') return;
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(CACHE_PREFIX)) {
          try {
            const cache = JSON.parse(localStorage.getItem(key) || '{}');
            let hasValidData = false;
            for (const [, cacheData] of Object.entries(cache)) {
              if (cacheData && this.isCacheValid(cacheData as CacheData<any>)) {
                hasValidData = true;
                break;
              }
            }
            if (!hasValidData) keysToRemove.push(key);
          } catch {
            keysToRemove.push(key);
          }
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      console.warn('清除过期缓存失败:', error);
    }
  }
}

const cacheManager = HybridCacheManager.getInstance();

async function handleDatabaseOperationFailure(
  dataType: 'playRecords' | 'favorites' | 'searchHistory' | 'skipConfig',
  error: any
): Promise<void> {
  console.error(`数据库操作失败 (${dataType}):`, error);

  try {
    let freshData: any;
    let eventName: string;

    switch (dataType) {
      case 'playRecords':
        freshData = await fetchFromApi<Record<string, PlayRecord>>(`/api/playrecords`);
        cacheManager.cachePlayRecords(freshData);
        eventName = 'playRecordsUpdated';
        break;
      case 'favorites':
        freshData = await fetchFromApi<Record<string, Favorite>>(`/api/favorites`);
        cacheManager.cacheFavorites(freshData);
        eventName = 'favoritesUpdated';
        break;
      case 'searchHistory':
        freshData = await fetchFromApi<string[]>(`/api/searchhistory`);
        cacheManager.cacheSearchHistory(freshData);
        eventName = 'searchHistoryUpdated';
        break;
      case 'skipConfig':
        freshData = await fetchFromApi<Record<string, SkipConfig>>(`/api/skipconfig`);
        cacheManager.cacheSkipConfigs(freshData);
        eventName = 'skipConfigUpdated';
        break;
    }

    window.dispatchEvent(
      new CustomEvent(eventName, {
        detail: freshData,
      })
    );
  } catch (refreshErr) {
    console.error(`刷新${dataType}缓存失败:`, refreshErr);
  }
}

if (typeof window !== 'undefined') {
  setTimeout(() => cacheManager.clearExpiredCaches(), 1000);
}

async function fetchFromApi<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`请求 ${path} 失败: ${res.status}`);
  return (await res.json()) as T;
}

export function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}

// ============================================================================
// 原有 API 路由保持不变 (getAllPlayRecords, savePlayRecord, deletePlayRecord, isFavorited, 等)
// ============================================================================
export async function getAllPlayRecords(): Promise<Record<string, PlayRecord>> {
  if (typeof window === 'undefined') return {};
  if (STORAGE_TYPE !== 'localstorage') {
    const cachedData = cacheManager.getCachedPlayRecords();
    if (cachedData) {
      fetchFromApi<Record<string, PlayRecord>>(`/api/playrecords`)
        .then((freshData) => {
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cachePlayRecords(freshData);
            window.dispatchEvent(new CustomEvent('playRecordsUpdated', { detail: freshData }));
          }
        }).catch((err) => console.warn('后台同步失败:', err));
      return cachedData;
    } else {
      try {
        const freshData = await fetchFromApi<Record<string, PlayRecord>>(`/api/playrecords`);
        cacheManager.cachePlayRecords(freshData);
        return freshData;
      } catch (err) { return {}; }
    }
  }
  try {
    const raw = localStorage.getItem(PLAY_RECORDS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export async function savePlayRecord(source: string, id: string, record: PlayRecord): Promise<void> {
  const key = generateStorageKey(source, id);
  if (STORAGE_TYPE !== 'localstorage') {
    const cachedRecords = cacheManager.getCachedPlayRecords() || {};
    cachedRecords[key] = record;
    cacheManager.cachePlayRecords(cachedRecords);
    window.dispatchEvent(new CustomEvent('playRecordsUpdated', { detail: cachedRecords }));
    try {
      const res = await fetch('/api/playrecords', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, record }) });
      if (!res.ok) throw new Error(`保存失败: ${res.status}`);
    } catch (err) { await handleDatabaseOperationFailure('playRecords', err); throw err; }
    return;
  }
  if (typeof window === 'undefined') return;
  const allRecords = await getAllPlayRecords();
  allRecords[key] = record;
  localStorage.setItem(PLAY_RECORDS_KEY, JSON.stringify(allRecords));
  window.dispatchEvent(new CustomEvent('playRecordsUpdated', { detail: allRecords }));
}

export async function deletePlayRecord(source: string, id: string): Promise<void> {
  const key = generateStorageKey(source, id);
  if (STORAGE_TYPE !== 'localstorage') {
    const cachedRecords = cacheManager.getCachedPlayRecords() || {};
    delete cachedRecords[key];
    cacheManager.cachePlayRecords(cachedRecords);
    window.dispatchEvent(new CustomEvent('playRecordsUpdated', { detail: cachedRecords }));
    try {
      const res = await fetch(`/api/playrecords?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`删除失败: ${res.status}`);
    } catch (err) { await handleDatabaseOperationFailure('playRecords', err); throw err; }
    return;
  }
  if (typeof window === 'undefined') return;
  const allRecords = await getAllPlayRecords();
  delete allRecords[key];
  localStorage.setItem(PLAY_RECORDS_KEY, JSON.stringify(allRecords));
  window.dispatchEvent(new CustomEvent('playRecordsUpdated', { detail: allRecords }));
}

export async function getSearchHistory(): Promise<string[]> {
  if (typeof window === 'undefined') return [];
  if (STORAGE_TYPE !== 'localstorage') {
    const cachedData = cacheManager.getCachedSearchHistory();
    if (cachedData) {
      fetchFromApi<string[]>(`/api/searchhistory`)
        .then((freshData) => {
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheSearchHistory(freshData);
            window.dispatchEvent(new CustomEvent('searchHistoryUpdated', { detail: freshData }));
          }
        }).catch((err) => console.warn('同步失败:', err));
      return cachedData;
    } else {
      try {
        const freshData = await fetchFromApi<string[]>(`/api/searchhistory`);
        cacheManager.cacheSearchHistory(freshData);
        return freshData;
      } catch { return []; }
    }
  }
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export async function addSearchHistory(keyword: string): Promise<void> {
  const trimmed = keyword.trim();
  if (!trimmed) return;
  if (STORAGE_TYPE !== 'localstorage') {
    const cachedHistory = cacheManager.getCachedSearchHistory() || [];
    const newHistory = [trimmed, ...cachedHistory.filter((k) => k !== trimmed)];
    if (newHistory.length > SEARCH_HISTORY_LIMIT) newHistory.length = SEARCH_HISTORY_LIMIT;
    cacheManager.cacheSearchHistory(newHistory);
    window.dispatchEvent(new CustomEvent('searchHistoryUpdated', { detail: newHistory }));
    try {
      await fetch('/api/searchhistory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: trimmed }) });
    } catch (err) { await handleDatabaseOperationFailure('searchHistory', err); }
    return;
  }
  if (typeof window === 'undefined') return;
  const history = await getSearchHistory();
  const newHistory = [trimmed, ...history.filter((k) => k !== trimmed)];
  if (newHistory.length > SEARCH_HISTORY_LIMIT) newHistory.length = SEARCH_HISTORY_LIMIT;
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(newHistory));
  window.dispatchEvent(new CustomEvent('searchHistoryUpdated', { detail: newHistory }));
}

export async function clearSearchHistory(): Promise<void> {
  if (STORAGE_TYPE !== 'localstorage') {
    cacheManager.cacheSearchHistory([]);
    window.dispatchEvent(new CustomEvent('searchHistoryUpdated', { detail: [] }));
    try { await fetch(`/api/searchhistory`, { method: 'DELETE' }); } catch (err) { await handleDatabaseOperationFailure('searchHistory', err); }
    return;
  }
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SEARCH_HISTORY_KEY);
  window.dispatchEvent(new CustomEvent('searchHistoryUpdated', { detail: [] }));
}

export async function deleteSearchHistory(keyword: string): Promise<void> {
  const trimmed = keyword.trim();
  if (!trimmed) return;
  if (STORAGE_TYPE !== 'localstorage') {
    const cachedHistory = cacheManager.getCachedSearchHistory() || [];
    const newHistory = cachedHistory.filter((k) => k !== trimmed);
    cacheManager.cacheSearchHistory(newHistory);
    window.dispatchEvent(new CustomEvent('searchHistoryUpdated', { detail: newHistory }));
    try { await fetch(`/api/searchhistory?keyword=${encodeURIComponent(trimmed)}`, { method: 'DELETE' }); } catch (err) { await handleDatabaseOperationFailure('searchHistory', err); }
    return;
  }
  if (typeof window === 'undefined') return;
  const history = await getSearchHistory();
  const newHistory = history.filter((k) => k !== trimmed);
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(newHistory));
  window.dispatchEvent(new CustomEvent('searchHistoryUpdated', { detail: newHistory }));
}

export async function getAllFavorites(): Promise<Record<string, Favorite>> {
  if (typeof window === 'undefined') return {};
  if (STORAGE_TYPE !== 'localstorage') {
    const cachedData = cacheManager.getCachedFavorites();
    if (cachedData) {
      fetchFromApi<Record<string, Favorite>>(`/api/favorites`).then((freshData) => {
        if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
          cacheManager.cacheFavorites(freshData);
          window.dispatchEvent(new CustomEvent('favoritesUpdated', { detail: freshData }));
        }
      }).catch((err) => console.warn('同步失败:', err));
      return cachedData;
    } else {
      try {
        const freshData = await fetchFromApi<Record<string, Favorite>>(`/api/favorites`);
        cacheManager.cacheFavorites(freshData);
        return freshData;
      } catch { return {}; }
    }
  }
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export async function saveFavorite(source: string, id: string, favorite: Favorite): Promise<void> {
  const key = generateStorageKey(source, id);
  if (STORAGE_TYPE !== 'localstorage') {
    const cachedFavorites = cacheManager.getCachedFavorites() || {};
    cachedFavorites[key] = favorite;
    cacheManager.cacheFavorites(cachedFavorites);
    window.dispatchEvent(new CustomEvent('favoritesUpdated', { detail: cachedFavorites }));
    try {
      const res = await fetch('/api/favorites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, favorite }) });
      if (!res.ok) throw new Error(`保存失败: ${res.status}`);
    } catch (err) { await handleDatabaseOperationFailure('favorites', err); throw err; }
    return;
  }
  if (typeof window === 'undefined') return;
  const allFavorites = await getAllFavorites();
  allFavorites[key] = favorite;
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(allFavorites));
  window.dispatchEvent(new CustomEvent('favoritesUpdated', { detail: allFavorites }));
}

export async function deleteFavorite(source: string, id: string): Promise<void> {
  const key = generateStorageKey(source, id);
  if (STORAGE_TYPE !== 'localstorage') {
    const cachedFavorites = cacheManager.getCachedFavorites() || {};
    delete cachedFavorites[key];
    cacheManager.cacheFavorites(cachedFavorites);
    window.dispatchEvent(new CustomEvent('favoritesUpdated', { detail: cachedFavorites }));
    try { await fetch(`/api/favorites?key=${encodeURIComponent(key)}`, { method: 'DELETE' }); } catch (err) { await handleDatabaseOperationFailure('favorites', err); throw err; }
    return;
  }
  if (typeof window === 'undefined') return;
  const allFavorites = await getAllFavorites();
  delete allFavorites[key];
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(allFavorites));
  window.dispatchEvent(new CustomEvent('favoritesUpdated', { detail: allFavorites }));
}

export async function isFavorited(source: string, id: string): Promise<boolean> {
  const key = generateStorageKey(source, id);
  if (STORAGE_TYPE !== 'localstorage') {
    const cachedFavorites = cacheManager.getCachedFavorites();
    if (cachedFavorites) return !!cachedFavorites[key];
    const all = await getAllFavorites();
    return !!all[key];
  }
  const allFavorites = await getAllFavorites();
  return !!allFavorites[key];
}

export async function clearAllPlayRecords(): Promise<void> {
  if (STORAGE_TYPE !== 'localstorage') {
    cacheManager.cachePlayRecords({});
    window.dispatchEvent(new CustomEvent('playRecordsUpdated', { detail: {} }));
    try { await fetch(`/api/playrecords`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }); } catch (err) { await handleDatabaseOperationFailure('playRecords', err); throw err; }
    return;
  }
  if (typeof window === 'undefined') return;
  localStorage.removeItem(PLAY_RECORDS_KEY);
  window.dispatchEvent(new CustomEvent('playRecordsUpdated', { detail: {} }));
}

export async function clearAllFavorites(): Promise<void> {
  if (STORAGE_TYPE !== 'localstorage') {
    cacheManager.cacheFavorites({});
    window.dispatchEvent(new CustomEvent('favoritesUpdated', { detail: {} }));
    try { await fetch(`/api/favorites`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }); } catch (err) { await handleDatabaseOperationFailure('favorites', err); throw err; }
    return;
  }
  if (typeof window === 'undefined') return;
  localStorage.removeItem(FAVORITES_KEY);
  window.dispatchEvent(new CustomEvent('favoritesUpdated', { detail: {} }));
}

export function clearUserCache(): void {
  if (STORAGE_TYPE !== 'localstorage') cacheManager.clearUserCache();
}

export async function refreshAllCache(): Promise<void> {
  if (STORAGE_TYPE === 'localstorage') return;
  try {
    const [playRecords, favorites, searchHistory, skipConfigs] = await Promise.allSettled([
      fetchFromApi<Record<string, PlayRecord>>(`/api/playrecords`),
      fetchFromApi<Record<string, Favorite>>(`/api/favorites`),
      fetchFromApi<string[]>(`/api/searchhistory`),
      fetchFromApi<Record<string, SkipConfig>>(`/api/skipconfig`),
    ]);
    if (playRecords.status === 'fulfilled') {
      cacheManager.cachePlayRecords(playRecords.value);
      window.dispatchEvent(new CustomEvent('playRecordsUpdated', { detail: playRecords.value }));
    }
    if (favorites.status === 'fulfilled') {
      cacheManager.cacheFavorites(favorites.value);
      window.dispatchEvent(new CustomEvent('favoritesUpdated', { detail: favorites.value }));
    }
    if (searchHistory.status === 'fulfilled') {
      cacheManager.cacheSearchHistory(searchHistory.value);
      window.dispatchEvent(new CustomEvent('searchHistoryUpdated', { detail: searchHistory.value }));
    }
    if (skipConfigs.status === 'fulfilled') {
      cacheManager.cacheSkipConfigs(skipConfigs.value);
      window.dispatchEvent(new CustomEvent('skipConfigUpdated', { detail: skipConfigs.value }));
    }
  } catch (err) { console.error('刷新缓存失败:', err); }
}

export function getCacheStatus(): any {
  if (STORAGE_TYPE === 'localstorage') return { hasPlayRecords: false, hasFavorites: false, hasSearchHistory: false, username: null };
  const authInfo = getAuthInfoFromBrowserCookie();
  return {
    hasPlayRecords: !!cacheManager.getCachedPlayRecords(),
    hasFavorites: !!cacheManager.getCachedFavorites(),
    hasSearchHistory: !!cacheManager.getCachedSearchHistory(),
    username: authInfo?.username || null,
  };
}

export type CacheUpdateEvent = 'playRecordsUpdated' | 'favoritesUpdated' | 'searchHistoryUpdated' | 'skipConfigUpdated';

export function subscribeToDataUpdates<T>(eventType: CacheUpdateEvent, callback: (data: T) => void): () => void {
  if (typeof window === 'undefined') return () => { };
  const handleUpdate = (event: CustomEvent) => callback(event.detail);
  window.addEventListener(eventType, handleUpdate as EventListener);
  return () => window.removeEventListener(eventType, handleUpdate as EventListener);
}

export async function preloadUserData(): Promise<void> {
  if (STORAGE_TYPE === 'localstorage') return;
  const status = getCacheStatus();
  if (status.hasPlayRecords && status.hasFavorites && status.hasSearchHistory) return;
  refreshAllCache().catch((err) => console.warn('预加载用户数据失败:', err));
}

// ============================================================================
// 【全新核心】：跳过片头片尾的云端配置管理 (支持单剧记忆)
// ============================================================================

export async function getAllSkipConfigs(): Promise<Record<string, SkipConfig>> {
  if (typeof window === 'undefined') return {};
  if (STORAGE_TYPE !== 'localstorage') {
    const cachedData = cacheManager.getCachedSkipConfigs();
    if (cachedData) {
      fetchFromApi<Record<string, SkipConfig>>(`/api/skipconfig`)
        .then((freshData) => {
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheSkipConfigs(freshData);
            window.dispatchEvent(new CustomEvent('skipConfigUpdated', { detail: freshData }));
          }
        }).catch(() => { });
      return cachedData;
    } else {
      try {
        const freshData = await fetchFromApi<Record<string, SkipConfig>>(`/api/skipconfig`);
        cacheManager.cacheSkipConfigs(freshData);
        return freshData;
      } catch { return {}; }
    }
  }
  try {
    const raw = localStorage.getItem(SKIP_CONFIG_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export async function getSkipConfig(source: string, id: string): Promise<SkipConfig | null> {
  const key = generateStorageKey(source, id);
  const allConfigs = await getAllSkipConfigs();
  return allConfigs[key] || null;
}

export async function saveSkipConfig(source: string, id: string, config: SkipConfig): Promise<void> {
  const key = generateStorageKey(source, id);
  if (STORAGE_TYPE !== 'localstorage') {
    const cachedConfigs = cacheManager.getCachedSkipConfigs() || {};
    cachedConfigs[key] = config;
    cacheManager.cacheSkipConfigs(cachedConfigs);
    window.dispatchEvent(new CustomEvent('skipConfigUpdated', { detail: cachedConfigs }));
    try {
      const res = await fetch('/api/skipconfig', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, config }) });
      if (!res.ok) throw new Error(`保存跳过配置失败: ${res.status}`);
    } catch (err) { await handleDatabaseOperationFailure('skipConfig', err); throw err; }
    return;
  }
  if (typeof window === 'undefined') return;
  const allConfigs = await getAllSkipConfigs();
  allConfigs[key] = config;
  localStorage.setItem(SKIP_CONFIG_KEY, JSON.stringify(allConfigs));
  window.dispatchEvent(new CustomEvent('skipConfigUpdated', { detail: allConfigs }));
}

export async function deleteSkipConfig(source: string, id: string): Promise<void> {
  const key = generateStorageKey(source, id);
  if (STORAGE_TYPE !== 'localstorage') {
    const cachedConfigs = cacheManager.getCachedSkipConfigs() || {};
    delete cachedConfigs[key];
    cacheManager.cacheSkipConfigs(cachedConfigs);
    window.dispatchEvent(new CustomEvent('skipConfigUpdated', { detail: cachedConfigs }));
    try {
      const res = await fetch(`/api/skipconfig?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`删除跳过配置失败: ${res.status}`);
    } catch (err) { await handleDatabaseOperationFailure('skipConfig', err); throw err; }
    return;
  }
  if (typeof window === 'undefined') return;
  const allConfigs = await getAllSkipConfigs();
  delete allConfigs[key];
  localStorage.setItem(SKIP_CONFIG_KEY, JSON.stringify(allConfigs));
  window.dispatchEvent(new CustomEvent('skipConfigUpdated', { detail: allConfigs }));
}
