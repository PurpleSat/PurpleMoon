import { ApiSite } from '@/lib/config';
import { resolveAccessibleSites } from '@/lib/site-access';
import { safeFetch } from '@/lib/safe-fetch';
import { checkUpstreamUrlSafety } from '@/lib/ssrf-guard';

/**
 * 解析并校验“源浏览”请求的目标资源站：
 * - 只允许管理员配置里已启用、且当前用户所在分组有权访问的资源站
 * - 出站前统一做 SSRF 校验
 */
export async function resolveBrowsableSite(
  request: Request,
  sourceKey: string | null
): Promise<{ site: ApiSite } | { error: string; status: number }> {
  if (!sourceKey) return { error: 'Missing source parameter', status: 400 };
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(sourceKey)) {
    return { error: 'Invalid source parameter', status: 400 };
  }

  const access = await resolveAccessibleSites(request);
  if (!access.ok) return { error: 'Unauthorized', status: 401 };
  const site = access.sites.find((s) => s.key === sourceKey);
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
