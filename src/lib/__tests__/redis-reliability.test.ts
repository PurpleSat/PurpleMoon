/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { webcrypto } from 'crypto';
import { TextDecoder, TextEncoder } from 'util';

import { UserExistsError } from '../config-errors';

// Jest 27 的 node 环境缺少这些全局（运行时 Node 22/24 自带）
(globalThis as any).crypto ??= webcrypto;
(globalThis as any).TextEncoder ??= TextEncoder;
(globalThis as any).TextDecoder ??= TextDecoder;

// 假 Redis 客户端：set 支持 NX；never 命令永不返回，用来模拟 Redis 宕机
const store = new Map<string, string>();
const fakeClient: any = {
  isReady: true,
  on: jest.fn(),
  once: jest.fn(),
  off: jest.fn(),
  connect: jest.fn(() => Promise.resolve()),
  set: jest.fn(async (k: string, v: string, opts?: { NX?: boolean }) => {
    await new Promise((r) => setTimeout(r, 5));
    if (opts?.NX && store.has(k)) return null;
    store.set(k, v);
    return 'OK';
  }),
  scan: jest.fn(async (cursor: number) => {
    await new Promise((r) => setTimeout(r, 5));
    if (cursor === 0) return { cursor: 0, keys: Array.from(store.keys()) };
    return { cursor: 0, keys: [] };
  }),
  scanIterator: jest.fn(async function* () {
    for (const k of store.keys()) {
      yield k;
    }
  }),
  never: jest.fn(() => new Promise(() => undefined)),
  multi: jest.fn(() => {
    const chain: any = { set: jest.fn(() => chain), exec: jest.fn(() => new Promise(() => undefined)) };
    return chain;
  }),
};
jest.mock('redis', () => ({ createClient: jest.fn(() => fakeClient) }));

import {
  getRedisCommandTimeoutMs,
  RedisStorage,
  RedisTimeoutError,
  RedisUnavailableError,
  withCommandTimeout,
  wrapWithTimeout,
} from '../redis.db';

describe('N1 注册原子判重', () => {
  beforeEach(() => store.clear());

  test('同名 10 并发注册只有 1 个成功，其余抛 UserExistsError', async () => {
    const s = new RedisStorage();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => s.registerUser('alice', `Passw0rd_${i}`))
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    rejected.forEach((r) => expect(r.reason).toBeInstanceOf(UserExistsError));
  });

  test('不同用户名互不影响', async () => {
    const s = new RedisStorage();
    await expect(s.registerUser('u1', 'Passw0rd_1')).resolves.toBeUndefined();
    await expect(s.registerUser('u2', 'Passw0rd_2')).resolves.toBeUndefined();
  });
});

describe('N2 Redis 命令超时', () => {
  const saved = process.env.REDIS_COMMAND_TIMEOUT_MS;
  afterEach(() => {
    if (saved === undefined) delete process.env.REDIS_COMMAND_TIMEOUT_MS;
    else process.env.REDIS_COMMAND_TIMEOUT_MS = saved;
  });

  test('超时配置：默认 3000，过小或非法值回退默认', () => {
    delete process.env.REDIS_COMMAND_TIMEOUT_MS;
    expect(getRedisCommandTimeoutMs()).toBe(3000);
    process.env.REDIS_COMMAND_TIMEOUT_MS = '50';
    expect(getRedisCommandTimeoutMs()).toBe(3000);
    process.env.REDIS_COMMAND_TIMEOUT_MS = 'abc';
    expect(getRedisCommandTimeoutMs()).toBe(3000);
    process.env.REDIS_COMMAND_TIMEOUT_MS = '1500';
    expect(getRedisCommandTimeoutMs()).toBe(1500);
  });

  test('正常命令按时返回', async () => {
    await expect(withCommandTimeout(Promise.resolve('x'), 200)).resolves.toBe('x');
  });

  test('命令原样抛出自身错误', async () => {
    await expect(withCommandTimeout(Promise.reject(new Error('boom')), 200)).rejects.toThrow('boom');
  });

  test('永不返回的命令在超时后抛 RedisTimeoutError', async () => {
    const t0 = Date.now();
    await expect(withCommandTimeout(new Promise(() => undefined), 250)).rejects.toBeInstanceOf(
      RedisTimeoutError
    );
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  test('代理：普通命令与 multi().exec() 都带超时', async () => {
    process.env.REDIS_COMMAND_TIMEOUT_MS = '300';
    const c: any = wrapWithTimeout(fakeClient);
    await expect(c.never()).rejects.toBeInstanceOf(RedisTimeoutError);
    await expect(c.multi().set('a', 'b').exec()).rejects.toBeInstanceOf(RedisTimeoutError);
    await expect(c.set('k', 'v')).resolves.toBe('OK');
  });

  test('断路：gate 抛错时命令立即失败，不会真正发出，也不会等超时', async () => {
    process.env.REDIS_COMMAND_TIMEOUT_MS = '3000';
    fakeClient.set.mockClear();
    const c: any = wrapWithTimeout(fakeClient, () => {
      throw new RedisUnavailableError();
    });
    const t0 = Date.now();
    await expect(c.set('k', 'v')).rejects.toBeInstanceOf(RedisUnavailableError);
    await expect(c.multi().set('a', 'b').exec()).rejects.toBeInstanceOf(RedisUnavailableError);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(fakeClient.set).not.toHaveBeenCalled();
    // 非命令成员不受断路影响
    expect(() => c.on('error', () => undefined)).not.toThrow();
  });

  test('scanIterator：断路或等待连接时仍保持 AsyncIterable 契约，避免 TypeError 与未捕获拒绝', async () => {
    store.clear();
    store.set('u:alice:pr:s+1', '1');
    store.set('u:alice:pr:s+2', '2');

    // 1) gate 抛 RedisUnavailableError 时，for await 应捕获 RedisUnavailableError 而非 TypeError
    const brokenClient: any = wrapWithTimeout(fakeClient, () => {
      throw new RedisUnavailableError();
    });
    await expect(
      (async () => {
        const out: string[] = [];
        for await (const k of brokenClient.scanIterator({ MATCH: 'u:alice:pr:*' })) {
          out.push(k);
        }
        return out;
      })()
    ).rejects.toBeInstanceOf(RedisUnavailableError);

    // 2) gate 返回 Promise 时，for await 正常等待后迭代出全部键
    const delayedClient: any = wrapWithTimeout(
      fakeClient,
      () => new Promise<void>((r) => setTimeout(r, 20))
    );
    const collected: string[] = [];
    for await (const k of delayedClient.scanIterator({ MATCH: 'u:alice:pr:*' })) {
      collected.push(k);
    }
    expect(collected).toEqual(['u:alice:pr:s+1', 'u:alice:pr:s+2']);
  });

  test('gate 返回 Promise（等待首次连接）：就绪后正常执行', async () => {
    const c: any = wrapWithTimeout(fakeClient, () => new Promise<void>((r) => setTimeout(r, 30)));
    await expect(c.set('late', '1')).resolves.toBe('OK');
  });
});
