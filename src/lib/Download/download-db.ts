/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * 下载任务 IndexedDB 数据库管理
 */

export interface SavedTask {
  id: string;
  url: string;
  title: string;
  type: 'TS' | 'MP4';
  status: 'ready' | 'downloading' | 'pause' | 'done' | 'error';
  finishList: Array<{
    title: string;
    status: '' | 'is-downloading' | 'is-success' | 'is-error';
    retryCount?: number;
  }>;
  downloadIndex: number;
  finishNum: number;
  errorNum: number;
  source?: string;
  videoId?: string;
  episodeIndex?: number;
  downloadMode?: 'browser' | 'filesystem' | 'indexeddb';
  rangeDownload: {
    isShowRange: boolean;
    startSegment: number;
    endSegment: number;
    targetSegment: number;
  };
  m3u8Content?: string;
  createdAt: number;
  completedAt?: number;
  segmentLogs?: Array<{
    id: string;
    index: number;
    status:
      | 'queued'
      | 'downloading'
      | 'success'
      | 'retry'
      | 'error'
      | 'timeout'
      | 'aborted';
    message: string;
    timestamp: number;
    retryCount?: number;
    durationMs?: number;
    httpStatus?: number;
  }>;
}

export interface CompletedTask {
  id: string;
  title: string;
  source: string;
  videoId: string;
  episodeIndex: number;
  videoTitle?: string;
  episodeTitle?: string;
  fileSize?: number;
  completedAt: number;
  downloadMode: 'browser' | 'filesystem' | 'indexeddb';
}

const DB_NAME = 'PurpleMoonDownloads';
const DB_VERSION = 2;
const ACTIVE_TASKS_STORE = 'activeTasks';
const COMPLETED_TASKS_STORE = 'completedTasks';

class DownloadDB {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(ACTIVE_TASKS_STORE)) {
          const activeStore = db.createObjectStore(ACTIVE_TASKS_STORE, {
            keyPath: 'id',
          });
          activeStore.createIndex('status', 'status', { unique: false });
          activeStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        if (!db.objectStoreNames.contains(COMPLETED_TASKS_STORE)) {
          const completedStore = db.createObjectStore(COMPLETED_TASKS_STORE, {
            keyPath: 'id',
          });
          completedStore.createIndex('source', 'source', { unique: false });
          completedStore.createIndex('videoId', 'videoId', { unique: false });
          completedStore.createIndex('completedAt', 'completedAt', {
            unique: false,
          });
          completedStore.createIndex('sourceVideoId', ['source', 'videoId'], {
            unique: false,
          });
        }
      };
    });
  }

  async saveActiveTask(task: SavedTask): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [ACTIVE_TASKS_STORE],
        'readwrite'
      );
      const store = transaction.objectStore(ACTIVE_TASKS_STORE);
      const request = store.put(task);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async saveActiveTasks(tasks: SavedTask[]): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [ACTIVE_TASKS_STORE],
        'readwrite'
      );
      const store = transaction.objectStore(ACTIVE_TASKS_STORE);

      store.clear();

      for (const task of tasks) {
        store.put(task);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async getActiveTasks(): Promise<SavedTask[]> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [ACTIVE_TASKS_STORE],
        'readonly'
      );
      const store = transaction.objectStore(ACTIVE_TASKS_STORE);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteActiveTask(id: string): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [ACTIVE_TASKS_STORE],
        'readwrite'
      );
      const store = transaction.objectStore(ACTIVE_TASKS_STORE);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async deleteActiveTasks(ids: string[]): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [ACTIVE_TASKS_STORE],
        'readwrite'
      );
      const store = transaction.objectStore(ACTIVE_TASKS_STORE);

      for (const id of ids) {
        store.delete(id);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async saveCompletedTask(task: CompletedTask): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [COMPLETED_TASKS_STORE],
        'readwrite'
      );
      const store = transaction.objectStore(COMPLETED_TASKS_STORE);
      const request = store.put(task);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getCompletedTasks(): Promise<CompletedTask[]> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [COMPLETED_TASKS_STORE],
        'readonly'
      );
      const store = transaction.objectStore(COMPLETED_TASKS_STORE);
      const index = store.index('completedAt');
      const request = index.openCursor(null, 'prev');

      const results: CompletedTask[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteCompletedTask(id: string): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [COMPLETED_TASKS_STORE],
        'readwrite'
      );
      const store = transaction.objectStore(COMPLETED_TASKS_STORE);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async deleteCompletedTasks(ids: string[]): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [COMPLETED_TASKS_STORE],
        'readwrite'
      );
      const store = transaction.objectStore(COMPLETED_TASKS_STORE);

      for (const id of ids) {
        store.delete(id);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async isDownloaded(
    source: string,
    videoId: string,
    episodeIndex: number
  ): Promise<boolean> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [COMPLETED_TASKS_STORE],
        'readonly'
      );
      const store = transaction.objectStore(COMPLETED_TASKS_STORE);
      const index = store.index('sourceVideoId');
      const request = index.openCursor(IDBKeyRange.only([source, videoId]));

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const task = cursor.value as CompletedTask;
          if (task.episodeIndex === episodeIndex) {
            resolve(true);
            return;
          }
          cursor.continue();
        } else {
          resolve(false);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }
}

export const downloadDB = new DownloadDB();
