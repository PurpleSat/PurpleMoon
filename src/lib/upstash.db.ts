/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { Redis } from '@upstash/redis';

import { AdminConfig } from './admin.types';
import { ConfigConflictError, UserExistsError } from './config-errors';
import { hashPassword, verifyPassword, verifyPasswordDummy } from './password';
import { Favorite, IStorage, Memo, PlayRecord, SkipConfig } from './types';

// 🛡️ 逻辑修复 (LOG-07)：前后端统一搜索历史最大条数为 20 条
const SEARCH_HISTORY_LIMIT = 20;

// 🛡️ 安全加固 (SEC-07 / SEC-NEW-06)：转义 Redis Glob 通配符，防止跨租户键名遍历注入
function escapeRedisPattern(str: string): string {
  return str.replace(/([*?[\]\\])/g, '\\$1');
}

// Memo留言板全站最大条数限制
const MEMO_LIMIT = 60;

// 添加Upstash Redis操作重试包装器
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (err: any) {
      const isLastAttempt = i === maxRetries - 1;
      const isConnectionError =
        err.message?.includes('Connection') ||
        err.message?.includes('ECONNREFUSED') ||
        err.message?.includes('ENOTFOUND') ||
        err.code === 'ECONNRESET' ||
        err.code === 'EPIPE' ||
        err.name === 'UpstashError';

      if (isConnectionError && !isLastAttempt) {
        console.log(
          `Upstash Redis operation failed, retrying... (${i + 1}/${maxRetries})`
        );
        console.error('Error:', err.message);

        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }

      throw err;
    }
  }

  throw new Error('Max retries exceeded');
}

export class UpstashRedisStorage implements IStorage {
  private client: Redis;

  constructor() {
    this.client = getUpstashRedisClient();
  }

  /**
   * 🛡️ 逻辑修复 (L-08)：优先使用 SCAN 游标分批迭代代替阻塞式 KEYS 命令；
   * 若底层客户端不支持 scan，则回退至 keys。
   */
  private async scanKeys(pattern: string): Promise<string[]> {
    if (typeof (this.client as any).scan === 'function') {
      const found = new Set<string>();
      let cursor: string | number = 0;
      do {
        const res: [string | number, string[]] = await withRetry(() =>
          (this.client as any).scan(cursor, { match: pattern, count: 200 })
        );
        cursor = res[0];
        for (const k of res[1] || []) {
          found.add(k);
        }
      } while (String(cursor) !== '0');
      return Array.from(found);
    }
    return await withRetry(() => this.client.keys(pattern));
  }

  // ---------- 播放记录 ----------
  private prKey(user: string, key: string) {
    return `u:${user}:pr:${key}`; // u:username:pr:source+id
  }

  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    const val = await withRetry(() =>
      this.client.get(this.prKey(userName, key))
    );
    return val ? (val as PlayRecord) : null;
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    await withRetry(() => this.client.set(this.prKey(userName, key), record));
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    const safeUser = escapeRedisPattern(userName);
    const prefix = `u:${userName}:pr:`;
    const pattern = `u:${safeUser}:pr:*`;
    const keys: string[] = await this.scanKeys(pattern);
    if (keys.length === 0) return {};

