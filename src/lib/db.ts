/* eslint-disable no-console */

import { AdminConfig } from './admin.types';
import { D1Storage } from './d1.db';
import { RedisStorage } from './redis.db';
import { Favorite, IStorage, PlayRecord } from './types';
import { UpstashRedisStorage } from './upstash.db';

export interface SkipConfig {
  enable: boolean;
  intro_time: number;
  outro_time: number;
}

// 建议优先使用服务端环境变量 STORAGE_TYPE，向下兼容 NEXT_PUBLIC_STORAGE_TYPE
function getStorageType() {
  return (
    process.env.STORAGE_TYPE ||
    process.env.NEXT_PUBLIC_STORAGE_TYPE ||
    'localstorage'
  );
}

// 创建存储实例
function createStorage(): IStorage | null {
  const type = getStorageType();
  switch (type) {
    case 'redis':
      return new RedisStorage();
    case 'upstash':
      return new UpstashRedisStorage();
    case 'd1':
      return new D1Storage();
    case 'localstorage':
    default:
      // 如果没有配置持久化存储，打印警告而不是直接让程序在运行时崩溃
      console.warn(`[DbManager] Warning: Storage type is set to '${type}'. No remote database configured.`);
      return null;
  }
}

let storageInstance: IStorage | null = null;

export function getStorage(): IStorage | null {
  if (!storageInstance) {
    storageInstance = createStorage();
  }
  return storageInstance;
}

export function generateStorageKey(source: string, id: string): string {
  return `${source}::${id}`;
}

export class DbManager {
  private get storage(): IStorage {
    const instance = getStorage();
    if (!instance) {
      throw new Error(
        '[DbManager] Database storage is not configured or failed to initialize. Please check STORAGE_TYPE environment variable.'
      );
    }
    return instance;
  }

  // 播放记录相关方法
  async getPlayRecord(userName: string, source: string, id: string): Promise<PlayRecord | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getPlayRecord(userName, key);
  }

  async savePlayRecord(userName: string, source: string, id: string, record: PlayRecord): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setPlayRecord(userName, key, record);
  }

  async getAllPlayRecords(userName: string): Promise<{ [key: string]: PlayRecord }> {
    return this.storage.getAllPlayRecords(userName);
  }

  async deletePlayRecord(userName: string, source: string, id: string): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deletePlayRecord(userName, key);
  }

  // 收藏相关方法
  async getFavorite(userName: string, source: string, id: string): Promise<Favorite | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getFavorite(userName, key);
  }

  async saveFavorite(userName: string, source: string, id: string, favorite: Favorite): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setFavorite(userName, key, favorite);
  }

  async getAllFavorites(userName: string): Promise<{ [key: string]: Favorite }> {
    return this.storage.getAllFavorites(userName);
  }

  async deleteFavorite(userName: string, source: string, id: string): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deleteFavorite(userName, key);
  }

  async isFavorited(userName: string, source: string, id: string): Promise<boolean> {
    const favorite = await this.getFavorite(userName, source, id);
    return favorite !== null;
  }

  // 用户相关
  async registerUser(userName: string, password: string): Promise<void> {
    await this.storage.registerUser(userName, password);
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    return this.storage.verifyUser(userName, password);
  }

  async checkUserExist(userName: string): Promise<boolean> {
    return this.storage.checkUserExist(userName);
  }

  // 搜索历史
  async getSearchHistory(userName: string): Promise<string[]> {
    return this.storage.getSearchHistory(userName);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    await this.storage.addSearchHistory(userName, keyword);
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    await this.storage.deleteSearchHistory(userName, keyword);
  }

  async getAllUsers(): Promise<string[]> {
    if (typeof this.storage.getAllUsers === 'function') {
      return this.storage.getAllUsers();
    }
    return [];
  }

  // 管理员配置
  async getAdminConfig(): Promise<AdminConfig | null> {
    if (typeof this.storage.getAdminConfig === 'function') {
      return this.storage.getAdminConfig();
    }
    return null;
  }

  async saveAdminConfig(config: AdminConfig): Promise<void> {
    if (typeof this.storage.setAdminConfig === 'function') {
      await this.storage.setAdminConfig(config);
    }
  }

  // 跳过片头片尾配置
  async getSkipConfig(userName: string, source: string, id: string): Promise<SkipConfig | null> {
    const key = generateStorageKey(source, id);
    if (typeof this.storage.getSkipConfig === 'function') {
      return this.storage.getSkipConfig(userName, key);
    }
    return null;
  }

  async setSkipConfig(userName: string, source: string, id: string, config: SkipConfig): Promise<void> {
    const key = generateStorageKey(source, id);
    if (typeof this.storage.setSkipConfig === 'function') {
      await this.storage.setSkipConfig(userName, key, config);
    }
  }

  async getAllSkipConfigs(userName: string): Promise<{ [key: string]: SkipConfig }> {
    if (typeof this.storage.getAllSkipConfigs === 'function') {
      return this.storage.getAllSkipConfigs(userName);
    }
    return {};
  }

  async deleteSkipConfig(userName: string, source: string, id: string): Promise<void> {
    const key = generateStorageKey(source, id);
    if (typeof this.storage.deleteSkipConfig === 'function') {
      await this.storage.deleteSkipConfig(userName, key);
    }
  }
}

export const db = new DbManager();
