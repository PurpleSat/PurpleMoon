/* eslint-disable */

// ============================================================================
// 🛡️ 安全加固版 Cloudflare Worker 反向代理 (SEC-NEW-03)
// 默认拒绝（fail-closed），仅允许：
//   1) 携带正确共享密钥（PROXY_SECRET，通过 Worker 环境变量配置）的请求；
//   2) 目标域名命中显式配置的白名单（ALLOWED_PROXY_HOSTS，逗号分隔）；
//   3) 目标不是回环 / 内网 / 链路本地 / 隧道 / IPv4映射等非公网地址（与 ssrf-guard.ts 完全对齐）；
//   4) 重定向目标同样经过基准 URL 补全、域名白名单与 SSRF 安全校验。
// ============================================================================

if (typeof addEventListener === 'function') {
  addEventListener('fetch', (event) => {
    event.respondWith(handleRequest(event.request));
  });
}

// 恒定时间比较防范时序侧信道
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/** 去掉 IPv6 方括号、结尾的点、zone id，并转小写 */
function normalizeHost(hostname) {
  let h = String(hostname || '').toLowerCase().trim();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  const zone = h.indexOf('%');
  if (zone !== -1) h = h.slice(0, zone);
  while (h.endsWith('.') && !h.includes(':')) h = h.slice(0, -1);
  return h;
}

/**
 * 按 inet_aton 语义解析 IPv4 字面量（1~4 段，每段可为十进制 / 0x 十六进制 / 0 开头八进制）。
 */
function parseIpv4ToNumber(host) {
  const parts = host.split('.');
  if (parts.length < 1 || parts.length > 4) return null;

  const vals = [];
  for (const p of parts) {
    let v;
    if (/^0x[0-9a-f]+$/i.test(p)) v = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) v = parseInt(p, 8);
    else if (/^\d+$/.test(p)) v = parseInt(p, 10);
    else return null;
    if (!Number.isFinite(v) || v < 0) return null;
    vals.push(v);
  }

  const last = vals[vals.length - 1];
  const lastBytes = 5 - vals.length;
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

