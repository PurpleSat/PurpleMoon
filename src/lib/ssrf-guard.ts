// 🛡️ 安全修复 (P1)：SSRF 防护工具。
// 本模块提供统一的地址合法性校验，供新增/编辑资源站的管理接口调用。

const PRIVATE_IPV4_RANGES: Array<(a: number, b: number) => boolean> = [
  (a) => a === 127, // 127.0.0.0/8 回环
  (a) => a === 10, // 10.0.0.0/8
  (a, b) => a === 192 && b === 168, // 192.168.0.0/16
  (a, b) => a === 172 && b >= 16 && b <= 31, // 172.16.0.0/12
  (a, b) => a === 169 && b === 254, // 169.254.0.0/16（含云平台元数据地址 169.254.169.254）
  (a) => a === 0, // 0.0.0.0/8
];

function isPrivateIPv4(hostname: string): boolean {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if ([a, b, Number(match[3]), Number(match[4])].some((n) => n > 255)) {
    // 非法 IPv4 字面量，交由后续逻辑处理，这里不拦截
    return false;
  }
  return PRIVATE_IPV4_RANGES.some((test) => test(a, b));
}

function isLoopbackOrLinkLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '[::1]') return true;
  if (h.startsWith('fe80:') || h.startsWith('[fe80:')) return true; // IPv6 链路本地
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // IPv6 唯一本地地址
  return false;
}

export interface UrlSafetyResult {
  ok: boolean;
  reason?: string;
}

/**
 * 校验一个由管理员填写的上游资源站地址是否安全可用作服务端出站请求目标。
 * 仅做字面量层面的协议 / 主机名校验（不做 DNS 解析），
 * 用于在写入配置前拦截明显的高危输入。
 */
export function checkUpstreamUrlSafety(rawUrl: string): UrlSafetyResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: '不是合法的 URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: '仅支持 http/https 协议' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: '不允许在地址中携带账号密码' };
  }

  const hostname = parsed.hostname;

  if (isLoopbackOrLinkLocalHostname(hostname)) {
    return { ok: false, reason: '不允许指向回环 / 链路本地地址' };
  }

  if (isPrivateIPv4(hostname)) {
    return { ok: false, reason: '不允许指向内网 / 私有 IP 地址' };
  }

  return { ok: true };
}
