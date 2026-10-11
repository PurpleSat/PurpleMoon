import { checkUpstreamUrlSafety } from './ssrf-guard';

const MAX_REDIRECTS = 3;

/**
 * 出站请求封装：逐跳校验重定向目标。
 *
 * 原生 fetch 会自动跟随 3xx，一个“看起来安全”的公网资源站只需返回
 * `302 Location: http://169.254.169.254/...` 就能绕过入口处的 URL 校验（SSRF）。
 * 这里手动跟随重定向，每一跳都重新做安全校验，并限制最大跳数。
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const safety = checkUpstreamUrlSafety(current);
    if (!safety.ok) {
      throw new Error(`拒绝访问不安全的上游地址: ${safety.reason}`);
    }

    const res = await fetch(current, { ...init, redirect: 'manual' });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return res;
      try {
        current = new URL(location, current).toString();
      } catch {
        throw new Error('上游返回了无效的重定向地址');
      }
      continue;
    }

    return res;
  }

  throw new Error('上游重定向次数过多');
}
