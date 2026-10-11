import { ApiSite, getAvailableApiSites } from '@/lib/config';
import { safeFetch } from '@/lib/safe-fetch';
import { checkUpstreamUrlSafety } from '@/lib/ssrf-guard';

/**
 * 解析并校验“源浏览”请求的目标资源站：
 * - 只允许管理员配置里已启用的资源站（遵循后台的禁用/新增，而不是读取打包进来的静态 config.json）
 * - 出站前统一做 SSRF 校验
 */
export async function resolveBrowsableSite(
  sourceKey: string | null
): Promise<{ site: ApiSite } | { error: string; status: number }> {
  if (!sourceKey) return { error: 'Missing source parameter', status: 400 };
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(sourceKey)) {
    return { error: 'Invalid source parameter', status: 400 };
  }

  const sites = await getAvailableApiSites();
  const site = sites.find((s) => s.key === sourceKey);
  if (!site || !site.api) return { error: 'Source not found', status: 404 };

  const safety = checkUpstreamUrlSafety(site.api);
  if (!safety.ok) return { error: 'Source not available', status: 400 };

  return { site };
}

/** 带超时的上游 JSON 请求 */
export async function fetchUpstreamJson(url: string, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await safeFetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`upstream status ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
