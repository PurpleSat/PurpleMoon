/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { AdminConfig } from './admin.types';
import { ConfigConflictError, UserExistsError } from './config-errors';
import { hashPassword, verifyPassword, verifyPasswordDummy } from './password';
import { Favorite, IStorage, Memo, PlayRecord, SkipConfig } from './types';

// 🛡️ 逻辑修复 (LOG-07)：前后端统一搜索历史最大条数为 20 条，避免缓存比对不一致引发重复重绘
const SEARCH_HISTORY_LIMIT = 20;

// Memo留言板最大条数限制，防止恶意刷库占用空间
const MEMO_LIMIT = 60;

// D1 数据库接口
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  exec(sql: string): Promise<D1ExecResult>;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = any>(colName?: string): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = any>(): Promise<D1Result<T>>;
}

interface D1Result<T = any> {
  results: T[];
  success: boolean;
  error?: string;
  meta: {
    changed_db: boolean;
    changes: number;
    last_row_id: number;
    duration: number;
  };
}

interface D1ExecResult {
  count: number;
  duration: number;
}

// 获取全局D1数据库实例
function getD1Database(): D1Database {
  return (process.env as any).DB as D1Database;
}

export class D1Storage implements IStorage {
  private db: D1Database | null = null;

  private async getDatabase(): Promise<D1Database> {
    if (!this.db) {
      this.db = getD1Database();
    }
    return this.db;
  }

  // 播放记录相关
  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM play_records WHERE username = ? AND key = ?')
        .bind(userName, key)
        .first<any>();

      if (!result) return null;

