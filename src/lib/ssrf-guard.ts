// 🛡️ 安全加固 (SEC-03 / S-01 / S-02)：多进制 IPv4、完整 IPv6 解析、内嵌 IPv4 地址提取、内部域名与 DNS 重绑定防护
//
// 说明：
// - 本模块只能做“字面量”层面的校验。若某个公网域名的 DNS 解析结果指向内网，
//   在 Edge 运行时无法在此处发现；生产环境请配合出口防火墙 / 网络隔离。
// - WHATWG URL 会把 IPv4 的十进制/十六进制/八进制/短格式统一规范化，
//   把 IPv6 压缩为小写并把内嵌点分 IPv4 转为十六进制，这里仍对各种写法做防御性解析。

export interface UrlSafetyResult {
  ok: boolean;
  reason?: string;
}

/** 去掉 IPv6 方括号、结尾的点、zone id，并转小写 */
function normalizeHost(hostname: string): string {
  let h = hostname.toLowerCase().trim();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  const zone = h.indexOf('%');
  if (zone !== -1) h = h.slice(0, zone);
  // 去掉 FQDN 结尾的点（localhost. 与 localhost 等价）
  while (h.endsWith('.') && !h.includes(':')) h = h.slice(0, -1);
  return h;
}

/**
 * 按 inet_aton 语义解析 IPv4 字面量（1~4 段，每段可为十进制 / 0x 十六进制 / 0 开头八进制）。
 * 不是 IPv4 字面量时返回 null。
 */
function parseIpv4ToNumber(host: string): number | null {
  const parts = host.split('.');
  if (parts.length < 1 || parts.length > 4) return null;

  const vals: number[] = [];
  for (const p of parts) {
    let v: number;
    if (/^0x[0-9a-f]+$/i.test(p)) v = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) v = parseInt(p, 8);
    else if (/^\d+$/.test(p)) v = parseInt(p, 10);
    else return null;
    if (!Number.isFinite(v) || v < 0) return null;
    vals.push(v);
  }

  // 最后一段占据剩余所有字节，其余段各 1 字节
  const last = vals[vals.length - 1];
  const lastBytes = 5 - vals.length; // 1段→4字节, 2段→3字节, 3段→2字节, 4段→1字节
  if (last >= Math.pow(256, lastBytes)) return null;
  for (let i = 0; i < vals.length - 1; i++) {
    if (vals[i] > 255) return null;
  }

  let num = 0;
  for (let i = 0; i < vals.length - 1; i++) {
    num += vals[i] * Math.pow(256, 3 - i);
  }
  num += last;
  return num >>> 0;
}

/** 判定 32 位整数 IPv4 是否属于非公网地址 */
function isNonPublicIpv4(num: number): boolean {
  const a = (num >>> 24) & 0xff;
  const b = (num >>> 16) & 0xff;
  const c = (num >>> 8) & 0xff;

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 回环
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT（含阿里云元数据 100.100.100.200）
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 链路本地 / 云元数据
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF 协议分配
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 文档
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 基准测试
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 文档
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 文档
  if (a >= 224) return true; // 组播 + 保留 + 广播
  return false;
}

/**
 * 把 IPv6 字面量解析为 8 个 16 位组；解析失败返回 null。
 * 支持 :: 压缩与末尾内嵌点分 IPv4（如 ::ffff:127.0.0.1）。
 */