    const result: Record<string, PlayRecord> = {};
    for (const fullKey of keys) {
      const value = await withRetry(() => this.client.get(fullKey));
      if (value && fullKey.startsWith(prefix)) {
        const keyPart = fullKey.slice(prefix.length);
        result[keyPart] = value as PlayRecord;
      }
    }
    return result;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await withRetry(() => this.client.del(this.prKey(userName, key)));
  }

  // ---------- 收藏 ----------
  private favKey(user: string, key: string) {
    return `u:${user}:fav:${key}`;
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const val = await withRetry(() =>
      this.client.get(this.favKey(userName, key))
    );
    return val ? (val as Favorite) : null;
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    await withRetry(() =>
      this.client.set(this.favKey(userName, key), favorite)
    );
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    const safeUser = escapeRedisPattern(userName);
    const prefix = `u:${userName}:fav:`;
    const pattern = `u:${safeUser}:fav:*`;
    const keys: string[] = await this.scanKeys(pattern);
    if (keys.length === 0) return {};

    const result: Record<string, Favorite> = {};
    for (const fullKey of keys) {
      const value = await withRetry(() => this.client.get(fullKey));
      if (value && fullKey.startsWith(prefix)) {
        const keyPart = fullKey.slice(prefix.length);
        result[keyPart] = value as Favorite;
      }
    }
    return result;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await withRetry(() => this.client.del(this.favKey(userName, key)));
  }

  // ---------- 用户注册 / 登录 ----------
  private userPwdKey(user: string) {
    return `u:${user}:pwd`;
  }

  async registerUser(userName: string, password: string): Promise<void> {
    const hashedPassword = await hashPassword(password);
    // 原子判重：nx 只允许同名并发注册中的第一个写入成功
    const created = await withRetry(() =>
      this.client.set(this.userPwdKey(userName), hashedPassword, { nx: true })
    );
    if (created === null) {
      throw new UserExistsError();
    }
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const stored = await withRetry(() =>
      this.client.get(this.userPwdKey(userName))
    );
    if (stored === null) return await verifyPasswordDummy(password);
    return await verifyPassword(password, stored as string);
  }

  async checkUserExist(userName: string): Promise<boolean> {
    const exists = await withRetry(() =>
      this.client.exists(this.userPwdKey(userName))
    );
    return exists === 1;
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    const hashedPassword = await hashPassword(newPassword);
    await withRetry(() =>
      this.client.set(this.userPwdKey(userName), hashedPassword)
    );
  }

  // 删除用户及其所有数据
  async deleteUser(userName: string): Promise<void> {
    await withRetry(() => this.client.del(this.userPwdKey(userName)));
    await withRetry(() => this.client.del(this.shKey(userName)));
    await withRetry(() => this.client.del(`memo:rate:${userName}`));

    // 🛡️ 安全修复 (SEC-NEW-06)：转义 userName 中的 Glob 通配符，防止删除含特殊字符的历史账号时误删全库
    const safeUser = escapeRedisPattern(userName);

    const playRecordKeys = await this.scanKeys(`u:${safeUser}:pr:*`);
    if (playRecordKeys.length > 0) {
      await withRetry(() => this.client.del(...playRecordKeys));
    }

    const favoriteKeys = await this.scanKeys(`u:${safeUser}:fav:*`);
    if (favoriteKeys.length > 0) {
      await withRetry(() => this.client.del(...favoriteKeys));
    }

    const skipKeys = await this.scanKeys(`u:${safeUser}:skip:*`);
    if (skipKeys.length > 0) {
      await withRetry(() => this.client.del(...skipKeys));
    }

    const list = await withRetry(() =>
      this.client.lrange<string | object>(this.memosKey(), 0, -1)
    );
    if (Array.isArray(list)) {
      for (const item of list) {
        const memo = typeof item === 'string' ? JSON.parse(item) : item;
        if (memo && (memo as any).username === userName) {
          const targetStr = typeof item === 'string' ? item : JSON.stringify(item);
          await withRetry(() => this.client.lrem(this.memosKey(), 0, targetStr));
        }
      }
    }
  }

  // ---------- 搜索历史 ----------
  private shKey(user: string) {
    return `u:${user}:sh`;
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const result = await withRetry(() =>
      this.client.lrange(this.shKey(userName), 0, SEARCH_HISTORY_LIMIT - 1)
    );
    return result as string[];
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const key = this.shKey(userName);
    await withRetry(() => this.client.lrem(key, 0, keyword));
    await withRetry(() => this.client.lpush(key, keyword));
    await withRetry(() => this.client.ltrim(key, 0, SEARCH_HISTORY_LIMIT - 1));
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const key = this.shKey(userName);
    if (keyword) {
      await withRetry(() => this.client.lrem(key, 0, keyword));
    } else {
      await withRetry(() => this.client.del(key));
    }
  }

  // ---------- 获取全部用户 ----------
  async getAllUsers(): Promise<string[]> {
    const keys = await this.scanKeys('u:*:pwd');
    return keys
      .map((k) => {
        const match = k.match(/^u:(.+?):pwd$/);
        return match ? match[1] : undefined;
      })
      .filter((u): u is string => typeof u === 'string');
  }

  // ---------- 管理员配置 ----------
  private adminConfigKey() {
    return 'admin:config';
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const val = await withRetry(() => this.client.get(this.adminConfigKey()));
    return val ? (val as AdminConfig) : null;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    const expectedVersion = config.configVersion ?? 0;
    const newVersion = expectedVersion + 1;
    const newConfig = { ...config, configVersion: newVersion };

    const casLua = `
      local key = KEYS[1]
      local expectedVersion = tonumber(ARGV[1])
      local newValue = ARGV[2]

      local raw = redis.call('GET', key)
      local currentVersion = 0
      if raw then
        local ok, decoded = pcall(cjson.decode, raw)
        if ok and decoded and decoded.configVersion then
          currentVersion = decoded.configVersion
        end
      end

      if currentVersion == expectedVersion then
        redis.call('SET', key, newValue)
        return 1
      else
        return 0
      end
    `;

    const result = await withRetry(() =>
      this.client.eval(
        casLua,
        [this.adminConfigKey()],
        [String(expectedVersion), JSON.stringify(newConfig)]
      )
    );

    if (Number(result) !== 1) {
      throw new ConfigConflictError();
    }
    config.configVersion = newVersion;
  }

  // =========================================================================
  // 跳过片头片尾配置 (SkipConfig)
  // =========================================================================

  private skipKey(user: string, key: string) {
    return `u:${user}:skip:${key}`;
  }

  async getSkipConfig(userName: string, key: string): Promise<SkipConfig | null> {
    const val = await withRetry(() =>
      this.client.get(this.skipKey(userName, key))
    );
    return val ? (val as SkipConfig) : null;
  }

  async setSkipConfig(
    userName: string,
    key: string,
    config: SkipConfig
  ): Promise<void> {
    await withRetry(() =>
      this.client.set(this.skipKey(userName, key), config)
    );
  }

  async getAllSkipConfigs(userName: string): Promise<Record<string, SkipConfig>> {
    const safeUser = escapeRedisPattern(userName);
    const prefix = `u:${userName}:skip:`;
    const pattern = `u:${safeUser}:skip:*`;
    const keys: string[] = await this.scanKeys(pattern);
    if (keys.length === 0) return {};

    const result: Record<string, SkipConfig> = {};
    for (const fullKey of keys) {
      const value = await withRetry(() => this.client.get(fullKey));
      if (value && fullKey.startsWith(prefix)) {
        const keyPart = fullKey.slice(prefix.length);
        result[keyPart] = value as SkipConfig;
      }
    }
    return result;
  }

  async deleteSkipConfig(userName: string, key: string): Promise<void> {
    await withRetry(() => this.client.del(this.skipKey(userName, key)));
  }

  // =========================================================================
  // 全员共享留言 (Memos) - Redis 原生 List + 防刷/限流
  // =========================================================================

  private memosKey() {
    return 'global:memos';
  }

  async getMemos(userName?: string, isAdmin = false): Promise<Memo[]> {
    const list = await withRetry(() =>
      this.client.lrange<string | object>(this.memosKey(), 0, -1)
    );
    const rawMemos = list || [];

    return rawMemos.map((item) => {
      const memo = (typeof item === 'string' ? JSON.parse(item) : item) as Memo;
      return {
        ...memo,
        is_owner: Boolean(userName && (memo.username === userName || isAdmin)),
      };
    });
  }

  async addMemo(userName: string, content: string): Promise<void> {
    const trimmed = content?.trim();
    if (!trimmed || trimmed.length === 0) {
      throw new Error('留言内容不能为空');
    }
    if (trimmed.length > 500) {
      throw new Error('留言内容不能超过 500 个字符');
    }

    // 限流校验：基于 ZSET 滑动窗口检查单用户 10 分钟（600000ms）内最多 2 条
    const isAllowed = await this.checkRateLimit(`memo:rate:${userName}`, 2, 600000);
    if (!isAllowed) {
      throw new Error('发布过于频繁，10分钟内最多只能发布 2 条留言。');
    }

    const memoData = {
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      username: userName,
      content: trimmed,
      created_at: Date.now(),
    };
    const jsonStr = JSON.stringify(memoData);

    await withRetry(() => this.client.lpush(this.memosKey(), jsonStr));
    await withRetry(() => this.client.ltrim(this.memosKey(), 0, MEMO_LIMIT - 1));
  }

  async deleteMemo(userName: string, memoId: number, isAdmin = false): Promise<boolean> {
    const list = await withRetry(() =>
      this.client.lrange<string | object>(this.memosKey(), 0, -1)
    );
    if (!list || list.length === 0) return false;

    for (const item of list) {
      const memo = (typeof item === 'string' ? JSON.parse(item) : item) as Memo;
      if (memo.id === memoId && (memo.username === userName || isAdmin)) {
        const targetStr = typeof item === 'string' ? item : JSON.stringify(item);
        await withRetry(() => this.client.lrem(this.memosKey(), 1, targetStr));
        return true;
      }
    }
    return false;
  }

  // =========================================================================
  // 全局分布式限流 (Rate Limiter) - 基于 ZSET 滑动窗口 (Sliding Window)
  // =========================================================================
  async checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const memberId = `${now}:${Math.random().toString(36).substring(2, 7)}`;

    const slidingWindowLua = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local window = tonumber(ARGV[2])
      local limit = tonumber(ARGV[3])
      local memberId = ARGV[4]
      
      local clearBefore = now - window

      redis.call('ZREMRANGEBYSCORE', key, '-inf', clearBefore)

      local currentCount = redis.call('ZCARD', key)

      if currentCount < limit then
          redis.call('ZADD', key, now, memberId)
          redis.call('PEXPIRE', key, window)
          return 1
      else
          return 0
      end
    `;

    const result = await withRetry(() =>
      this.client.eval(
        slidingWindowLua,
        [key],
        [now.toString(), windowMs.toString(), limit.toString(), memberId]
      )
    );

    return Number(result) === 1;
  }

  async resetRateLimit(key: string): Promise<void> {
    await withRetry(() => this.client.del(key));
  }
}

// 单例 Upstash Redis 客户端
function getUpstashRedisClient(): Redis {
  const globalKey = Symbol.for('__MOONTV_UPSTASH_REDIS_CLIENT__');
  let client: Redis | undefined = (global as any)[globalKey];

  if (!client) {
    const upstashUrl = process.env.UPSTASH_URL;
    const upstashToken = process.env.UPSTASH_TOKEN;

    if (!upstashUrl || !upstashToken) {
      throw new Error(
        'UPSTASH_URL and UPSTASH_TOKEN env variables must be set'
      );
    }

    client = new Redis({
      url: upstashUrl,
      token: upstashToken,
      retry: {
        retries: 3,
        backoff: (retryCount: number) =>
          Math.min(1000 * Math.pow(2, retryCount), 30000),
      },
    });

    console.log('Upstash Redis client created successfully');

    (global as any)[globalKey] = client;
  }

  return client;
}
