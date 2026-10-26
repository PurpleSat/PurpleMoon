/* eslint-disable @typescript-eslint/no-explicit-any */
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

/** 上游响应体上限：资源站的列表/详情 JSON 通常远小于此值 */
export const MAX_UPSTREAM_BYTES = 4 * 1024 * 1024;

/**
 * 🛡️ 安全修复 (S-06)：按字节上限读取上游响应体。
 * 以前直接 response.json()/text()，恶意或被攻陷的资源站可以返回超大响应占满内存。
 * 先看 Content-Length，再流式累计字节，超限立即取消读取并抛错。
 */
export async function readTextLimited(
  res: Response,
  maxBytes = MAX_UPSTREAM_BYTES
): Promise<string> {
  const declared = Number(res.headers.get('content-length') || '0');
  if (declared > maxBytes) {
    throw new Error('上游响应体过大');
  }
  if (!res.body) return await res.text();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error('上游响应体过大');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function readJsonLimited(
  res: Response,
  maxBytes = MAX_UPSTREAM_BYTES
): Promise<any> {
  return JSON.parse(await readTextLimited(res, maxBytes));
}
