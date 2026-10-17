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
  maxAdShare: 0.1,
  maxTotalRemovedShare: 0.12,
};

// 内置的常见广告路径关键词，只用于“非正片特征”的段，不会单独造成误删
export const DEFAULT_AD_PATTERNS = ['adjump', '/ads/', '/ad/', 'advert'];

interface Seg {
  lines: string[]; // 该分片的全部行（EXTINF、URI 及其前面的零散标签）
  duration: number;
  sig: string;
  dirKey: string;
  uri: string;
  discontinuityBefore: boolean;
}

interface Run {
  segs: Seg[];
  sig: string;
  dirKey: string;
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
  const rawName = idx >= 0 ? path.slice(idx + 1) : path;
  return `${host}${dir}${normalizeName(rawName)}`;
}

/**
 * 文件名模板化：
 * - “字母 + 数字”的顺序命名（seg001.ts / index00123.ts）→ 数字替换为 #
 * - 其余 8 位以上的字母数字串视为随机/哈希文件名（如 a3f9c2d41b.ts、Q2NNHhgL.ts），
 *   只保留“长度档位 + 扩展名”。注意随机串可能全是字母、也可能全是数字，不能依赖“含数字”来判断，
 *   否则同一目录的正片会被拆成许多“不同特征”的短段而被误删。
 */
function normalizeName(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  if (/^[A-Za-z_-]*\d+$/.test(stem)) return name.replace(/\d+/g, '#');
  if (/^[0-9a-zA-Z_-]{8,}$/.test(stem)) return `~${Math.round(stem.length / 4) * 4}${ext}`;
  return name.replace(/\d+/g, '#');
}