      return {
        title: result.title,
        source_name: result.source_name,
        cover: result.cover,
        year: result.year,
        index: result.index_episode,
        total_episodes: result.total_episodes,
        play_time: result.play_time,
        total_time: result.total_time,
        save_time: result.save_time,
        search_title: result.search_title || '',
      };
    } catch (err) {
      console.error('Failed to get play record:', err);
      throw err;
    }
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          `
          INSERT OR REPLACE INTO play_records 
          (username, key, title, source_name, cover, year, index_episode, total_episodes, play_time, total_time, save_time, search_title)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .bind(
          userName,
          key,
          record.title,
          record.source_name,
          record.cover,
          record.year,
          record.index,
          record.total_episodes,
          record.play_time,
          record.total_time,
          record.save_time,
          record.search_title || null
        )
        .run();
    } catch (err) {
      console.error('Failed to set play record:', err);
      throw err;
    }
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT * FROM play_records WHERE username = ? ORDER BY save_time DESC'
        )
        .bind(userName)
        .all<any>();

      const records: Record<string, PlayRecord> = {};

      result.results.forEach((row: any) => {
        records[row.key] = {
          title: row.title,
          source_name: row.source_name,
          cover: row.cover,
          year: row.year,
          index: row.index_episode,
          total_episodes: row.total_episodes,
          play_time: row.play_time,
          total_time: row.total_time,
          save_time: row.save_time,
          search_title: row.search_title || '',
        };
      });

      return records;
    } catch (err) {
      console.error('Failed to get all play records:', err);
      throw err;
    }
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('DELETE FROM play_records WHERE username = ? AND key = ?')
        .bind(userName, key)
        .run();
    } catch (err) {
      console.error('Failed to delete play record:', err);
      throw err;
    }
  }

  // 收藏相关
  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM favorites WHERE username = ? AND key = ?')
        .bind(userName, key)
        .first<any>();

      if (!result) return null;

      return {
        title: result.title,
        source_name: result.source_name,
        cover: result.cover,
        year: result.year,
        total_episodes: result.total_episodes,
        save_time: result.save_time,
        search_title: result.search_title || '',
      };
    } catch (err) {
      console.error('Failed to get favorite:', err);
      throw err;
    }
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    const db = await this.getDatabase();
    try {
      // 🛡️ 逻辑修复 (LOG-03)：持久化保存 search_title 字段，兼容未包含该列的旧表结构自动升级
      await db
        .prepare(
          `
          INSERT OR REPLACE INTO favorites 
          (username, key, title, source_name, cover, year, total_episodes, save_time, search_title)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .bind(
          userName,
          key,
          favorite.title,
          favorite.source_name,
          favorite.cover,
          favorite.year,
          favorite.total_episodes,
          favorite.save_time,
          favorite.search_title || null
        )
        .run();
    } catch (err: any) {
      if (err?.message?.includes('search_title')) {
        try {
          await db.prepare('ALTER TABLE favorites ADD COLUMN search_title TEXT').run();
          await db
            .prepare(
              `
              INSERT OR REPLACE INTO favorites 
              (username, key, title, source_name, cover, year, total_episodes, save_time, search_title)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
            )
            .bind(
              userName,
              key,
              favorite.title,
              favorite.source_name,
              favorite.cover,
              favorite.year,
              favorite.total_episodes,
              favorite.save_time,
              favorite.search_title || null
            )
            .run();
          return;
        } catch {
          // ALTER 失败：可能是并发请求已加好该列（duplicate column），先用完整列重试一次；
          // 仍失败（如无 ALTER 权限）再降级写入基础列
          try {
            await db
              .prepare(
                `
                INSERT OR REPLACE INTO favorites 
                (username, key, title, source_name, cover, year, total_episodes, save_time, search_title)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `
              )
              .bind(
                userName,
                key,
                favorite.title,
                favorite.source_name,
                favorite.cover,
                favorite.year,
                favorite.total_episodes,
                favorite.save_time,
                favorite.search_title || null
              )
              .run();
            return;
          } catch {
            // 降级
          }
        }
        await db
          .prepare(
            `
            INSERT OR REPLACE INTO favorites 
            (username, key, title, source_name, cover, year, total_episodes, save_time)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `
          )
          .bind(
            userName,
            key,
            favorite.title,
            favorite.source_name,
            favorite.cover,
            favorite.year,
            favorite.total_episodes,
            favorite.save_time
          )
          .run();
        return;
      }
      console.error('Failed to set favorite:', err);
      throw err;
    }
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT * FROM favorites WHERE username = ? ORDER BY save_time DESC'
        )
        .bind(userName)
        .all<any>();

      const favorites: Record<string, Favorite> = {};

      result.results.forEach((row: any) => {
        favorites[row.key] = {
          title: row.title,
          source_name: row.source_name,
          cover: row.cover,
          year: row.year,
          total_episodes: row.total_episodes,
          save_time: row.save_time,
          search_title: row.search_title || '',
        };
      });

      return favorites;
    } catch (err) {
      console.error('Failed to get all favorites:', err);
      throw err;
    }
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('DELETE FROM favorites WHERE username = ? AND key = ?')
        .bind(userName, key)
        .run();
    } catch (err) {
      console.error('Failed to delete favorite:', err);
      throw err;
    }
  }

  // =========================================================================
  // 用户密码哈希化存储与防时序攻击验证
  // =========================================================================

  async registerUser(userName: string, password: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      const hashedPassword = await hashPassword(password);
      await db
        .prepare('INSERT INTO users (username, password) VALUES (?, ?)')
        .bind(userName, hashedPassword)
        .run();
    } catch (err) {
      // users.username 是主键/唯一键：同名并发注册输掉的一方会触发 UNIQUE 冲突
      if (/UNIQUE|constraint/i.test(String((err as any)?.message || err))) {
        throw new UserExistsError();
      }
      console.error('Failed to register user:', err);
      throw err;
    }
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT password FROM users WHERE username = ?')
        .bind(userName)
        .first<{ password: string }>();

      if (!result) return await verifyPasswordDummy(password);
      return await verifyPassword(password, result.password);
    } catch (err) {
      console.error('Failed to verify user:', err);
      throw err;
    }
  }

  async checkUserExist(userName: string): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT 1 FROM users WHERE username = ?')
        .bind(userName)
        .first();

      return result !== null;
    } catch (err) {
      console.error('Failed to check user existence:', err);
      throw err;
    }
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      const hashedPassword = await hashPassword(newPassword);
      await db
        .prepare('UPDATE users SET password = ? WHERE username = ?')
        .bind(hashedPassword, userName)
        .run();
    } catch (err) {
      console.error('Failed to change password:', err);
      throw err;
    }
  }

  async deleteUser(userName: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      const statements = [
        db.prepare('DELETE FROM users WHERE username = ?').bind(userName),
        db
          .prepare('DELETE FROM play_records WHERE username = ?')
          .bind(userName),
        db.prepare('DELETE FROM favorites WHERE username = ?').bind(userName),
        db
          .prepare('DELETE FROM search_history WHERE username = ?')
          .bind(userName),
        db
          .prepare('DELETE FROM skip_configs WHERE username = ?')
          .bind(userName),
        db
          .prepare('DELETE FROM user_memos WHERE username = ?')
          .bind(userName),
      ];

      await db.batch(statements);
    } catch (err: any) {
      console.error('Failed to delete user:', err);
      if (err.message && err.message.includes('no such table')) {
        const db = await this.getDatabase();
        await db.batch([
          db.prepare('DELETE FROM users WHERE username = ?').bind(userName),
          db.prepare('DELETE FROM play_records WHERE username = ?').bind(userName),
          db.prepare('DELETE FROM favorites WHERE username = ?').bind(userName),
          db.prepare('DELETE FROM search_history WHERE username = ?').bind(userName),
        ]);
        return;
      }
      throw err;
    }
  }

  // 搜索历史相关
  async getSearchHistory(userName: string): Promise<string[]> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT keyword FROM search_history WHERE username = ? ORDER BY created_at DESC, id DESC LIMIT ?'
        )
        .bind(userName, SEARCH_HISTORY_LIMIT)
        .all<{ keyword: string }>();

      return result.results.map((row) => row.keyword);
    } catch (err) {
      console.error('Failed to get search history:', err);
      throw err;
    }
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          'DELETE FROM search_history WHERE username = ? AND keyword = ?'
        )
        .bind(userName, keyword)
        .run();

      await db
        .prepare('INSERT INTO search_history (username, keyword) VALUES (?, ?)')
        .bind(userName, keyword)
        .run();

      await db
        .prepare(
          `
          DELETE FROM search_history 
          WHERE username = ? AND id NOT IN (
            SELECT id FROM search_history 
            WHERE username = ? 
            ORDER BY created_at DESC, id DESC 
            LIMIT ?
          )
        `
        )
        .bind(userName, userName, SEARCH_HISTORY_LIMIT)
        .run();
    } catch (err) {
      console.error('Failed to add search history:', err);
      throw err;
    }
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      if (keyword) {
        await db
          .prepare(
            'DELETE FROM search_history WHERE username = ? AND keyword = ?'
          )
          .bind(userName, keyword)
          .run();
      } else {
        await db
          .prepare('DELETE FROM search_history WHERE username = ?')
          .bind(userName)
          .run();
      }
    } catch (err) {
      console.error('Failed to delete search history:', err);
      throw err;
    }
  }

  // 用户列表
  async getAllUsers(): Promise<string[]> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT username FROM users ORDER BY created_at ASC')
        .all<{ username: string }>();

      return result.results.map((row) => row.username);
    } catch (err) {
      console.error('Failed to get all users:', err);
      throw err;
    }
  }

  // 管理员配置相关
  async getAdminConfig(): Promise<AdminConfig | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT config FROM admin_config WHERE id = 1')
        .first<{ config: string }>();

      if (!result) return null;

      return JSON.parse(result.config) as AdminConfig;
    } catch (err) {
      console.error('Failed to get admin config:', err);
      throw err;
    }
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    try {
      const db = await this.getDatabase();
      const expectedVersion = config.configVersion ?? 0;
      const newVersion = expectedVersion + 1;
      const newConfig = { ...config, configVersion: newVersion };
      const serialized = JSON.stringify(newConfig);

      const updateResult = await db
        .prepare(
          `UPDATE admin_config
           SET config = ?
           WHERE id = 1
             AND COALESCE(json_extract(config, '$.configVersion'), 0) = ?`
        )
        .bind(serialized, expectedVersion)
        .run();

      if ((updateResult?.meta?.changes ?? 0) > 0) {
        config.configVersion = newVersion;
        return;
      }

      const existing = await db
        .prepare('SELECT 1 FROM admin_config WHERE id = 1')
        .first();

      if (!existing) {
        await db
          .prepare('INSERT INTO admin_config (id, config) VALUES (1, ?)')
          .bind(serialized)
          .run();
        config.configVersion = newVersion;
        return;
      }

      throw new ConfigConflictError();
    } catch (err) {
      if (err instanceof ConfigConflictError) {
        throw err;
      }
      console.error('Failed to set admin config:', err);
      throw err;
    }
  }

  // =========================================================================
  // 跳过片头片尾配置持久化支持
  // =========================================================================

  private async ensureSkipConfigsTable(db: D1Database): Promise<void> {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS skip_configs (
          username TEXT NOT NULL,
          key TEXT NOT NULL,
          enable INTEGER NOT NULL DEFAULT 0,
          intro_time INTEGER NOT NULL DEFAULT 0,
          outro_time INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (username, key)
        )`
      )
      .run();
  }

  async getSkipConfig(
    userName: string,
    key: string
  ): Promise<SkipConfig | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM skip_configs WHERE username = ? AND key = ?')
        .bind(userName, key)
        .first<any>();

      if (!result) return null;

      return {
        enable: Boolean(result.enable),
        intro_time: Number(result.intro_time) || 0,
        outro_time: Number(result.outro_time) || 0,
      };
    } catch (err: any) {
      if (err.message && err.message.includes('no such table')) {
        return null;
      }
      console.error('Failed to get skip config:', err);
      throw err;
    }
  }

  async setSkipConfig(
    userName: string,
    key: string,
    config: SkipConfig
  ): Promise<void> {
    const db = await this.getDatabase();
    try {
      await this.ensureSkipConfigsTable(db);
      await db
        .prepare(
          `
          INSERT OR REPLACE INTO skip_configs 
          (username, key, enable, intro_time, outro_time)
          VALUES (?, ?, ?, ?, ?)
        `
        )
        .bind(
          userName,
          key,
          config.enable ? 1 : 0,
          config.intro_time,
          config.outro_time
        )
        .run();
    } catch (err: any) {
      console.error('Failed to set skip config:', err);
      throw err;
    }
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<Record<string, SkipConfig>> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM skip_configs WHERE username = ?')
        .bind(userName)
        .all<any>();

      const configs: Record<string, SkipConfig> = {};

      result.results.forEach((row: any) => {
        configs[row.key] = {
          enable: Boolean(row.enable),
          intro_time: Number(row.intro_time) || 0,
          outro_time: Number(row.outro_time) || 0,
        };
      });

      return configs;
    } catch (err: any) {
      if (err.message && err.message.includes('no such table')) {
        return {};
      }
      console.error('Failed to get all skip configs:', err);
      throw err;
    }
  }

  async deleteSkipConfig(userName: string, key: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('DELETE FROM skip_configs WHERE username = ? AND key = ?')
        .bind(userName, key)
        .run();
    } catch (err: any) {
      if (err.message && err.message.includes('no such table')) {
        return;
      }
      console.error('Failed to delete skip config:', err);
      throw err;
    }
  }

  // =========================================================================
  // 留言 (Memos) 数据层实现（全员共享模式 + 管理员治理支持）
  // =========================================================================

  private async ensureMemosTable(db: D1Database): Promise<void> {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS user_memos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`
      )
      .run();
  }

  async getMemos(currentUserName?: string, isAdmin = false): Promise<Memo[]> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT id, username, content, created_at FROM user_memos ORDER BY created_at DESC LIMIT ?')
        .bind(MEMO_LIMIT)
        .all<any>();

      return (result.results || []).map((row: any) => ({
        id: row.id,
        user_id: row.username,
        username: row.username,
        content: row.content,
        created_at: row.created_at,
        is_owner: Boolean(currentUserName && (row.username === currentUserName || isAdmin)),
      }));
    } catch (err: any) {
      if (err.message && err.message.includes('no such table')) {
        return [];
      }
      console.error('Failed to get memos:', err);
      throw err;
    }
  }

  async addMemo(userName: string, content: string): Promise<void> {
    const trimmed = content?.trim();
    if (!trimmed || trimmed.length === 0) {
      throw new Error('留言内容不能为空');
    }
    if (trimmed.length > 500) {
      throw new Error('留言内容不能超过 500 个字符');
    }

    const db = await this.getDatabase();
    // 🛡️ 逻辑修复 (LOG-03)：先确保 user_memos 表存在，再扣减限流配额并写入，杜绝“静默丢弃却消耗配额”
    await this.ensureMemosTable(db);

    const isAllowed = await this.checkRateLimit(`memo:${userName}`, 2, 600000);
    if (!isAllowed) {
      throw new Error('发布过于频繁，10 分钟内最多只能发布 2 条留言。');
    }

    try {
      await db
        .prepare('INSERT INTO user_memos (username, content, created_at) VALUES (?, ?, ?)')
        .bind(userName, trimmed, Date.now())
        .run();

      // 全站容量限制：超出 MEMO_LIMIT (60) 条时清理最老的数据
      await db
        .prepare(
          `
          DELETE FROM user_memos 
          WHERE id NOT IN (
            SELECT id FROM user_memos 
            ORDER BY created_at DESC 
            LIMIT ?
          )
        `
        )
        .bind(MEMO_LIMIT)
        .run();
    } catch (err: any) {
      console.error('Failed to add memo:', err);
      throw err;
    }
  }

  async deleteMemo(userName: string, memoId: number, isAdmin = false): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const result = isAdmin
        ? await db.prepare('DELETE FROM user_memos WHERE id = ?').bind(memoId).run()
        : await db
            .prepare('DELETE FROM user_memos WHERE id = ? AND username = ?')
            .bind(memoId, userName)
            .run();
      return (result?.meta?.changes ?? 0) > 0;
    } catch (err: any) {
      if (err.message && err.message.includes('no such table')) {
        return false;
      }
      console.error('Failed to delete memo:', err);
      throw err;
    }
  }

  // =========================================================================
  // 全局分布式限流 (Rate Limiter)
  // =========================================================================
  async checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const now = Date.now();

      try {
        await db.prepare('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER, reset_at INTEGER)').run();
      } catch {
        // ignore
      }

      if (Math.random() < 0.02) {
        try {
          await db.prepare('DELETE FROM rate_limits WHERE reset_at < ?').bind(now).run();
        } catch {
          // 清理失败不影响限流本身
        }
      }

      try {
        const atomicSql = `
          INSERT INTO rate_limits (key, count, reset_at)
          VALUES (?, 1, ?)
          ON CONFLICT(key) DO UPDATE SET
            count = CASE WHEN ? > reset_at THEN 1 ELSE count + 1 END,
            reset_at = CASE WHEN ? > reset_at THEN ? ELSE reset_at END
          RETURNING count;
        `;
        const row = await db.prepare(atomicSql)
          .bind(key, now + windowMs, now, now, now + windowMs)
          .first<{ count: number }>();

        if (row && typeof row.count === 'number') {
          return row.count <= limit;
        }
      } catch {
        // 如果底层 D1 版本不支持 RETURNING，安全降级至两阶段处理
      }

      const result: any = await db.prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?').bind(key).first();
      if (!result || now > result.reset_at) {
        await db.prepare('INSERT OR REPLACE INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)').bind(key, now + windowMs).run();
        return 1 <= limit;
      } else {
        const newCount = result.count + 1;
        await db.prepare('UPDATE rate_limits SET count = ? WHERE key = ?').bind(newCount, key).run();
        return newCount <= limit;
      }
    } catch (err: any) {
      console.error('Failed to check rate limit in D1:', err);
      return true;
    }
  }

  async resetRateLimit(key: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run();
    } catch {
      // 表不存在或数据库异常时忽略
    }
  }
}
