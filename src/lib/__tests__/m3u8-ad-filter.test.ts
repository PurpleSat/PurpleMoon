/** @jest-environment node */
import { filterAdsFromM3U8 } from '../m3u8-ad-filter';

const HEAD = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n';
const BASE = 'https://v.cdn-b.example/20240101/hls/index.m3u8';
const seg = (dur: number, uri: string) => `#EXTINF:${dur},\n${uri}\n`;
const main = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => seg(10, `seg${from + i}.ts`)).join('');
const ad = (n: number, host = 'https://ad.cdn-a.example/adjump') =>
  Array.from({ length: n }, (_, i) => seg(3, `${host}/a${i}.ts`)).join('');
const D = '#EXT-X-DISCONTINUITY\n';
const END = '#EXT-X-ENDLIST\n';
const uris = (s: string) => s.split('\n').filter((l) => l && !l.startsWith('#'));
const count = (s: string, t: string) => s.split(t).length - 1;

describe('filterAdsFromM3U8', () => {
  it('T01 开头广告', () => {
    const r = filterAdsFromM3U8(HEAD + ad(4) + D + main(60) + END, { baseUrl: BASE });
    expect(r.removedSegments).toBe(4);
    expect(uris(r.content).every((u) => u.startsWith('seg'))).toBe(true);
    expect(r.content.startsWith('#EXTM3U')).toBe(true);
    expect(r.content.indexOf('#EXT-X-DISCONTINUITY')).toBe(-1);
  });

  it('T02 中间广告，两侧标记只保留一个', () => {
    const r = filterAdsFromM3U8(HEAD + main(30) + D + ad(5) + D + main(30, 30) + END, { baseUrl: BASE });
    expect(r.removedSegments).toBe(5);
    expect(uris(r.content)).toHaveLength(60);
    expect(count(r.content, '#EXT-X-DISCONTINUITY')).toBe(1);
  });

  it('T03 结尾广告', () => {
    const r = filterAdsFromM3U8(HEAD + main(60) + D + ad(5) + END, { baseUrl: BASE });
    expect(r.removedSegments).toBe(5);
    expect(r.content).toContain('#EXT-X-ENDLIST');
    expect(uris(r.content)).toHaveLength(60);
  });

  it('T04 多段广告', () => {
    const r = filterAdsFromM3U8(
      HEAD + ad(3) + D + main(30) + D + ad(3, 'https://x.example/promo') + D + main(30, 30) + END,
      { baseUrl: BASE }
    );
    expect(r.removedSegments).toBe(6);
    expect(uris(r.content)).toHaveLength(60);
  });

  it('T05 被删广告段声明的 KEY 会补回给正片', () => {
    const key = '#EXT-X-KEY:METHOD=AES-128,URI="k.key"\n';
    const r = filterAdsFromM3U8(HEAD + key + ad(3) + D + main(40) + END, { baseUrl: BASE });
    // 广告段与正片都在 KEY 生效范围内，KEY 必须出现在第一个正片分片之前
    expect(r.content.indexOf('#EXT-X-KEY')).toBeGreaterThan(-1);
    expect(r.content.indexOf('#EXT-X-KEY')).toBeLessThan(r.content.indexOf('seg0.ts'));
  });

  it('T06 fMP4 的 EXT-X-MAP 保留', () => {
    const map = '#EXT-X-MAP:URI="init.mp4"\n';
    const r = filterAdsFromM3U8(HEAD + map + ad(3) + D + main(40) + END, { baseUrl: BASE });
    expect(r.content.indexOf('#EXT-X-MAP')).toBeLessThan(r.content.indexOf('seg0.ts'));
  });

  it('T07 正片自身带标记（同特征多组）不删分片，保留标记', () => {
    const input = HEAD + main(20) + D + main(20, 20) + D + main(20, 40) + END;
    const r = filterAdsFromM3U8(input, { baseUrl: BASE });
    expect(r.removedSegments).toBe(0);
    expect(r.content).toBe(input);
  });

  it('T08 直播列表原样返回', () => {
    const input = HEAD + ad(3) + D + main(20);
    const r = filterAdsFromM3U8(input, { baseUrl: BASE });
    expect(r.content).toBe(input);
    expect(r.skippedReason).toBe('live-playlist');
  });

  it('T09 找不到明确正片原样返回', () => {
    const input = HEAD + ad(5, 'https://a.example/x') + D + ad(5, 'https://b.example/y') + D + ad(5, 'https://c.example/z') + END;
    const r = filterAdsFromM3U8(input, { baseUrl: BASE });
    expect(r.content).toBe(input);
  });

  it('T10 删除量超限原样返回', () => {
    const input = HEAD + main(14) + D + Array.from({ length: 7 }, (_, i) => seg(10, `https://o.example/p/q${i}.ts`)).join('') + END;
    const r = filterAdsFromM3U8(input, { baseUrl: BASE, maxAdSeconds: 200, maxAdShare: 0.9 });
    expect(r.content).toBe(input);
    expect(r.skippedReason).toBe('remove-too-much');
  });

  it('T11 相对路径与绝对路径广告混合', () => {
    const r = filterAdsFromM3U8(HEAD + main(40) + D + ad(4) + D + main(40, 40) + END, { baseUrl: BASE });
    expect(r.removedSegments).toBe(4);
  });

  it('T12 主列表原样返回', () => {
    const input = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nlow/index.m3u8\n';
    expect(filterAdsFromM3U8(input).content).toBe(input);
  });

  it('T13 损坏/空内容不抛异常', () => {
    expect(filterAdsFromM3U8('').content).toBe('');
    expect(filterAdsFromM3U8('garbage').content).toBe('garbage');
    expect(filterAdsFromM3U8('#EXTM3U\n#EXTINF:3,\n').content).toContain('#EXTINF');
  });

  it('T14 额外关键词命中较长的广告段', () => {
    const longAd = Array.from({ length: 12 }, (_, i) => seg(10, `https://v.cdn-b.example/20240101/promo-x/p${i}.ts`)).join('');
    const input = HEAD + main(100) + D + longAd + D + main(100, 100) + END;
    const without = filterAdsFromM3U8(input, { baseUrl: BASE });
    expect(without.removedSegments).toBe(0); // 120 秒 > 90 秒上限
    const withPattern = filterAdsFromM3U8(input, { baseUrl: BASE, extraPatterns: ['promo-x'] });
    expect(withPattern.removedSegments).toBe(12);
  });

  it('保持 CRLF 换行', () => {
    const r = filterAdsFromM3U8((HEAD + ad(3) + D + main(40) + END).replace(/\n/g, '\r\n'), { baseUrl: BASE });
    expect(r.removedSegments).toBe(3);
    expect(r.content).toContain('\r\n');
  });
});