/** 域名 + 目录（不含文件名），用于判断“来源是否不同” */
function dirKeyOf(uri: string, baseUrl?: string): string {
  const sig = segmentSignature(uri, baseUrl);
  const idx = sig.lastIndexOf('/');
  return idx >= 0 ? sig.slice(0, idx + 1) : '';
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
        dirKey: dirKeyOf(line.trim(), options.baseUrl),
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
    const makeRuns = (splitOnSig: boolean): Run[] => {
      const rs: Run[] = [];
      segs.forEach((s, i) => {
        const last = rs[rs.length - 1];
        if (last && !s.discontinuityBefore && (!splitOnSig || last.sig === s.sig)) {
          last.segs.push(s);
          last.duration += s.duration;
        } else {
          rs.push({
            segs: [s],
            sig: s.sig,
            dirKey: s.dirKey,
            duration: s.duration,
            discontinuityBefore: s.discontinuityBefore,
            keyLine: segKey[i],
            mapLine: segMap[i],
          });
        }
      });
      return rs;
    };

    const patterns = [...DEFAULT_AD_PATTERNS, ...(opt.extraPatterns || [])]
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);

    // ---- 方案一：按分片特征（域名/目录/文件名模板）区分 ----
    let runs = makeRuns(true);
    let isAd: boolean[] = [];
    let reason = '';
    const total = runs.reduce((a, r) => a + r.duration, 0);
    if (total <= 0) return passthrough('zero-duration');

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
    if (mainDur / total < opt.minMainShare) {
      reason = 'no-clear-main';
    } else {
      const mainRun = runs.find((r) => r.sig === mainSig);
      const mainDir = mainRun ? mainRun.dirKey : '';
      isAd = runs.map((r, i) => {
        if (r.sig === mainSig) return false;
        if (r.duration > opt.maxAdSeconds) return false;
        if (r.duration / total > opt.maxAdShare) return false;
        // 只有文件名模板不同不算证据（命名噪声会把正片误判成广告）：
        // 必须“域名/目录与正片不同”或“两侧有 DISCONTINUITY 分隔”
        const boundary = r.discontinuityBefore || !!(runs[i + 1] && runs[i + 1].discontinuityBefore);
        return r.dirKey !== mainDir || boundary;
      });
      // 命中关键词的非正片段，即使略长也算（仍受总量上限约束）
      runs.forEach((r, i) => {
        if (isAd[i] || r.sig === mainSig) return;
        const u = r.segs[0].uri.toLowerCase();
        if (patterns.some((p) => u.includes(p)) && r.duration / total <= opt.maxAdShare) isAd[i] = true;
      });
      if (!isAd.some(Boolean)) reason = 'no-ads-found';
    }

    // ---- 方案二（兜底）：广告与正片同域名同目录同命名，只能靠分隔标记 / 时长特征 ----
    // 依据真实列表（如意 / 电影天堂 / iKun / 爱奇艺源）总结出两条规则，只在方案一无结果时启用：
    //  规则 B（标记较少的列表，2~12 段）：最长一段占 ≥55% 时长作为正片；候选段 ≤ maxAdSeconds，
    //        位于开头/结尾，或中间段的分片时长与正片明显不同。
    //  规则 D（定长分块型源）见下方。
    //  规则 C（任意数量的标记）：被标记隔开、且“分片时长完全相同”（如 5 个 4.000 秒）的段——
    //        广告片按固定分片长度单独转码，正片则按关键帧切，时长参差不齐。
    //        要求这类段在列表里占比很小，且相邻的此类段合计不超过 maxAdSeconds。
    if (reason) {
      const dRuns = makeRuns(false);
      const dTotal = dRuns.reduce((a, r) => a + r.duration, 0);
      const cand: boolean[] = dRuns.map(() => false);
      if (dRuns.length >= 2 && dTotal > 0) {
        // 规则 B
        if (dRuns.length <= 12) {
          let longest = 0;
          dRuns.forEach((r, i) => {
            if (r.duration > dRuns[longest].duration) longest = i;
          });
          if (dRuns[longest].duration / dTotal >= 0.55) {
            const median = (r: Run) => {
              const d = r.segs.map((x) => x.duration).sort((x, y) => x - y);
              return d[Math.floor(d.length / 2)] || 0;
            };
            const mainMed = median(dRuns[longest]);
            dRuns.forEach((r, i) => {
              if (i === longest) return;
              if (r.duration > opt.maxAdSeconds || r.duration / dTotal > opt.maxAdShare) return;
              if (i === 0 || i === dRuns.length - 1) {
                cand[i] = true;
                return;
              }
              const m = median(r);
              if (mainMed > 0 && Math.abs(m - mainMed) / mainMed > 0.2) cand[i] = true;
            });
          }
        }
        // 规则 C
        const isUniform = (r: Run) =>
          r.segs.length >= 3 && r.segs.every((x) => Math.abs(x.duration - r.segs[0].duration) < 0.002);
        const uni = dRuns.map(isUniform);
        const uniSeconds = dRuns.reduce((a, r, i) => a + (uni[i] ? r.duration : 0), 0);
        if (uni.some(Boolean) && uniSeconds / dTotal <= opt.maxAdShare && uni.some((u) => !u)) {
          dRuns.forEach((_, i) => {
            if (uni[i]) cand[i] = true;
          });
        }
        // 规则 D（“定长分块”型源，如电影天堂 / 如意）：提供方把正片每 5 个分片切成一块并插入标记；
        //        广告插入后，块边界被打乱，出现“相邻的几个不足整块的小段，且分片数之和恰好等于整块大小”。
        //        实测：4m58s–5m17s 的广告 = 相邻两段（2 片 + 3 片，共 19.07 秒）。
        //        只在“绝大多数段都是同一个整块大小”时启用，并要求窗口时长 5~40 秒。
        const sizeCount = new Map<number, number>();
        dRuns.forEach((r) => sizeCount.set(r.segs.length, (sizeCount.get(r.segs.length) || 0) + 1));
        let chunk = 0;
        let chunkN = 0;
        sizeCount.forEach((n, sz) => {
          if (n > chunkN) {
            chunkN = n;
            chunk = sz;
          }
        });
        if (chunk >= 3 && chunkN / dRuns.length >= 0.5) {
          for (let a = 0; a < dRuns.length; a++) {
            let sum = 0;
            let secs = 0;
            let b = a;
            while (b < dRuns.length && dRuns[b].segs.length < chunk && sum < chunk) {
              sum += dRuns[b].segs.length;
              secs += dRuns[b].duration;
              b++;
            }
            if (sum === chunk && b - a >= 2 && secs >= 5 && secs <= 40) {
              for (let x = a; x < b; x++) cand[x] = true;
              a = b - 1;
            }
          }
        }
        // 相邻候选合并为“簇”：簇总时长超过 maxAdSeconds 视为信息不足（可能是片尾字幕等），整簇放弃
        let k = 0;
        while (k < dRuns.length) {
          if (!cand[k]) {
            k++;
            continue;
          }
          let e = k;
          let sum = 0;
          while (e < dRuns.length && cand[e]) {
            sum += dRuns[e].duration;
            e++;
          }
          if (sum > opt.maxAdSeconds) for (let x = k; x < e; x++) cand[x] = false;
          k = e;
        }
      }
      if (cand.some(Boolean)) {
        runs = dRuns;
        isAd = cand;
        reason = '';
      }
    }
    if (reason) return passthrough(reason);

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

/**
 * 原有规则（与最初版本 play 页中的 filterAdsFromM3U8 完全一致，保持不变）：
 * 删除播放列表里所有包含 #EXT-X-DISCONTINUITY 的行。
 * 实测在多数源上能让播放器越过广告；配合 filterAdsFromM3U8 使用时必须放在它之后
 * （后者要靠这些标记来识别广告段）。
 */
export function stripDiscontinuityLegacy(m3u8Content: string): string {
  if (!m3u8Content) return '';
  const lines = m3u8Content.split('\n');
  const filteredLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('#EXT-X-DISCONTINUITY')) {
      filteredLines.push(line);
    }
  }
  return filteredLines.join('\n');
}
