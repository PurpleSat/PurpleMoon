/** @type {import('next').NextConfig} */
/* eslint-disable @typescript-eslint/no-var-requires */

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
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  // 2. 防御 MIME 嗅探攻击 - 强制浏览器遵守 Content-Type
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // 3. 严格的 Referrer 策略 - 跨域请求时仅发送源地址，保护页面路径隐私
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // 4. 权限策略 (Permissions-Policy) - 禁用敏感 API (摄像头、麦克风、定位)
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  // 5. 强制 HTTPS (HSTS) - 保护连接不被降级 (配置为 1 年)
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
  // 6. 开启 DNS 预解析 - 提升第三方源的加载速度
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  // 7. 内容安全策略 (CSP) - 拦截 XSS 的终极防线
  { key: 'Content-Security-Policy', value: ContentSecurityPolicy }
];

const nextConfig = {
  output: 'standalone',
  eslint: {
    dirs: ['src'],
  },

  reactStrictMode: false,
  swcMinify: true,

  // Uncoment to add domain whitelist
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },

  // 【新增】：全局注入 HTTP 安全响应头
  async headers() {
    return [
      {
        // 将安全头应用到全站所有路由
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },

  webpack(config) {
    // Grab the existing rule that handles SVG imports
    const fileLoaderRule = config.module.rules.find((rule) =>
      rule.test?.test?.('.svg')
    );

    config.module.rules.push(
      // Reapply the existing rule, but only for svg imports ending in ?url
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/, // *.svg?url
      },
      // Convert all other *.svg imports to React components
      {
        test: /\.svg$/i,
        issuer: { not: /\.(css|scss|sass)$/ },
        resourceQuery: { not: /url/ }, // exclude if *.svg?url
        loader: '@svgr/webpack',
        options: {
          dimensions: false,
          titleProp: true,
        },
      }
    );

    // Modify the file loader rule to ignore *.svg, since we have it handled now.
    fileLoaderRule.exclude = /\.svg$/i;

    config.resolve.fallback = {
      ...config.resolve.fallback,
      net: false,
      tls: false,
      crypto: false,
    };

    return config;
  },
};

const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
});

module.exports = withPWA(nextConfig);
