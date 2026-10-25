/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-explicit-any */
// 验证 5 分钟搜索缓存在不同角色（管理员 vs 普通用户）和不同分组（不同「线路 N」序号）之间不会串站名

let upstreamCallCount = 0;

jest.mock('@/lib/downstream', () => ({
  searchFromApi: async (site: any, query: string, opts: any = {}) => {
    upstreamCallCount++;
    const item = {
      id: '1001',
      title: query,
      poster: 'https://example.com/p.jpg',
      episodes: ['https://example.com/1.m3u8'],
      source: site.key,
      source_name: site.name,
      year: '2026',
      desc: '',
    };
    opts.onFirstPage?.([item]);
    return [item];
  },
}));

import { clearSearchCache, runSearch } from '../search-engine';

beforeEach(() => {
  clearSearchCache();
  upstreamCallCount = 0;
});

test('管理员先搜「流浪地球」，5 分钟内普通用户再搜同一词：命中缓存但 source_name 仍脱敏为「线路 1」', async () => {
  const adminSites = [
    { key: 'dyttzy', name: '电影天堂资源', api: 'https://dytt.example/api' },
  ];
  const userSites = [
    { key: 'dyttzy', name: '线路 1', api: 'https://dytt.example/api' },
  ];

  // 1. 管理员首次搜索
  const adminRes = await runSearch(adminSites, '流浪地球');
  expect(adminRes).toHaveLength(1);
  expect(adminRes[0].source_name).toBe('电影天堂资源');
  expect(upstreamCallCount).toBe(1);

  // 2. 普通用户在缓存有效期内搜索同一词（含 onChunk 流式回调与最终返回值）
  const streamedChunks: any[] = [];
  const userRes = await runSearch(userSites, '流浪地球', {
    onChunk: (c) => streamedChunks.push(c),
  });
  expect(upstreamCallCount).toBe(1); // 确认命中了缓存，未重复请求上游
  expect(userRes).toHaveLength(1);
  expect(userRes[0].source_name).toBe('线路 1');
  expect(streamedChunks).toHaveLength(1);
  expect(streamedChunks[0].results[0].source_name).toBe('线路 1');
});

test('不同分组的普通用户先后搜索同一词：各自得到本组的「线路 N」序号，绝不互串；管理员随后搜索仍得到真实站名', async () => {
  // B 组只有 dyttzy（在该组内排第 1 → 线路 1）
  const groupBSites = [
    { key: 'dyttzy', name: '线路 1', api: 'https://dytt.example/api' },
  ];
  // A 组有 ruyi 和 dyttzy（dyttzy 在该组内排第 2 → 线路 2）
  const groupASites = [
    { key: 'ruyi', name: '线路 1', api: 'https://ruyi.example/api' },
    { key: 'dyttzy', name: '线路 2', api: 'https://dytt.example/api' },
  ];
  // 管理员看到真实名称
  const adminSites = [
    { key: 'ruyi', name: '如意资源', api: 'https://ruyi.example/api' },
    { key: 'dyttzy', name: '电影天堂资源', api: 'https://dytt.example/api' },
  ];

  // 1. B 组用户先搜「流浪地球」，写入 dyttzy 缓存（当时站名为「线路 1」）
  const resB = await runSearch(groupBSites, '流浪地球');
  expect(resB[0].source_name).toBe('线路 1');
  expect(upstreamCallCount).toBe(1);

  // 2. A 组用户随后搜「流浪地球」：dyttzy 命中缓存，但对 A 组用户必须显示为「线路 2」
  const chunksA: any[] = [];
  const resA = await runSearch(groupASites, '流浪地球', {
    onChunk: (c) => chunksA.push(c),
  });
  expect(upstreamCallCount).toBe(2); // 仅 ruyi 请求了上游，dyttzy 命中缓存
  const dyttInA = resA.find((r) => r.source === 'dyttzy');
  const ruyiInA = resA.find((r) => r.source === 'ruyi');
  expect(ruyiInA?.source_name).toBe('线路 1');
  expect(dyttInA?.source_name).toBe('线路 2');
  const dyttChunkInA = chunksA.find((c) => c.source === 'dyttzy');
  expect(dyttChunkInA?.results[0].source_name).toBe('线路 2');

  // 3. 管理员随后搜「流浪地球」：全部命中缓存，但必须还原为真实站名
  const resAdmin = await runSearch(adminSites, '流浪地球');
  expect(upstreamCallCount).toBe(2);
  expect(resAdmin.map((r) => r.source_name)).toEqual(['如意资源', '电影天堂资源']);
});
