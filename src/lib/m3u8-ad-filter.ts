/**
 * m3u8 广告分片过滤（纯函数，无副作用，可单元测试）
 *
 * 思路：把播放列表按“分隔标记 / 分片特征变化”切成若干段，
 * 特征 = 域名 + 目录 + 文件名模板（数字替换为 #）。
 * 时长占比最大的特征视为正片；特征不同、足够短、占比足够小的段视为广告并整段删除。
 *
 * 原则：宁可漏过，也不误杀。任何不确定的情况都原样返回。
 */

export interface AdFilterOptions {
  /** 播放列表自身的 URL，用于把相对路径补全后再比较特征 */
  baseUrl?: string;
  /** 正片特征的最低时长占比，低于此值视为找不到明确正片 */
  minMainShare?: number;
  /** 单个广告段最长秒数 */
  maxAdSeconds?: number;
  /** 单个广告段占总时长的上限 */
  maxAdShare?: number;
  /** 预计删除总量占总时长的上限，超过则整条不过滤 */
  maxTotalRemovedShare?: number;
  /** 额外的广告关键词（域名或路径片段，不区分大小写） */
  extraPatterns?: string[];
}

export interface AdFilterResult {
  content: string;
  removedSegments: number;
  removedSeconds: number;
  /** 未过滤时的原因，便于调试 */
  skippedReason?: string;
}

const DEFAULTS = {
  minMainShare: 0.6,
  maxAdSeconds: 90,
  maxAdShare: 0.25,
  maxTotalRemovedShare: 0.3,
};

// 内置的常见广告路径关键词，只用于“非正片特征”的段，不会单独造成误删
export const DEFAULT_AD_PATTERNS = ['adjump', '/ads/', '/ad/', 'advert'];

interface Seg {
  lines: string[]; // 该分片的全部行（EXTINF、URI 及其前面的零散标签）
  duration: number;
  sig: string;
  uri: string;
  discontinuityBefore: boolean;
}

interface Run {
  segs: Seg[];
  sig: string;
  duration: number;
  discontinuityBefore: boolean;
  keyLine: string | null; // 该段开始时生效的 KEY
  mapLine: string | null; // 该段开始时生效的 MAP
}

function resolveUri(uri: string, baseUrl?: string): string {
  if (!baseUrl) return uri;
  try {
    return new URL(uri, baseUrl).toString();
  } catch {
    return uri;
  }
}

export function segmentSignature(uri: string, baseUrl?: string): string {
  const full = resolveUri(uri, baseUrl);
  let host = '';
  let path = full;
  try {
    const u = new URL(full);
    host = u.host;
    path = u.pathname;
  } catch {
    // 相对路径且没有 baseUrl：只用路径部分
    path = full.split('?')[0];
  }
  const idx = path.lastIndexOf('/');
  const dir = idx >= 0 ? path.slice(0, idx + 1) : '';
  const name = (idx >= 0 ? path.slice(idx + 1) : path).replace(/\d+/g, '#');
  return `${host}${dir}${name}`;
}

const isKeyOrMap = (l: string) => l.startsWith('#EXT-X-KEY') || l.startsWith('#EXT-X-MAP');

