/** @type {import('next').NextConfig} */

// =========================================================================
// 【安全策略定制】：针对影视聚合网站的专属 CSP
// =========================================================================
const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' https:;
  style-src 'self' 'unsafe-inline';
  img-src * blob: data:;
  media-src * blob: data:;
  connect-src *;
  font-src 'self' data: https:;
  worker-src 'self' blob:;
  frame-src 'self' https:;
`.replace(/\n/g, '').replace(/\s{2,}/g, ' ').trim();

const securityHeaders = [
  // 1. 防御点击劫持 (Clickjacking) - 仅允许同源 iframe 嵌套
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN'
  },
  // 2. 防御 MIME 嗅探攻击 - 强制浏览器遵守 Content-Type
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  },
  // 3. 严格的 Referrer 策略 - 跨域请求时仅发送源地址，保护页面路径隐私
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin'
  },
  // 4. 权限策略 (Permissions-Policy) - 禁用当前应用不需要的敏感 API (摄像头、麦克风、定位)
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()'
  },
  // 5. 强制 HTTPS (HSTS) - 保护连接不被降级 (配置为 1 年)
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload'
  },
  // 6. 开启 DNS 预解析 - 提升第三方源的加载速度
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on'
  },
  // 7. 内容安全策略 (CSP) - 拦截 XSS 的终极防线
  {
    key: 'Content-Security-Policy',
    value: ContentSecurityPolicy
  }
];

const nextConfig = {
  // 补充在现有的 nextConfig 配置中
  async headers() {
    return [
      {
        // 将安全头应用到全站所有路由
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },

  // ... (保留你原有的其他配置，如 reactStrictMode 等)
};

// 如果你使用了 next-pwa，你的导出应该类似于：
const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
});
module.exports = withPWA(nextConfig);

// 如果你是纯 Next.js 没有 PWA，则是：
// module.exports = nextConfig;
