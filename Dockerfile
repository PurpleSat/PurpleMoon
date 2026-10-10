# ==========================================
# 🛡️ 全局构建参数定义区
# ==========================================
ARG PNPM_VERSION=10.12.4

# ---- 第 1 阶段：拉取依赖缓存 (Fetch 阶段) ----
FROM node:20-alpine AS deps
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# 【核心改变 1】：仅复制 lockfile
# pnpm fetch 是专为 Docker 设计的命令，它不需要任何 package.json。
# 它只读取 lockfile，并将所有包的压缩文件下载到全局虚拟存储 (Virtual Store) 中。
# 这样不仅解决了 Workspace 找不到子包的问题，还最大化了 Docker 缓存！
COPY pnpm-lock.yaml ./
RUN pnpm fetch

# ---- 第 2 阶段：构建项目 ----
FROM node:20-alpine AS builder
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# 复制全部源代码（此时包含了根目录、pnpm-workspace.yaml 以及所有子包的 package.json）
COPY . .

# 【核心改变 2】：使用离线模式安装依赖
# 因为前面 deps 阶段已经把包全 fetch 到本地了，这里加 --offline 会直接从本地硬链接，
# 瞬间完成 Workspace 内部的链接与依赖安装，不会产生任何网络请求！
RUN pnpm install -r --offline --frozen-lockfile

# 显式设置 DOCKER_ENV，确保 Next.js 在编译时即选择 Node Runtime
RUN find ./src -type f -name "route.ts" -print0 \
  | xargs -0 sed -i "s/export const runtime = 'edge';/export const runtime = 'nodejs';/g"

ENV DOCKER_ENV=true
ENV NEXT_TELEMETRY_DISABLED=1

# 强制动态渲染
RUN sed -i "/const inter = Inter({ subsets: \['latin'] });/a export const dynamic = 'force-dynamic';" src/app/layout.tsx

# 生成生产构建
RUN pnpm run build

# ---- 第 3 阶段：生成运行时镜像 ----
FROM node:20-alpine AS runner

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DOCKER_ENV=true
ENV NEXT_TELEMETRY_DISABLED=1

# 从构建器中复制 standalone 输出
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# 从构建器中复制 scripts 目录
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
# 从构建器中复制 start.js
COPY --from=builder --chown=nextjs:nodejs /app/start.js ./start.js
# 从构建器中复制 public 和 .next/static 目录
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/config.json ./config.json

# 切换到非特权用户
USER nextjs

EXPOSE 3000

# 使用自定义启动脚本，先预加载配置再启动服务器
CMD ["node", "start.js"]
