/* eslint-disable */

// ============================================================================
// 本文件原本是一个完全不鉴权、无目标地址限制的通用反向代理
// （"Proxy Everything"），任何人都可以让本 Worker 代表自己向任意公网/内网地址
// 发起请求（开放 SSRF 代理）。现改为默认拒绝（fail-closed），仅允许：
//   1) 携带正确共享密钥（PROXY_SECRET，通过 Worker 环境变量配置）的请求；
//   2) 目标域名命中显式配置的白名单（ALLOWED_PROXY_HOSTS，逗号分隔）；
//   3) 目标不是回环 / 内网 / 链路本地等私有地址。
// 若未配置 PROXY_SECRET 或 ALLOWED_PROXY_HOSTS，则拒绝所有代理请求，
// 仅展示说明页面，避免"配置缺失 = 完全开放"的不安全默认行为。
// ============================================================================

addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request));
});

// 私有/内网/回环/链路本地地址判断，防止通过白名单域名解析到内网地址(DNS Rebinding)
// 或直接以字面 IP 形式访问内网资源
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

function parseIpv4ToNumber(hostname) {
  let h = hostname.toLowerCase().trim();
  if (h.startsWith('[') && h.endsWith(']')) {
    h = h.slice(1, -1);
  }
  if (h.startsWith('::ffff:')) {
    h = h.substring(7);
  }
  if (/^0x[0-9a-f]+$/i.test(h)) {
    const num = parseInt(h, 16);
    if (!isNaN(num) && num >= 0 && num <= 0xffffffff) return num >>> 0;
  }
  if (/^\d+$/.test(h)) {
    const num = parseInt(h, 10);
    if (!isNaN(num) && num >= 0 && num <= 0xffffffff) return num >>> 0;
  }
  const parts = h.split('.');
  if (parts.length >= 1 && parts.length <= 4) {
    const byteVals = [];
    for (const p of parts) {
      let val;
      if (/^0x[0-9a-f]+$/i.test(p)) {
        val = parseInt(p, 16);
      } else if (/^0\d+$/.test(p)) {
        val = parseInt(p, 8);
      } else if (/^\d+$/.test(p)) {
        val = parseInt(p, 10);
      } else {
        return null;
      }
      if (isNaN(val) || val < 0) return null;
      byteVals.push(val);
    }
    if (byteVals.length === 4) {
      if (byteVals.some((b) => b > 255)) return null;
      return (
        (((byteVals[0] << 24) >>> 0) +
          (byteVals[1] << 16) +
          (byteVals[2] << 8) +
          byteVals[3]) >>>
        0
      );
    } else if (byteVals.length === 1) {
      return byteVals[0] >>> 0;
    }
  }
  return null;
}