export function filterAdsFromM3U8(
  m3u8Content: string,
  options: AdFilterOptions = {}
): AdFilterResult {
  const passthrough = (reason: string): AdFilterResult => ({
    content: m3u8Content || '',
    removedSegments: 0,
    removedSeconds: 0,
    skippedReason: reason,
  });

  if (!m3u8Content) return passthrough('empty');
  const opt = { ...DEFAULTS, ...options };

  try {
    const eol = m3u8Content.includes('\r\n') ? '\r\n' : '\n';
    const lines = m3u8Content.split(/\r?\n/);

    if (!lines.some((l) => l.startsWith('#EXTINF'))) return passthrough('not-media-playlist');
    if (!lines.some((l) => l.startsWith('#EXT-X-ENDLIST'))) return passthrough('live-playlist');

    // ---- 解析 ----
    const header: string[] = [];
    const footer: string[] = [];
    const segs: Seg[] = [];
    let pending: string[] = [];
    let pendingDisc = false;
    let duration = 0;
    let started = false;
    let curKey: string | null = null;
    let curMap: string | null = null;
    const segKey: (string | null)[] = [];
    const segMap: (string | null)[] = [];
    // 记录每个分片“开始前”最近出现的 KEY/MAP 声明状态
    for (const line of lines) {
      if (line === '') continue;
      if (line.startsWith('#EXT-X-ENDLIST')) {
        footer.push(line);
        continue;
      }
      if (!started && !line.startsWith('#EXTINF') && !line.startsWith('#EXT-X-DISCONTINUITY') && !isKeyOrMap(line) && !line.startsWith('#EXT-X-PROGRAM-DATE-TIME')) {
        header.push(line);
        continue;
      }
      started = true;
      if (line.startsWith('#EXT-X-DISCONTINUITY')) {
        // 不含 -SEQUENCE
        if (line.trim() === '#EXT-X-DISCONTINUITY') {
          pendingDisc = true;
          continue;
        }
        header.push(line);
        continue;
      }
      if (line.startsWith('#EXT-X-KEY')) curKey = line;
      if (line.startsWith('#EXT-X-MAP')) curMap = line;
      if (line.startsWith('#EXTINF')) {
        const m = /#EXTINF:\s*([\d.]+)/.exec(line);
        duration = m ? parseFloat(m[1]) : 0;
        pending.push(line);
        continue;
      }
      if (line.startsWith('#')) {
        pending.push(line);
        continue;
      }
      // URI 行
      pending.push(line);
      segs.push({
        lines: pending,
        duration,
        sig: segmentSignature(line.trim(), options.baseUrl),
        uri: resolveUri(line.trim(), options.baseUrl),
        discontinuityBefore: pendingDisc,
      });
      segKey.push(curKey);
      segMap.push(curMap);
      pending = [];
      pendingDisc = false;
      duration = 0;
    }
    if (pending.length > 0) return passthrough('dangling-lines');
    if (segs.length === 0) return passthrough('no-segments');

    // ---- 切成 run：遇到分隔标记或特征变化就开新段 ----
    const runs: Run[] = [];
    segs.forEach((s, i) => {
      const last = runs[runs.length - 1];
      if (last && !s.discontinuityBefore && last.sig === s.sig) {
        last.segs.push(s);
        last.duration += s.duration;
      } else {
        runs.push({
          segs: [s],
          sig: s.sig,
          duration: s.duration,
          discontinuityBefore: s.discontinuityBefore,
          keyLine: segKey[i],
          mapLine: segMap[i],
        });
      }
    });

    const total = runs.reduce((a, r) => a + r.duration, 0);
    if (total <= 0) return passthrough('zero-duration');

    // ---- 找正片特征 ----
    const bySig = new Map<string, number>();
    for (const r of runs) bySig.set(r.sig, (bySig.get(r.sig) || 0) + r.duration);
    let mainSig = '';
    let mainDur = 0;
    bySig.forEach((d, sig) => {
      if (d > mainDur) {
        mainDur = d;
        mainSig = sig;
      }
    });
    if (mainDur / total < opt.minMainShare) return passthrough('no-clear-main');

    // ---- 判定广告 ----
    const patterns = [...DEFAULT_AD_PATTERNS, ...(opt.extraPatterns || [])]
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    const isAd = runs.map((r) => {
      if (r.sig === mainSig) return false;
      if (r.duration > opt.maxAdSeconds) return false;
      if (r.duration / total > opt.maxAdShare) return false;
      return true;
    });
    // 命中关键词的非正片段，即使略长也算（仍受总量上限约束）
    runs.forEach((r, i) => {
      if (isAd[i] || r.sig === mainSig) return;
      const u = r.segs[0].uri.toLowerCase();
      if (patterns.some((p) => u.includes(p)) && r.duration / total <= opt.maxAdShare) isAd[i] = true;
    });

    const removedSeconds = runs.reduce((a, r, i) => a + (isAd[i] ? r.duration : 0), 0);
    const removedSegments = runs.reduce((a, r, i) => a + (isAd[i] ? r.segs.length : 0), 0);
    if (removedSegments === 0) return passthrough('no-ads-found');
    if (removedSeconds / total > opt.maxTotalRemovedShare) return passthrough('remove-too-much');
    if (removedSegments === segs.length) return passthrough('would-be-empty');

    // ---- 重建 ----
    const out: string[] = [...header];
    let emittedKey: string | null = null;
    let emittedMap: string | null = null;
    let carryDisc = false;
    let firstOut = true;
    runs.forEach((r, i) => {
      if (isAd[i]) {
        if (r.discontinuityBefore) carryDisc = true;
        return;
      }
      const needDisc = (r.discontinuityBefore || carryDisc) && !firstOut;
      carryDisc = false;
      if (needDisc) out.push('#EXT-X-DISCONTINUITY');
      const first = r.segs[0].lines;
      const ownKey = first.some((l) => l.startsWith('#EXT-X-KEY'));
      const ownMap = first.some((l) => l.startsWith('#EXT-X-MAP'));
      // 被删段里声明的 KEY/MAP 需要补回，否则后面的分片会解不开
      if (!ownKey && r.keyLine && r.keyLine !== emittedKey) out.push(r.keyLine);
      if (!ownMap && r.mapLine && r.mapLine !== emittedMap) out.push(r.mapLine);
      r.segs.forEach((s) => {
        s.lines.forEach((l) => {
          if (l.startsWith('#EXT-X-KEY')) emittedKey = l;
          if (l.startsWith('#EXT-X-MAP')) emittedMap = l;
          out.push(l);
        });
      });
      if (!ownKey && r.keyLine) emittedKey = r.keyLine;
      if (!ownMap && r.mapLine) emittedMap = r.mapLine;
      firstOut = false;
    });
    out.push(...footer);

    return {
      content: out.join(eol) + eol,
      removedSegments,
      removedSeconds,
    };
  } catch {
    return passthrough('parse-error');
  }
}