function parseIpv6(host: string): number[] | null {
  if (!host.includes(':')) return null;
  let h = host;

  // 末尾内嵌 IPv4 → 转成两个 16 位组
  const lastColon = h.lastIndexOf(':');
  const tail = h.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4ToNumber(tail);
    if (v4 === null || tail.split('.').length !== 4) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    h = h.slice(0, lastColon + 1) + hi + ':' + lo;
  }

  const dbl = h.split('::');
  if (dbl.length > 2) return null;

  const toGroups = (s: string): number[] | null => {
    if (s === '') return [];
    const out: number[] = [];
    for (const g of s.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const head = toGroups(dbl[0]);
  if (!head) return null;

  if (dbl.length === 1) {
    return head.length === 8 ? head : null;
  }

  const rest = toGroups(dbl[1]);
  if (!rest) return null;
  const missing = 8 - head.length - rest.length;
  if (missing < 1) return null;
  return [...head, ...new Array(missing).fill(0), ...rest];
}

function groupsToIpv4(hi: number, lo: number): number {
  return (((hi & 0xffff) << 16) | (lo & 0xffff)) >>> 0;
}

/** 判定 IPv6 是否属于非公网地址，或内嵌了非公网 IPv4 */
function isNonPublicIpv6(g: number[]): boolean {
  const allZero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);

  // ::/128 未指定、::1/128 回环
  if (allZero(0, 7) && (g[7] === 0 || g[7] === 1)) return true;

  // ::ffff:0:0/96 IPv4 映射地址
  if (allZero(0, 5) && g[5] === 0xffff) return isNonPublicIpv4(groupsToIpv4(g[6], g[7]));

  // ::/96 IPv4 兼容地址（已废弃，仍可能被部分栈当作 IPv4 路由）
  if (allZero(0, 6)) return isNonPublicIpv4(groupsToIpv4(g[6], g[7]));

  // ::ffff:0:0:0/96 IPv4 转换地址 (SIIT)
  if (allZero(0, 4) && g[4] === 0xffff && g[5] === 0) return isNonPublicIpv4(groupsToIpv4(g[6], g[7]));

  // 64:ff9b::/96 NAT64（内嵌 IPv4 在末 32 位）
  if (g[0] === 0x64 && g[1] === 0xff9b && allZero(2, 6)) return isNonPublicIpv4(groupsToIpv4(g[6], g[7]));

  // 64:ff9b:1::/48 本地使用 NAT64
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true;

  // 2002::/16 6to4（IPv4 在第 2、3 组）
  if (g[0] === 0x2002) return isNonPublicIpv4(groupsToIpv4(g[1], g[2]));

  // 2001::/32 Teredo：隧道地址，统一拦截
  if (g[0] === 0x2001 && g[1] === 0) return true;

  // 2001:db8::/32 文档地址
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;

  // 100::/64 丢弃前缀
  if (g[0] === 0x0100 && allZero(1, 4)) return true;

  // fc00::/7 唯一本地地址 (ULA) —— 按数值前缀判断，不是字符串前缀
  if ((g[0] & 0xfe00) === 0xfc00) return true;

  // fe80::/10 链路本地
  if ((g[0] & 0xffc0) === 0xfe80) return true;

  // fec0::/10 站点本地（已废弃）
  if ((g[0] & 0xffc0) === 0xfec0) return true;

  // ff00::/8 组播
  if ((g[0] & 0xff00) === 0xff00) return true;

  return false;
}

const INTERNAL_HOST_EXACT = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'instance-data.ec2.internal',
  'kubernetes',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

const INTERNAL_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.intranet',
  '.lan',
  '.home',
  '.corp',
  '.home.arpa',
  '.svc',
  '.cluster.local',
];

const REBINDING_SUFFIXES = [
  'nip.io',
  'sslip.io',
  'xip.io',
  'localtest.me',
  'lvh.me',
  'vcap.me',
  'traefik.me',
  '127-0-0-1.org.uk',
  'burpcollaborator.net',
  'oastify.com',
  'dnslog.cn',
  'ceye.io',
];

/** 拦截内部主机名、云元数据域名与已知 DNS 重绑定服务 */
function isInternalOrRebindingDomain(host: string): boolean {
  if (INTERNAL_HOST_EXACT.has(host)) return true;
  if (INTERNAL_HOST_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (REBINDING_SUFFIXES.some((s) => host === s || host.endsWith('.' + s))) return true;
  // 无点的单标签主机名通常是内网短名（http://db/、http://redis/）
  if (!host.includes('.') && !host.includes(':')) return true;
  return false;
}

/**
 * 校验一个由管理员填写的上游资源站地址是否安全可用作服务端出站请求目标。
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

  if (!parsed.hostname) {
    return { ok: false, reason: 'URL 缺少有效主机名' };
  }

  const host = normalizeHost(parsed.hostname);

  // 1. IPv6 字面量
  if (host.includes(':')) {
    const groups = parseIpv6(host);
    if (!groups) return { ok: false, reason: 'IPv6 地址格式无效' };
    if (isNonPublicIpv6(groups)) {
      return { ok: false, reason: '不允许指向 IPv6 回环、私有、隧道或内嵌内网 IPv4 的地址' };
    }
    return { ok: true };
  }

  // 2. IPv4 字面量（点分 / 整数 / 十六进制 / 八进制 / 短格式）
  const v4 = parseIpv4ToNumber(host);
  if (v4 !== null) {
    if (isNonPublicIpv4(v4)) {
      return { ok: false, reason: '不允许指向内网 / 私有 IP / 元数据地址' };
    }
    return { ok: true };
  }

  // 3. 域名：内部域名、云元数据域名、DNS 重绑定服务
  if (isInternalOrRebindingDomain(host)) {
    return { ok: false, reason: '不允许指向内部域名、元数据域名或 DNS 重绑定服务' };
  }

  return { ok: true };
}