function isPrivateIpNumber(num) {
  const a = (num >>> 24) & 0xff;
  const b = (num >>> 16) & 0xff;
  if (a === 0) return true;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

// 私有/内网/回环/链路本地地址判断，防止通过白名单域名解析到内网地址(DNS Rebinding)
// 或直接以字面 IP 形式访问内网资源
function isPrivateOrLoopbackHost(hostname) {
  const h = hostname.toLowerCase().trim();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;

  const rebindingSuffixes = [
    'nip.io', 'sslip.io', 'localtest.me', 'lvh.me', 'vcap.me',
    '127-0-0-1.org.uk', 'burpcollaborator.net', 'oastify.com', 'dnslog.cn'
  ];
  if (rebindingSuffixes.some((s) => h === s || h.endsWith('.' + s))) return true;

  const ipv4Num = parseIpv4ToNumber(h);
  if (ipv4Num !== null) {
    return isPrivateIpNumber(ipv4Num);
  }

  let rawH = h;
  if (rawH.startsWith('[') && rawH.endsWith(']')) rawH = rawH.slice(1, -1);
  if (rawH === '::1' || rawH === '::') return true;
  if (rawH.startsWith('fe80:') || rawH.startsWith('fc') || rawH.startsWith('fd')) return true;
  if (rawH.startsWith('::ffff:')) {
    const num = parseIpv4ToNumber(rawH.substring(7));
    if (num !== null && isPrivateIpNumber(num)) return true;
  }

  return false;
}

function isAllowedHost(hostname, allowedHostsCsv) {
  if (!allowedHostsCsv) return false;
  const allowed = allowedHostsCsv
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const h = hostname.toLowerCase();
  return allowed.some((pattern) => h === pattern || h.endsWith(`.${pattern}`));
}

// 读取通过 wrangler.toml [vars] / secret 配置的绑定值。
// 本文件使用的是 Service Worker 语法（而非 ES Module `export default { fetch(req, env) }`），
// 因此环境变量以全局绑定形式注入；未配置时直接引用会抛出 ReferenceError，
// 这里用 typeof 安全地判断绑定是否存在，避免使用 eval。
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

    // 如果访问根目录，返回说明 HTML（不执行任何代理逻辑）
    if (url.pathname === '/') {
      return new Response(getRootHtml(), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    }

    // 🛡️ 第一道防线：共享密钥鉴权。未配置密钥则一律拒绝（fail-closed）。
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

    // 从查询参数中移除 token，避免被转发给目标站点或残留在转发 URL 中
    url.searchParams.delete('token');

    // 从请求路径中提取目标 URL
    let actualUrlStr = decodeURIComponent(url.pathname.replace('/', ''));

    // 判断用户输入的 URL 是否带有协议
    actualUrlStr = ensureProtocol(actualUrlStr, url.protocol);

    // 拼接剩余查询参数（已去除 token）
    const remainingSearch = url.search;
    if (remainingSearch) {
      actualUrlStr += actualUrlStr.includes('?')
        ? remainingSearch.replace('?', '&')
        : remainingSearch;
    }

    const targetUrl = new URL(actualUrlStr);

    // 🛡️ 第二道防线：协议白名单，仅允许 http/https
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      return jsonResponse({ error: 'Only http/https targets are allowed' }, 400);
    }

    // 🛡️ 第三道防线：目标域名必须命中管理员显式配置的白名单
    if (!isAllowedHost(targetUrl.hostname, allowedHostsCsv)) {
      return jsonResponse({ error: 'Target host is not allowed' }, 403);
    }

    // 🛡️ 第四道防线：禁止访问回环 / 内网 / 链路本地地址，防止 SSRF 探测内网
    if (isPrivateOrLoopbackHost(targetUrl.hostname)) {
      return jsonResponse({ error: 'Target host is not allowed' }, 403);
    }

    // 创建新 Headers 对象，排除 'cf-' 开头及本代理专用的鉴权请求头
    const newHeaders = filterHeaders(
      request.headers,
      (name) => !name.startsWith('cf-') && name.toLowerCase() !== 'x-proxy-token'
    );

    // 创建一个新的请求以访问目标 URL
    const modifiedRequest = new Request(actualUrlStr, {
      headers: newHeaders,
      method: request.method,
      body: request.body,
      redirect: 'manual',
    });

    // 发起对目标 URL 的请求
    const response = await fetch(modifiedRequest);
    let body = response.body;

    // 处理重定向
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      body = response.body;
      // 创建新的 Response 对象以修改 Location 头部
      return handleRedirect(response, body);
    } else if (response.headers.get('Content-Type')?.includes('text/html')) {
      body = await handleHtmlContent(
        response,
        url.protocol,
        url.host,
        actualUrlStr
      );
    }

    // 创建修改后的响应对象
    const modifiedResponse = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });

    // 添加禁用缓存的头部
    setNoCacheHeaders(modifiedResponse.headers);

    // 添加 CORS 头部，允许跨域访问
    setCorsHeaders(modifiedResponse.headers);

    return modifiedResponse;
  } catch (error) {
    // 如果请求目标地址时出现错误，返回带有错误消息的响应和状态码 500（服务器错误）
    return jsonResponse(
      {
        error: error.message,
      },
      500
    );
  }
}

// 确保 URL 带有协议
function ensureProtocol(url, defaultProtocol) {
  return url.startsWith('http://') || url.startsWith('https://')
    ? url
    : defaultProtocol + '//' + url;
}

// 处理重定向
function handleRedirect(response, body) {
  const location = new URL(response.headers.get('location'));
  const modifiedLocation = `/${encodeURIComponent(location.toString())}`;
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      ...response.headers,
      Location: modifiedLocation,
    },
  });
}

// 处理 HTML 内容中的相对路径
async function handleHtmlContent(response, protocol, host, actualUrlStr) {
  const originalText = await response.text();
  const regex = new RegExp('((href|src|action)=["\'])/(?!/)', 'g');
  let modifiedText = replaceRelativePaths(
    originalText,
    protocol,
    host,
    new URL(actualUrlStr).origin
  );

  return modifiedText;
}

// 替换 HTML 内容中的相对路径
function replaceRelativePaths(text, protocol, host, origin) {
  const regex = new RegExp('((href|src|action)=["\'])/(?!/)', 'g');
  return text.replace(regex, `$1${protocol}//${host}/${origin}/`);
}

// 返回 JSON 格式的响应
function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

// 过滤请求头
function filterHeaders(headers, filterFunc) {
  return new Headers([...headers].filter(([name]) => filterFunc(name)));
}

// 设置禁用缓存的头部
function setNoCacheHeaders(headers) {
  headers.set('Cache-Control', 'no-store');
}

// 设置 CORS 头部
function setCorsHeaders(headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  headers.set('Access-Control-Allow-Headers', '*');
}

// 返回根目录的 HTML
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
