/** @jest-environment node */
import * as fs from 'fs';
import * as path from 'path';

import { filterAdsFromM3U8, stripDiscontinuityLegacy } from '../m3u8-ad-filter';

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

  // ---- 方案二 / 哈希文件名（真实源常见：广告与正片同域名同目录） ----
  const hashMain = (n: number) =>
    Array.from({ length: n }, (_, i) => seg(10, `${(i * 7919 + 123457).toString(16)}a${i}f9c2d41b.ts`)).join('');
  const sameDirAd = (n: number, dur = 4) =>
    Array.from({ length: n }, (_, i) => seg(dur, `ad${i}.ts`)).join('');

  it('T15 哈希文件名的正片不再导致“找不到正片”而放弃', () => {
    const r = filterAdsFromM3U8(HEAD + ad(4) + D + hashMain(60) + END, { baseUrl: BASE });
    expect(r.skippedReason).toBeUndefined();
    expect(r.removedSegments).toBe(4);
  });

  it('T16 广告与正片同目录，仅靠标记分隔：开头广告被删', () => {
    const r = filterAdsFromM3U8(HEAD + sameDirAd(5) + D + main(60) + END, { baseUrl: BASE });
    expect(r.removedSegments).toBe(5);
    expect(uris(r.content).every((u) => /^seg\d+\.ts$/.test(u))).toBe(true);
  });

  it('T17 同目录结尾广告被删', () => {
    const r = filterAdsFromM3U8(HEAD + main(60) + D + sameDirAd(4) + END, { baseUrl: BASE });
    expect(r.removedSegments).toBe(4);
  });

  it('T18 同目录中间广告：分片时长与正片明显不同才删', () => {
    const r = filterAdsFromM3U8(HEAD + main(30) + D + sameDirAd(5, 4) + D + main(30, 30) + END, { baseUrl: BASE });
    expect(r.removedSegments).toBe(5);
    // 时长与正片相同的中间段无法判断，保持原样
    const same = HEAD + main(30) + D + main(5, 100) + D + main(30, 30) + END;
    expect(filterAdsFromM3U8(same, { baseUrl: BASE }).removedSegments).toBe(0);
  });

  it('T19 标记过多（每几片一个）不启用兜底', () => {
    let body = '';
    for (let i = 0; i < 20; i++) body += D + main(3, i * 3);
    const input = HEAD + body + END;
    expect(filterAdsFromM3U8(input, { baseUrl: BASE }).removedSegments).toBe(0);
  });

  it('T20 原有规则：删除全部 DISCONTINUITY 行，其余原样', () => {
    const input = HEAD + main(3) + D + ad(2) + D + main(3, 3) + '#EXT-X-DISCONTINUITY-SEQUENCE:1\n' + END;
    const out = stripDiscontinuityLegacy(input);
    expect(out).not.toContain('#EXT-X-DISCONTINUITY');
    expect(uris(out)).toHaveLength(8);
    expect(stripDiscontinuityLegacy('')).toBe('');
  });

  it('T21 组合：先识别删除广告分片，再执行原有规则', () => {
    const r = filterAdsFromM3U8(HEAD + ad(4) + D + main(30) + D + sameDirAd(3) + D + main(30, 30) + END, { baseUrl: BASE });
    const out = stripDiscontinuityLegacy(r.content);
    expect(r.removedSegments).toBe(7);
    expect(out).not.toContain('#EXT-X-DISCONTINUITY');
    expect(uris(out)).toHaveLength(60);
  });

  // ---- 真实播放列表回归（用户抓取：如意 / 爱奇艺 / 电影天堂 / iKun） ----
  const fixture = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures', `${n}.m3u8`), 'utf8');
  const removedUris = (orig: string, out: string) => {
    const keep = new Set(uris(out));
    return uris(orig).filter((u) => !keep.has(u));
  };

  it('R1 iKun：只删 3 段 6 片的广告目录，绝不误删正片（曾误删 307 片）', () => {
    const src = fixture('ikun');
    const r = filterAdsFromM3U8(src, { baseUrl: 'https://kkzycdn.com:65/20251225/xa8G2g6Z/2598kb/hls/index.m3u8' });
    expect(r.removedSegments).toBe(18);
    expect(r.removedSeconds).toBeGreaterThan(52);
    expect(r.removedSeconds).toBeLessThan(54);
    const gone = removedUris(src, r.content);
    expect(gone).toHaveLength(18);
    expect(gone.every((u) => u.includes('/20261009/AcAa7mOH/10103kb/'))).toBe(true);
  });

  it('R2 爱奇艺：删中间 5 片（17.6 秒）广告', () => {
    const src = fixture('iqiyi');
    const r = filterAdsFromM3U8(src, { baseUrl: 'https://x.example/videos/20250313/67d2f4593ea9ee0b65133c76/dbc99b/index.m3u8' });
    expect(r.removedSegments).toBe(5);
    expect(removedUris(src, r.content).every((u) => u.startsWith('/stream/20261009/'))).toBe(true);
  });

  it('R3 如意：同目录哈希命名，删 5 个整 4 秒的广告块', () => {
    const src = fixture('ruyi');
    const r = filterAdsFromM3U8(src, { baseUrl: 'https://x.example/20260101/index.m3u8' });
    expect(r.removedSegments).toBe(5);
    expect(r.removedSeconds).toBeCloseTo(20, 1);
  });

  const removedRanges = (orig: string, out: string) => {
    const keep = new Set(uris(out));
    let pos = 0;
    let dur = 0;
    const rm: Array<[number, number]> = [];
    for (const l of orig.split('\n')) {
      if (l.startsWith('#EXTINF')) {
        dur = parseFloat(l.split(':')[1]);
      } else if (l && !l.startsWith('#')) {
        if (!keep.has(l)) rm.push([pos, pos + dur]);
        pos += dur;
      }
    }
    return rm;
  };

  it('R4 电影天堂（用户标注广告 4m58s-5m17s）：精确删除这一段', () => {
    const src = fixture('dyttzy-ad-4m58s');
    const r = filterAdsFromM3U8(src, { baseUrl: 'https://x.example/a/index.m3u8' });
    expect(r.removedSegments).toBe(5);
    expect(r.removedSeconds).toBeCloseTo(19.07, 1);
    const rm = removedRanges(src, r.content);
    expect(rm[0][0]).toBeCloseTo(298.2, 0);
    expect(rm[rm.length - 1][1]).toBeCloseTo(317.2, 0);
    // 其余内容原样保留
    expect(uris(r.content)).toHaveLength(uris(src).length - 5);
  });

  it('R4b 电影天堂另两份列表：同样的 2+3 片广告被删，其余不动', () => {
    const a = fixture('dyttzy');
    const ra = filterAdsFromM3U8(a, { baseUrl: 'https://x.example/a/index.m3u8' });
    expect(ra.removedSegments).toBe(5);
    expect(removedRanges(a, ra.content)[0][0]).toBeCloseTo(298.6, 0);
    const b = fixture('dyttzy-b');
    const rb = filterAdsFromM3U8(b, { baseUrl: 'https://x.example/a/index.m3u8' });
    expect(rb.removedSegments).toBe(5);
    expect(removedRanges(b, rb.content)[0][0]).toBeCloseTo(357.5, 0);
  });

  it('R4c iKun 1720kb / 魔都 3450kb：删广告目录的分片', () => {
    const a = fixture('kk-1720kb');
    expect(filterAdsFromM3U8(a, { baseUrl: 'https://x.example/20260821/8lDgvQQr/1720kb/hls/i.m3u8' }).removedSegments).toBe(6);
    const b = fixture('modu-3450kb');
    expect(filterAdsFromM3U8(b, { baseUrl: 'https://bf.modujx17.com/20260810/Y55PFmr3/3450kb/hls/i.m3u8' }).removedSegments).toBe(12);
  });

  it('R4d 整条同目录、无标记、带加密的列表（gszyi）：列表里没有任何特征，原样返回', () => {
    const src = fixture('gszyi-nomark');
    const r = filterAdsFromM3U8(src, { baseUrl: 'https://gs.gszyi.com:999/hls/661/20250712/2674876/index.m3u8' });
    expect(r.removedSegments).toBe(0);
    expect(r.content).toBe(src);
  });

  it('R5 随机文件名（含全字母 / 全数字）的正片不会被拆成广告', () => {
    const rnd = (i: number) => ['Q2NNHhgL', 'OPgAoWYf', 'tl6uPdt4', '12345678', 'ETNkman6', 'abcdefgh'][i % 6] + i;
    const body = Array.from({ length: 80 }, (_, i) => seg(5, `${rnd(i).slice(0, 8)}.ts`)).join('');
    const r = filterAdsFromM3U8(HEAD + body + END, { baseUrl: BASE });
    expect(r.removedSegments).toBe(0);
  });
});
