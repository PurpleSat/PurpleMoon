/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
/**
 * “去广告”自助学习（仅浏览器端）：
 * 有些资源站的广告和正片同域名、同目录、同命名、没有任何标记（或恰好是一整块），播放列表本身无法区分。
 * 但同一个站点往往反复插入同一支广告片，它的“分片时长序列”是固定的。
 * 在播放页按 F12 打开控制台，输入 `__adLearn(开始秒, 结束秒)`（进度条上广告的起止时间），
 * 就会把这段广告的时长序列记到本浏览器里，之后同站的影片会自动删除这支广告。
 */
import { fingerprintForRange, formatFingerprint, parseAdFingerprints } from '@/lib/m3u8-ad-filter';

export const AD_FP_STORAGE_KEY = 'purplemoon_ad_fingerprints';

let lastRaw = '';

/** 记录最近一次收到的（未过滤的）媒体播放列表 */
export function rememberRawPlaylist(content: string): void {
  if (content && content.includes('#EXTINF')) lastRaw = content;
}

export function readStoredFingerprintText(): string {
  try {
    return localStorage.getItem(AD_FP_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

/** 构建时注入的指纹 + 浏览器里自己学到的指纹 */
export function getCustomFingerprints(envText?: string): number[][] {
  return parseAdFingerprints([envText, readStoredFingerprintText()].filter(Boolean).join(';'));
}

export function learnAdFromRange(startSec: number, endSec: number, raw: string = lastRaw): string {
  const fp = fingerprintForRange(raw, Number(startSec), Number(endSec));
  const total = fp.reduce((a, b) => a + b, 0);
  if (fp.length < 3 || total < 5) {
    throw new Error(
      `这个时间段里只找到 ${fp.length} 个分片（共 ${total.toFixed(1)} 秒），太少了。` +
        `请输入进度条上广告的起止秒数，例如 __adLearn(296, 315)`
    );
  }
  if (total > 90) throw new Error(`这个时间段共 ${total.toFixed(1)} 秒，超过 90 秒，疑似选错了范围`);
  const text = formatFingerprint(fp);
  const exist = readStoredFingerprintText()
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);
  if (!exist.includes(text)) exist.push(text);
  localStorage.setItem(AD_FP_STORAGE_KEY, exist.join(';'));
  return text;
}

export function installAdLearnHelpers(): void {
  try {
    const w = window as any;
    if (w.__adLearn) return;
    w.__adLearn = (startSec: number, endSec: number) => {
      try {
        const text = learnAdFromRange(startSec, endSec);
        console.info(`[去广告] 已记住这支广告（${text.split(',').length} 个分片）。刷新页面后生效；同站其它影片里的同一支广告也会被删除。\n指纹：${text}`);
        return text;
      } catch (e: any) {
        console.warn(`[去广告] ${e?.message || e}`);
        return '';
      }
    };
    w.__adLearnClear = () => {
      try {
        localStorage.removeItem(AD_FP_STORAGE_KEY);
        console.info('[去广告] 已清除自己学到的广告指纹');
      } catch {
        // ignore
      }
    };
  } catch {
    // ignore
  }
}
