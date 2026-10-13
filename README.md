# PurpleMoon

<div align="center">
  <img src="public/logo.png" alt="LibreTV Logo" width="120">
</div>

> 🎬 PurpleMoon 是一个开箱即用的、跨平台的影视聚合播放器。它基于 **Next.js 15** + **Tailwind&nbsp;CSS** + **TypeScript** 构建，支持多资源搜索、在线播放、收藏同步、播放记录、本地/云端存储，让你可以随时随地畅享海量免费影视内容。

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-15-000?logo=nextdotjs)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3-38bdf8?logo=tailwindcss)
![TypeScript](https://img.shields.io/badge/TypeScript-4.x-3178c6?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)
![Docker Ready](https://img.shields.io/badge/Docker-ready-blue?logo=docker)
![HLS](https://img.shields.io/badge/HLS-1.7.3-8A2BE2)
![Artplayer](https://img.shields.io/badge/Artplayer-5.4.0-RED)
![Version](https://img.shields.io/badge/Version-2.5.3-red)
![Github](https://img.shields.io/badge/github-PurpleSat-8A2BE2?logo=github)

</div>

---

## ✨ 功能特性

- 🔍 **多源聚合搜索**：内置数十个免费资源站点，一次搜索立刻返回全源结果。
- 📄 **丰富详情页**：支持剧集列表、演员、年份、简介等完整信息展示。
- ▶️ **流畅在线播放**：集成 HLS.js & ArtPlayer。
- ❤️ **收藏 + 继续观看**：支持 Redis/D1 存储，多端同步进度。
- 📱 **PWA**：离线缓存、安装到桌面/主屏，移动端原生体验。
- 🌗 **响应式布局**：桌面底部导航 + 移动底部导航，自适应各种屏幕尺寸。
- 🚀 **极简部署**：一条 Docker 命令即可将完整服务跑起来，或免费部署到 Vercel 和 Cloudflare。
- 👿 **自定义跳过片头片尾**：多设备同步自定义跳过片头片尾功能。
- 🔒 **鉴权交互**：企业级。
- 💬 **留言板**：全用户留言板块。
- 🌐 **源库分类浏览**：一览源站分类内容。
- 🎬 **视频解析**：一键解析视频。
- 🔔 **TMDB最近上映**：TMDB最新上映和热播。

<details>
  <summary>点击查看项目截图</summary>
  <img src="public/screenshot.png" alt="项目截图" style="max-width:600px">
</details>

## 🗺 目录

- [技术栈](#技术栈)
- [部署](#部署)
- [Docker Compose 最佳实践](#Docker-Compose-最佳实践)
- [环境变量](#环境变量)
- [不同部署环境的变量配置](#不同部署环境的变量配置)
- [配置说明](#配置说明)
- [管理员配置](#管理员配置)
- [AndroidTV 使用](#AndroidTV-使用)
- [Roadmap](#roadmap)
- [V2.5.3版本更新内容](#V2.5.3安全与稳定修复)
- [License](#license)
- [致谢](#致谢)

## 技术栈

| 分类      | 主要依赖                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------- |
| 前端框架  | [Next.js 15](https://nextjs.org/) · App Router                                                        |
| UI & 样式 | [Tailwind&nbsp;CSS 3](https://tailwindcss.com/)                                                       |
| 语言      | TypeScript 4                                                                                          |
| 播放器    | [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) · [HLS.js](https://github.com/video-dev/hls.js/) |
| 代码质量  | ESLint · Prettier · Jest                                                                              |
| 部署      | Docker · Vercel · CloudFlare pages                                                                    |

## 部署

本项目**支持 Vercel、Docker 和 Cloudflare** 部署。

存储支持矩阵

|               | Docker | Vercel | Cloudflare |
| :-----------: | :----: | :----: | :--------: |
| localstorage  |   ✅   |   ✅   |     ✅     |
|  原生 redis   |   ✅   |        |            |
| Cloudflare D1 |        |        |     ✅     |
| Upstash Redis |   ✅   |   ✅   |     ✅     |

✅：经测试支持

除 localstorage 方式外，其他方式都支持多账户、记录同步和管理页面

### Vercel 部署

#### 普通部署（localstorage）

1. **Fork** 本仓库到你的 GitHub 账户。
2. 登陆 [Vercel](https://vercel.com/)，点击 **Add New → Project**，选择 Fork 后的仓库。
3. （强烈建议）设置 PASSWORD 环境变量。
4. 保持默认设置完成首次部署。
5. 如需自定义 `config.json`，请直接修改 Fork 后仓库中该文件。
6. 每次 Push 到 `main` 分支将自动触发重新构建。

部署完成后即可通过分配的域名访问，也可以绑定自定义域名。

#### Upstash Redis 支持

0. 完成普通部署并成功访问。
1. 在 [upstash](https://upstash.com/) 注册账号并新建一个 Redis 实例，名称任意。
2. 复制新数据库的 **HTTPS ENDPOINT 和 TOKEN**
3. 返回你的 Vercel 项目，新增环境变量 **UPSTASH_URL 和 UPSTASH_TOKEN**，值为第二步复制的 endpoint 和 token
4. 设置环境变量 NEXT_PUBLIC_STORAGE_TYPE，值为 **upstash**；设置 USERNAME 和 PASSWORD 作为站长账号
5. 重试部署

### Cloudflare 部署

**Cloudflare Pages 的环境变量尽量设置为密钥而非文本**

#### 普通部署（localstorage）

1. **Fork** 本仓库到你的 GitHub 账户。
2. 登陆 [Cloudflare](https://cloudflare.com)，点击 **计算（Workers）-> Workers 和 Pages**，点击创建
3. 选择 Pages，导入现有的 Git 存储库，选择 Fork 后的仓库
4. 构建命令填写 **pnpm install --frozen-lockfile && pnpm run pages:build**，预设框架为无，构建输出目录为 `.vercel/output/static`
5. 保持默认设置完成首次部署。进入设置，将兼容性标志设置为 `nodejs_compat`
6. （强烈建议）首次部署完成后进入设置，新增 PASSWORD 密钥（变量和机密下），而后重试部署。
7. 如需自定义 `config.json`，请直接修改 Fork 后仓库中该文件。
8. 每次 Push 到 `main` 分支将自动触发重新构建。

#### D1 支持

0. 完成普通部署并成功访问
1. 点击 **存储和数据库 -> D1 SQL 数据库**，创建一个新的数据库，名称随意
2. 进入刚创建的数据库，点击左上角的 Explore Data，将[D1 初始化1](D1初始化1.md) [D1 初始化2](D1初始化2.md)中的内容粘贴到 Query 窗口后点击 **Run All**，等待运行完成
3. 返回你的 pages 项目，进入 **设置 -> 绑定**，添加绑定 D1 数据库，选择你刚创建的数据库，变量名称填 **DB**
4. 设置环境变量 NEXT_PUBLIC_STORAGE_TYPE，值为 **d1**；设置 USERNAME 和 PASSWORD 作为站长账号
5. 重试部署

### Docker 部署

#### 1. 直接运行（最简单）

```bash
# 拉取预构建镜像
docker pull ghcr.io/purplesat/purplemoon:latest

# 运行容器
# -d: 后台运行  -p: 映射端口 3000 -> 3000
# AUTH_SECRET 为必填项（至少 16 字符，建议 32 字符以上），缺失时服务将拒绝启动
docker run -d --name purplemoon -p 3000:3000 \
  -e PASSWORD=your_password \
  -e AUTH_SECRET=$(openssl rand -hex 32) \
  ghcr.io/purplesat/purplemoon:latest
```

访问 `http://服务器 IP:3000` 即可。（需自行到服务器控制台放通 `3000` 端口）

## Docker Compose 最佳实践

若你使用 docker compose 部署，以下是一些 compose 示例

### local storage 版本

```yaml
services:
  purplemoon:
    image: ghcr.io/purplesat/purplemoon:latest
    container_name: purplemoon
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      - PASSWORD=your_password
      - AUTH_SECRET=CHANGE_ME   # 必填：必须替换为至少 32 位随机字符串（openssl rand -hex 32），保持 CHANGE_ME 将无法启动
    # 如需自定义配置，可挂载文件
    # volumes:
    #   - ./config.json:/app/config.json:ro
```

### Redis 版本（推荐，多账户数据隔离，跨设备同步）

```yaml
services:
  purplemoon-core:
    image: ghcr.io/purplesat/purplemoon:latest
    container_name: purplemoon
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - AUTH_SECRET=CHANGE_ME   # 必填：必须替换为至少 32 位随机字符串（openssl rand -hex 32），保持 CHANGE_ME 将无法启动
      - NEXT_PUBLIC_STORAGE_TYPE=redis
      - REDIS_URL=redis://purplemoon-redis:6379
      - NEXT_PUBLIC_ENABLE_REGISTER=true
    networks:
      - purplemoon-network
    depends_on:
      - purplemoon-redis
    # 如需自定义配置，可挂载文件
    # volumes:
    #   - ./config.json:/app/config.json:ro
  purplemoon-redis:
    image: redis
    container_name: purplemoon-redis
    restart: unless-stopped
    networks:
      - purplemoon-network
    # 如需持久化
    # volumes:
    #   - ./data:/data
networks:
  purplemoon-network:
    driver: bridge
```

## 自动同步最近更改

建议在 fork 的仓库中启用本仓库自带的 GitHub Actions 自动同步功能（见 `.github/workflows/sync.yml`）。

如需手动同步主仓库更新，也可以使用 GitHub 官方的 [Sync fork](https://docs.github.com/cn/github/collaborating-with-issues-and-pull-requests/syncing-a-fork) 功能。

## 环境变量

| 变量                        | 说明                                                        | 可选值                           | 默认值                                                                                                                     |
| --------------------------- | ----------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| USERNAME                    | redis 部署时的管理员账号                                    | 任意字符串                       | 空                                                                                                                   |
| PASSWORD                    | 默认部署时为唯一访问密码，redis 部署时为管理员密码              | 任意字符串                       | 空                                                                                                                   |
| SITE_NAME                   | 站点名称                                                   | 任意字符串                       | purplemoon                                                                                                                     |
| ANNOUNCEMENT                | 站点公告                                                 | 任意字符串                       | 本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。 |
| NEXT_PUBLIC_STORAGE_TYPE    | 播放记录/收藏的存储方式                                     | localstorage、redis、d1、upstash | localstorage                                                                                                               |
| REDIS_URL                   | redis 连接 url，若 NEXT_PUBLIC_STORAGE_TYPE 为 redis 则必填 | 连接 url                         | 空                                                                                                                         |
| UPSTASH_URL                 | upstash redis 连接 url                                      | 连接 url                         | 空                                                                                                                         |
| UPSTASH_TOKEN               | upstash redis 连接 token                                    | 连接 token                       | 空                                                                                                                         |
| NEXT_PUBLIC_ENABLE_REGISTER | 是否开放注册，仅在非 localstorage 部署时生效                | true / false                     | false                                                                                                                      |
| NEXT_PUBLIC_SEARCH_MAX_PAGE | 搜索接口可拉取的最大页数                                    | 1-50                             | 5                                                                                                                          |
| NEXT_PUBLIC_IMAGE_PROXY     | 默认的浏览器端图片代理                                      | https://timis.dpdns.org/?url=     | 空                                                                                                                     |
| TMDB_API_TOKEN              | 上映日程TMDBTOKEN                                     | API 读访问令牌                          | 空                                                                                                                         |
| VALID_INVITE_CODE | 注册邀请码（开启邀请制时必填，否则注册接口返回配置异常） | 任意字符串，建议 16 位以上 | 空 |
| REQUIRE_INVITE_CODE | 是否强制邀请码注册。未设置时跟随 `NEXT_PUBLIC_ENABLE_REGISTER`（开放注册即强制邀请码） | true / false | 空 |
| TMDB_API_KEY | TMDB v3 API Key（与 `TMDB_API_TOKEN` 二选一，用于“最近上映”） | API Key | 空 |
| TMDB_BASE_URL | TMDB API 地址（自建反代时修改） | URL | https://api.themoviedb.org/3 |
| AUTH_SECRET                 | **必填**。用于签名登录 Cookie；缺失或少于 16 字符时，生产环境服务拒绝启动 | 建议 32 位以上随机字符串（`openssl rand -hex 32`） | 空 |
| CRON_SECRET | `/api/cron` 的 Bearer 密钥。**未设置时 cron 接口一律返回 401**（不会刷新收藏/播放记录的集数）。Docker 内置定时器和 Vercel Cron 都会自动带上它 | 任意 32 位以上字符串 | 空 |
| TRUST_CF_CONNECTING_IP | 设为 true 才会信任 `CF-Connecting-IP` 头做限流 IP 识别。仅当站点部署在 Cloudflare （且源站只接受 Cloudflare 回源）时开启，否则客户端可伪造该头绕过限流 | true | 空 |
| TRUST_X_REAL_IP | 设为 true 才会信任 `X-Real-IP` 头。仅当前置反向代理（如 Nginx 的 `proxy_set_header X-Real-IP $remote_addr;`）会覆盖该头时开启 | true | 空 |
| TRUST_X_FORWARDED_FOR | 设为 true 才会信任 `X-Forwarded-For` 头，并取**倒数第 N 个**地址（N 见 TRUSTED_PROXY_HOPS），不再取最左侧值。仅当前置代理会追加真实来源地址时开启 | true | 空 |
| COOKIE_SECURE | 显式控制登录 Cookie 是否带 `Secure`。默认：生产环境下仅当请求实际经由 HTTPS（`X-Forwarded-Proto: https`）时才加。通过 `http://IP:3000` 直连时请保持默认或设为 false，否则浏览器会丢弃 Cookie 导致“登录后立即回到登录页” | true / false | 空（自动） |
| *限流 IP 兜底* | 未设置任何 `TRUST_*` 时，生产环境若请求带有 `X-Forwarded-For`，将取其**最右侧**一项（最近一层代理看到的来源）做限流。**请务必把服务放在反向代理之后**；若直接暴露公网，客户端可伪造该头规避限流，而且没有该头时所有请求会共用同一个限流桶 | - | - |
| TRUSTED_PROXY_HOPS | `X-Forwarded-For` 链上可信代理层数，取倒数第 N 个。如 Cloudflare → Nginx → 应用 填 2 | 1-5 | 1 |

## 不同部署环境的变量配置

上面的表格是“所有变量的含义”，这一节说明**在 Docker、Vercel、Cloudflare Pages 上分别要配哪些**。

图例：✅ 必填 · 🔶 按条件必填/强烈建议 · ⭕ 可选 · ➖ 不需要（或不可用）

### 变量速查表

| 变量 | Docker | Vercel | Cloudflare Pages | 备注 |
| ---- | :----: | :----: | :--------------: | ---- |
| `AUTH_SECRET` | ✅ | ✅ | ✅（密钥） | 三个平台都必填。缺失时 Docker 启动即报错，Vercel / Cloudflare 上所有登录请求会失败 |
| `PASSWORD` | ✅ | ✅ | ✅（密钥） | localstorage 模式 = 全站唯一访问密码；数据库模式 = 站长密码。**不设置则整站免登录** |
| `USERNAME` | 🔶 | 🔶 | 🔶 | 仅数据库模式（redis / d1 / upstash）需要，作为站长账号；localstorage 模式不用 |
| `NEXT_PUBLIC_STORAGE_TYPE` | 🔶 | 🔶 | 🔶 | 不设 = localstorage。Docker：`redis` 或 `upstash`；Vercel：`upstash`；Cloudflare：`d1` 或 `upstash` |
| `REDIS_URL` | 🔶（redis） | ➖ | ➖ | 原生 Redis 走 TCP，Vercel / Cloudflare 的 Edge 运行时不支持 |
| `UPSTASH_URL` `UPSTASH_TOKEN` | 🔶（upstash） | 🔶（upstash） | 🔶（upstash） | 走 HTTPS，三个平台都能用 |
| D1 数据库**绑定** `DB` | ➖ | ➖ | 🔶（d1） | 不是环境变量：在 **设置 → 绑定** 里添加 D1，变量名必须是 `DB` |
| `NEXT_PUBLIC_ENABLE_REGISTER` | ⭕ | ⭕ | ⭕ | 仅数据库模式生效 |
| `VALID_INVITE_CODE` | 🔶 | 🔶 | 🔶 | 开放注册时必填（默认开放注册 = 强制邀请码） |
| `REQUIRE_INVITE_CODE` | ⭕ | ⭕ | ⭕ | 想“开放注册但不要邀请码”才需要设为 `false` |
| `CRON_SECRET` | 🔶 | 🔶 | 🔶 | 见下方“定时任务” |
| `SITE_NAME` `ANNOUNCEMENT` | ⭕ | ⭕ | ⭕ | 见下方“站点设置的优先级” |
| `NEXT_PUBLIC_SEARCH_MAX_PAGE` `NEXT_PUBLIC_IMAGE_PROXY` | ⭕ | ⭕ | ⭕ | `NEXT_PUBLIC_*` 在构建时写入，**修改后 Vercel / Cloudflare 需重新部署** |
| `TMDB_API_TOKEN` 或 `TMDB_API_KEY` | ⭕ | ⭕ | ⭕ | 不设则“最近上映”页面报错 |
| `TRUST_CF_CONNECTING_IP` | 🔶（经 Cloudflare 时） | ➖ | ✅ 设为 `true` | 用于登录/注册/搜索限流识别真实 IP |
| `TRUST_X_FORWARDED_FOR` `TRUSTED_PROXY_HOPS` | 🔶（经反向代理时） | ➖ | ➖ | Vercel 平台已自行覆盖 `X-Forwarded-For`，无需设置 |
| `TRUST_X_REAL_IP` | ⭕ | ➖ | ➖ | 仅当 Nginx 用 `$remote_addr` 覆盖了 `X-Real-IP` |
| `COOKIE_SECURE` | ⭕ | ➖ | ➖ | 仅 Docker 用 http 直连测试时才需要，见下 |
| `DOCKER_ENV` `HOSTNAME` `PORT` | 镜像已内置，**不要改** | ➖ **不要设置** | ➖ **不要设置** | 在 Vercel / Cloudflare 设置 `DOCKER_ENV=true` 会导致配置加载异常 |

### Docker

环境变量在**运行时**读取，改完 `docker compose up -d` 重建容器即可，不需要重新构建镜像。`config.json` 也是运行时读取（可挂载）。

最小 localstorage：

```yaml
environment:
  - PASSWORD=强密码
  - AUTH_SECRET=openssl rand -hex 32 的输出
```

推荐 Redis 版（放在 Nginx / Caddy 之后，对外 HTTPS）：

```yaml
environment:
  - USERNAME=站长账号
  - PASSWORD=站长密码
  - AUTH_SECRET=openssl rand -hex 32 的输出
  - CRON_SECRET=openssl rand -hex 32 的输出   # 容器内置定时器会自动带上，每小时刷新一次
  - NEXT_PUBLIC_STORAGE_TYPE=redis
  - REDIS_URL=redis://purplemoon-redis:6379
  - NEXT_PUBLIC_ENABLE_REGISTER=true
  - VALID_INVITE_CODE=你的邀请码
  - TRUST_X_FORWARDED_FOR=true               # 前置的是会追加 X-Forwarded-For 的反向代理
  - TRUSTED_PROXY_HOPS=1                     # 反向代理层数；Cloudflare → Nginx → 应用 填 2
```

- **HTTPS / Cookie**：Cookie 只有在请求经 HTTPS（`X-Forwarded-Proto: https`）时才带 `Secure`。反向代理必须传 `Host` 和 `X-Forwarded-Proto`，否则写操作会因 CSRF 校验失败返回 403。
- **用 `http://IP:3000` 直连测试**：保持默认即可正常登录；不要把 `COOKIE_SECURE` 设成 `true`。
- **前面是 Cloudflare 再接 Nginx**：用 `TRUST_CF_CONNECTING_IP=true`（并让源站只接受 Cloudflare 回源），或者 `TRUST_X_FORWARDED_FOR=true` + `TRUSTED_PROXY_HOPS=2`。
- **源站必须只接受代理流量**（防火墙不要放行 3000 端口给公网），否则客户端可绕过代理伪造请求头规避限流。
- **多个容器副本**：登录 / 注册 / 便签限流走共享的 Redis；`/api/search` 的限流仍是每个实例自己的内存，需要时在代理层再加一层限流。

### Vercel

在 **Project → Settings → Environment Variables** 添加，Environment 勾选 Production。**改完变量必须重新部署**（`NEXT_PUBLIC_*` 是构建时写入的）。

最小配置（Upstash）：

```
AUTH_SECRET=openssl rand -hex 32 的输出
USERNAME=站长账号
PASSWORD=站长密码
NEXT_PUBLIC_STORAGE_TYPE=upstash
UPSTASH_URL=https://xxx.upstash.io
UPSTASH_TOKEN=xxx
CRON_SECRET=openssl rand -hex 32 的输出
VALID_INVITE_CODE=你的邀请码        # 开放注册时
NEXT_PUBLIC_ENABLE_REGISTER=true    # 开放注册时
```

- **不能用 `REDIS_URL`**：Vercel 不支持原生 Redis，用 Upstash。
- **定时任务**：仓库自带 `vercel.json`，每天 01:00 UTC 调用 `/api/cron`。设置了 `CRON_SECRET` 后，Vercel 会自动带上 `Authorization: Bearer <CRON_SECRET>`，**不设置则 cron 一律 401**。
- **真实 IP**：Vercel 会覆盖 `X-Forwarded-For`，不需要设置任何 `TRUST_*`，默认即可正确限流。
- **不要设置** `DOCKER_ENV`、`COOKIE_SECURE`。
- **改 `config.json`**（资源站列表）需提交到仓库触发重新构建。

### Cloudflare Pages

在 **设置 → 变量和机密** 添加。敏感值用**密钥（Secret）**：`AUTH_SECRET`、`PASSWORD`、`CRON_SECRET`、`UPSTASH_TOKEN`、`TMDB_API_TOKEN`、`VALID_INVITE_CODE`；`NEXT_PUBLIC_*`、`USERNAME`、`TRUST_*` 等非敏感值用文本变量。同样**改完需重新部署**，且兼容性标志要设为 `nodejs_compat`。

D1 版：

```
AUTH_SECRET=openssl rand -hex 32 的输出        （密钥）
USERNAME=站长账号
PASSWORD=站长密码                              （密钥）
NEXT_PUBLIC_STORAGE_TYPE=d1
TRUST_CF_CONNECTING_IP=true
CRON_SECRET=openssl rand -hex 32 的输出        （密钥）
VALID_INVITE_CODE=你的邀请码                   （密钥，开放注册时）
NEXT_PUBLIC_ENABLE_REGISTER=true               （开放注册时）
```

另外在 **设置 → 绑定** 添加 D1 数据库，变量名填 `DB`（不是环境变量）。Upstash 版把 `NEXT_PUBLIC_STORAGE_TYPE` 换成 `upstash` 并加 `UPSTASH_URL`、`UPSTASH_TOKEN`，不需要 D1 绑定。

- **真实 IP**：必须设 `TRUST_CF_CONNECTING_IP=true`，否则取不到真实客户端 IP。
- **定时任务**：Pages 本身没有 Cron，仓库里的 `vercel.json` 在 Cloudflare 上无效。需要刷新收藏/播放记录集数时，用 Cloudflare Worker 的 Cron Trigger 或任意外部定时服务，定时 `GET https://你的域名/api/cron`，请求头带 `Authorization: Bearer <CRON_SECRET>`；不需要这个功能可以不设。
- **不能用 `REDIS_URL`**：Cloudflare 不支持原生 Redis。

### 站点设置的优先级

| 部署方式 | `SITE_NAME` / `ANNOUNCEMENT` / `NEXT_PUBLIC_ENABLE_REGISTER` / `NEXT_PUBLIC_IMAGE_PROXY` |
| -------- | ---- |
| Docker + 数据库 | 仅在**首次初始化**时作为默认值写入数据库，之后以后台 `/admin` 的修改为准 |
| Vercel / Cloudflare + 数据库 | **每次请求都以环境变量为准**，后台修改这几项（如注册开关）不会持久生效，要改请改环境变量并重新部署 |
| localstorage | 始终以环境变量为准，没有后台 |

## 配置说明

所有可自定义项集中在根目录的 `config.json` 中：

```json
{
  "cache_time": 7200,
  "api_site": {
    "dyttzy": {
      "api": "http://caiji.dyttzyapi.com/api.php/provide/vod",
      "name": "电影天堂资源",
      "detail": "http://caiji.dyttzyapi.com"
    }
    // ...更多站点
  }
}
```

- `cache_time`：接口缓存时间（秒）。
- `api_site`：你可以增删或替换任何资源站，字段说明：
  - `key`：唯一标识，保持小写字母/数字。
  - `api`：资源站提供的 `vod` JSON API 根地址。
  - `name`：在人机界面中展示的名称。
  - `detail`：（可选）部分无法通过 API 获取剧集详情的站点，需要提供网页详情根 URL，用于爬取。

PurpleMoon 支持标准的苹果 CMS V10 API 格式。

修改后 **无需重新构建**，服务会在启动时读取一次。

## 管理员配置

**该特性目前仅支持通过非 localstorage 存储的部署方式使用**

支持在运行时动态变更服务配置

设置环境变量 USERNAME 和 PASSWORD 即为站长用户，站长可设置用户为管理员

站长或管理员访问 `/admin` 即可进行管理员配置

## AndroidTV 使用

目前该项目可以配合 [OrionTV](https://github.com/zimplexing/OrionTV) 在 Android TV 上使用，可以直接作为 OrionTV 后端

暂时收藏夹与播放记录和网页端隔离，后续会支持同步用户数据

## Roadmap

- [x] 深色模式
- [x] 持久化存储
- [x] 多账户


### V2.5.3 安全与稳定性修复

- 1.修复 source-browser 四个接口绕过 SSRF 防护（直连静态 config.json、无重定向校验），改为只读后台已启用资源源并统一走 safeFetch
- 2.修复搜索/详情上游请求会自动跟随 3xx 重定向导致的 SSRF 绕过（全部改用 safeFetch 逐跳校验）
- 3.修复登录/注册/登出无条件下发 Secure Cookie，导致 http 直连时“登录后立即被踢回登录页”（统一使用 cookies.ts）
- 4.修复未配置 TRUST_* 时所有用户共用同一限流桶，任意人 1 分钟 10 次请求即可让全站无法登录
- 5.修复 Docker 模式配置缓存常驻内存：新注册用户不出现在后台、封禁/删除不即时生效、多实例不一致（5 秒 TTL + 版本冲突时强制刷新）
- 6.已被管理员删除的用户，其 Cookie 不再继续可用
- 7.登录接口先校验密码再提示“用户被封禁”，避免用户名枚举
- 8.cron 接口改为 await 执行并使用恒定时间比较密钥
- 9.播放记录 / 收藏 / 跳过片头片尾写入增加字段白名单与长度上限，防止存储被灌满
- 10.source-browser 错误信息不再向客户端泄露内部细节
- 11.搜索提速：资源站由“6 个一批串行等待”改为 8 路并发池 + 8 秒整体截止时间，慢源/坏源不再拖累整体，并发数写死在 src/lib/search-engine.ts 里的 SEARCH_CONCURRENCY；可根据实际部署情况修改；
- 部署平台	        建议并发数	 翻页上限	    原因
- Docker / 自建服务器	16 到 20	保持 3 页	总耗时接近全并发，首屏仍是流式；出站压力可控
- Vercel	8 到 16	保持 3 页	按套餐和上游承受能力调整，先用默认值观察
- Cloudflare Pages 免费版	8	降到 1 页	避免单次搜索子请求超过免费版上限
- Cloudflare Pages 付费版	16 到 20	保持 3 页	子请求上限更高；仍建议保留整体时限
- 多实例部署	按单实例配置	同上	缓存、熔断、搜索限流都是每个实例自己的内存，需要时在代理层再加限流
- 12.新增流式搜索接口 `/api/search/stream`（NDJSON），搜索页改为“搜到一个源就立刻显示一个源”，首批结果通常 1 秒内出现；流式不可用时自动退回 `/api/search`
- 13.同一关键词 5 分钟内重复搜索几乎瞬时返回；超时/报错的资源站 45 秒内自动跳过（缓存和熔断都是每个实例各自的内存）
- 14.若前置 Nginx，流式接口已带 `X-Accel-Buffering: no`；其他代理需关闭对该路径的响应缓冲，否则只是变回“全部返回后一次性显示”


### V2.5.1版本更新内容

- 1.增加视频解析
- 2.增加MEMO功能
- 3.增加TMDB热门和最近上映的数据调用
- 4.增加源浏览功能
- 5.增加邀请注册制
- 6.增加环境变量隔离
- 7.增加为 Cron 任务加上密钥校验
- 8.增加自定义自动跳过片头片尾功能并支持同步D1和UPSTASH、REDIS
- 9.修复单点内存限流在分布式多节点部署中的问题实现分布式限流
- 10.优化广告切片过滤
- 11.增加用户密码盐哈希
- 12.修补密码明文时序攻击 (Timing Attack)
- 13.增加COOKIS时间戳
- 14.去除失效依赖更并更新至最新和锁定部份依赖版本
- 15.其它BUG修复及功能体验优化。
- 16.CSRF 校验统一到全部写接口
- 17.移除0引用依赖和部份依赖的版本对齐。
## License

[MIT](LICENSE) © 2025 MoonTV & Contributors

## 致谢

- [ts-nextjs-tailwind-starter](https://github.com/theodorusclarence/ts-nextjs-tailwind-starter) — 项目最初基于该脚手架。
- [LibreTV](https://github.com/LibreSpark/LibreTV) — 由此启发，站在巨人的肩膀上。
- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) — 提供强大的网页视频播放器。
- [HLS.js](https://github.com/video-dev/hls.js) — 实现 HLS 流媒体在浏览器中的播放支持。
- 感谢所有提供免费影视接口的站点。
