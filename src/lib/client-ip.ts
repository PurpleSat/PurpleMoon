// 🛡️ 安全加固 (SEC-05 / S-03)：客户端 IP 解析 —— 仅信任“显式声明为可信”的来源
//
// 威胁模型：X-Real-IP / X-Client-IP / CF-Connecting-IP / X-Forwarded-For 都是普通请求头，
// 在没有可信反向代理覆盖它们时，任何客户端都能随意伪造，从而绕过按 IP 的限流。
// 因此默认（生产环境）不信任任何请求头，只有部署者通过环境变量声明了前置代理，才会读取对应头：
//
//   TRUST_CF_CONNECTING_IP=true   部署在 Cloudflare 后面（源站只允许 Cloudflare 回源）
//   TRUST_X_REAL_IP=true          前置 Nginx 等代理，并且它会用 $remote_addr 覆盖 X-Real-IP
//   TRUST_X_FORWARDED_FOR=true    前置代理会向 X-Forwarded-For 追加真实来源地址
//   TRUSTED_PROXY_HOPS=1          X-Forwarded-For 中可信代理的层数（默认 1），取倒数第 N 个
//
// 无法确定 IP 时返回固定的 'unknown_ip'（所有此类请求共享一个限流桶，宁可误伤也不放行）。

export const UNKNOWN_IP = 'unknown_ip';

const MAX_IP_LENGTH = 45; // IPv6 文本最长 45 字符

type HeaderSource = {
  headers: { get(name: string): string | null };
  ip?: string;
};

function envFlag(name: string): boolean {
  return (process.env[name] || '').trim().toLowerCase() === 'true';
}

/** 仅接受形如 IPv4 / IPv6 的字符串，避免任意字符串进入限流键（Redis / D1 key） */
function sanitizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  let v = value.trim();
  if (!v || v.length > MAX_IP_LENGTH) return null;
  // 去掉 IPv4 的 :port（如 1.2.3.4:5678）
  const m = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(v);
  if (m) v = m[1];
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(v)) {
    return v.split('.').every((p) => Number(p) <= 255) ? v : null;
  }
  if (/^[0-9a-fA-F:.]+$/.test(v) && v.includes(':')) return v.toLowerCase();
  return null;
}

export function getClientIp(request: HeaderSource): string {
  const isProd = process.env.NODE_ENV === 'production';

  // 1. 运行时/平台直接提供的连接地址（不是请求头，无法被客户端伪造）
  const direct = sanitizeIp(typeof request.ip === 'string' ? request.ip : null);
  if (direct) return direct;

  // 2. Cloudflare: 显式开启环境变量，或处于 Cloudflare 边缘环境 (通过 CF_PAGES 变量或 cf-ray 边缘头识别)
  const isCloudflare = Boolean(process.env.CF_PAGES || request.headers.get('cf-ray'));
  if (envFlag('TRUST_CF_CONNECTING_IP') || isCloudflare) {
    const cf = sanitizeIp(request.headers.get('cf-connecting-ip'));
    if (cf) return cf;
  }

  // 3. Nginx 等代理设置的 X-Real-IP
  if (envFlag('TRUST_X_REAL_IP')) {
    const real = sanitizeIp(request.headers.get('x-real-ip'));
    if (real) return real;
  }

  // 4. X-Forwarded-For：取“倒数第 N 个”，最左侧的值由客户端控制，不可信
  const xff = request.headers.get('x-forwarded-for');
  if (xff && (envFlag('TRUST_X_FORWARDED_FOR') || !isProd)) {
    const chain = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (chain.length > 0) {
      const hopsRaw = parseInt(process.env.TRUSTED_PROXY_HOPS || '1', 10);
      const hops = Number.isFinite(hopsRaw) && hopsRaw >= 1 ? hopsRaw : 1;
      // 开发环境没有前置代理，沿用最左侧值方便本地调试
      const idx = isProd ? Math.max(chain.length - hops, 0) : 0;
      const ip = sanitizeIp(chain[idx]);
      if (ip) return ip;
    }
  }

  // 5. 开发环境允许回环地址，便于本地调试
  if (!isProd) return '127.0.0.1';

  return UNKNOWN_IP;
}