function isNonPublicIpv4(num) {
  const a = (num >>> 24) & 0xff;
  const b = (num >>> 16) & 0xff;
  const c = (num >>> 8) & 0xff;

  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function parseIpv6(host) {
  if (!host.includes(':')) return null;
  let h = host;

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

  const toGroups = (s) => {
    if (s === '') return [];
    const out = [];
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

function groupsToIpv4(hi, lo) {
  return (((hi & 0xffff) << 16) | (lo & 0xffff)) >>> 0;
}

function isNonPublicIpv6(g) {
  const allZero = (from, to) => g.slice(from, to).every((x) => x === 0);

  if (allZero(0, 7) && (g[7] === 0 || g[7] === 1)) return true;
  if (allZero(0, 5) && g[5] === 0xffff) return isNonPublicIpv4(groupsToIpv4(g[6], g[7]));
  if (allZero(0, 6)) return isNonPublicIpv4(groupsToIpv4(g[6], g[7]));
  if (allZero(0, 4) && g[4] === 0xffff && g[5] === 0) return isNonPublicIpv4(groupsToIpv4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && allZero(2, 6)) return isNonPublicIpv4(groupsToIpv4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true;
  if (g[0] === 0x2002) return isNonPublicIpv4(groupsToIpv4(g[1], g[2]));
  if (g[0] === 0x2001 && g[1] === 0) return true;
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;
  if (g[0] === 0x0100 && allZero(1, 4)) return true;
  if ((g[0] & 0xfe00) === 0xfc00) return true;
  if ((g[0] & 0xffc0) === 0xfe80) return true;
  if ((g[0] & 0xffc0) === 0xfec0) return true;
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

function isPrivateOrLoopbackHost(hostname) {
  const host = normalizeHost(hostname);
  if (!host) return true;

  if (host.includes(':')) {
    const groups = parseIpv6(host);
    if (!groups) return true;
    return isNonPublicIpv6(groups);
  }

  const ipv4Num = parseIpv4ToNumber(host);
  if (ipv4Num !== null) {
    return isNonPublicIpv4(ipv4Num);
  }

  if (INTERNAL_HOST_EXACT.has(host)) return true;
  if (INTERNAL_HOST_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (REBINDING_SUFFIXES.some((s) => host === s || host.endsWith('.' + s))) return true;
  if (!host.includes('.')) return true;

  return false;
}

function isAllowedHost(hostname, allowedHostsCsv) {
  if (!allowedHostsCsv) return false;
  const allowed = allowedHostsCsv
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const h = normalizeHost(hostname);
  return allowed.some((pattern) => h === pattern || h.endsWith(`.${pattern}`));
}

function getProxySecret() {
  // eslint-disable-next-line no-undef
  return typeof PROXY_SECRET !== 'undefined' ? PROXY_SECRET : undefined;
}

function getAllowedProxyHosts() {
  // eslint-disable-next-line no-undef
  return typeof ALLOWED_PROXY_HOSTS !== 'undefined' ? ALLOWED_PROXY_HOSTS : undefined;
}

async function handleRequest(request) {
  try {
    const url = new URL(request.url);

    if (url.pathname === '/') {
      return new Response(getRootHtml(), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    }

    const configuredSecret = getProxySecret();
    const allowedHostsCsv = getAllowedProxyHosts();

    if (!configuredSecret) {
      return jsonResponse(
        { error: 'Proxy disabled: PROXY_SECRET is not configured on this Worker.' },
        503
      );
    }

    const providedSecret =
      request.headers.get('x-proxy-token') || url.searchParams.get('token');
    if (!providedSecret || !timingSafeEqual(providedSecret, configuredSecret)) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    url.searchParams.delete('token');

    let actualUrlStr = decodeURIComponent(url.pathname.replace('/', ''));
    actualUrlStr = ensureProtocol(actualUrlStr, url.protocol);

    const remainingSearch = url.search;
    if (remainingSearch) {
      actualUrlStr += actualUrlStr.includes('?')
        ? remainingSearch.replace('?', '&')
        : remainingSearch;
    }

    const targetUrl = new URL(actualUrlStr);

    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      return jsonResponse({ error: 'Only http/https targets are allowed' }, 400);
    }

    if (targetUrl.username || targetUrl.password) {
      return jsonResponse({ error: 'Credentials in URL are not allowed' }, 400);
    }

    if (!isAllowedHost(targetUrl.hostname, allowedHostsCsv)) {
      return jsonResponse({ error: 'Target host is not allowed' }, 403);
    }

    if (isPrivateOrLoopbackHost(targetUrl.hostname)) {
      return jsonResponse({ error: 'Target host is not allowed' }, 403);
    }

    const newHeaders = filterHeaders(
      request.headers,
      (name) => !name.startsWith('cf-') && name.toLowerCase() !== 'x-proxy-token'
    );

    const modifiedRequest = new Request(targetUrl.toString(), {
      headers: newHeaders,
      method: request.method,
      body: request.body,
      redirect: 'manual',
    });

    const response = await fetch(modifiedRequest);
    let body = response.body;

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      return handleRedirect(response, body, targetUrl.toString(), allowedHostsCsv);
    } else if (response.headers.get('Content-Type')?.includes('text/html')) {
      body = await handleHtmlContent(
        response,
        url.protocol,
        url.host,
        targetUrl.toString()
      );
    }

    const modifiedResponse = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });

    setNoCacheHeaders(modifiedResponse.headers);
    setCorsHeaders(modifiedResponse.headers);

    return modifiedResponse;
  } catch (error) {
    return jsonResponse(
      {
        error: 'Proxy request failed',
      },
      500
    );
  }
}

function ensureProtocol(url, defaultProtocol) {
  return url.startsWith('http://') || url.startsWith('https://')
    ? url
    : defaultProtocol + '//' + url;
}

// 🛡️ 安全修复 (SEC-NEW-03)：支持相对路径重定向解析，并对重定向目标同样执行白名单与 SSRF 拦截
function handleRedirect(response, body, baseUrlStr, allowedHostsCsv) {
  const rawLocation = response.headers.get('location');
  if (!rawLocation) {
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });
  }

  let locationUrl;
  try {
    locationUrl = new URL(rawLocation, baseUrlStr);
  } catch {
    return jsonResponse({ error: 'Invalid redirect location' }, 502);
  }

  if (locationUrl.protocol !== 'http:' && locationUrl.protocol !== 'https:') {
    return jsonResponse({ error: 'Redirect target protocol is not allowed' }, 403);
  }

  if (
    !isAllowedHost(locationUrl.hostname, allowedHostsCsv) ||
    isPrivateOrLoopbackHost(locationUrl.hostname)
  ) {
    return jsonResponse({ error: 'Redirect target host is not allowed' }, 403);
  }

  const modifiedLocation = `/${encodeURIComponent(locationUrl.toString())}`;
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set('Location', modifiedLocation);
  setNoCacheHeaders(responseHeaders);
  setCorsHeaders(responseHeaders);

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

async function handleHtmlContent(response, protocol, host, actualUrlStr) {
  const originalText = await response.text();
  return replaceRelativePaths(
    originalText,
    protocol,
    host,
    new URL(actualUrlStr).origin
  );
}

function replaceRelativePaths(text, protocol, host, origin) {
  const regex = new RegExp('((href|src|action)=["\'])/(?!/)', 'g');
  return text.replace(regex, `$1${protocol}//${host}/${origin}/`);
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function filterHeaders(headers, filterFunc) {
  return new Headers([...headers].filter(([name]) => filterFunc(name)));
}

function setNoCacheHeaders(headers) {
  headers.set('Cache-Control', 'no-store');
}

function setCorsHeaders(headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  headers.set('Access-Control-Allow-Headers', '*');
}

function getRootHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/materialize.min.css" rel="stylesheet">
  <title>Proxy Everything</title>
  <link rel="icon" type="image/png" href="https://img.icons8.com/color/1000/kawaii-bread-1.png">
  <meta name="Description" content="Proxy Everything with CF Workers.">
  <meta property="og:description" content="Proxy Everything with CF Workers.">
  <meta property="og:image" content="https://img.icons8.com/color/1000/kawaii-bread-1.png">
  <meta name="robots" content="index, follow">
  <meta http-equiv="Content-Language" content="zh-CN">
  <meta name="copyright" content="Copyright © ymyuuu">
  <meta name="author" content="ymyuuu">
  <link rel="apple-touch-icon-precomposed" sizes="120x120" href="https://img.icons8.com/color/1000/kawaii-bread-1.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="viewport" content="width=device-width, user-scalable=no, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no">
  <style>
      body, html {
          height: 100%;
          margin: 0;
      }
      .background {
          background-image: url('https://imgapi.cn/bing.php');
          background-size: cover;
          background-position: center;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
      }
      .card {
          background-color: rgba(255, 255, 255, 0.8);
          transition: background-color 0.3s ease, box-shadow 0.3s ease;
      }
      .card:hover {
          background-color: rgba(255, 255, 255, 1);
          box-shadow: 0px 8px 16px rgba(0, 0, 0, 0.3);
      }
      .input-field input[type=text] {
          color: #2c3e50;
      }
      .input-field input[type=text]:focus+label {
          color: #2c3e50 !important;
      }
      .input-field input[type=text]:focus {
          border-bottom: 1px solid #2c3e50 !important;
          box-shadow: 0 1px 0 0 #2c3e50 !important;
      }
  </style>
</head>
<body>
  <div class="background">
      <div class="container">
          <div class="row">
              <div class="col s12 m8 offset-m2 l6 offset-l3">
                  <div class="card">
                      <div class="card-content">
                          <span class="card-title center-align"><i class="material-icons left">link</i>Proxy Everything</span>
                          <form id="urlForm" onsubmit="redirectToProxy(event)">
                              <div class="input-field">
                                  <input type="text" id="targetUrl" placeholder="在此输入目标地址" required>
                                  <label for="targetUrl">目标地址</label>
                              </div>
                              <button type="submit" class="btn waves-effect waves-light teal darken-2 full-width">跳转</button>
                          </form>
                      </div>
                  </div>
              </div>
          </div>
      </div>
  </div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/js/materialize.min.js"></script>
  <script>
      function redirectToProxy(event) {
          event.preventDefault();
          const targetUrl = document.getElementById('targetUrl').value.trim();
          const currentOrigin = window.location.origin;
          window.open(currentOrigin + '/' + encodeURIComponent(targetUrl), '_blank');
      }
  </script>
</body>
</html>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isPrivateOrLoopbackHost,
    isAllowedHost,
    handleRedirect,
    parseIpv4ToNumber,
    parseIpv6,
    isNonPublicIpv6,
  };
}
