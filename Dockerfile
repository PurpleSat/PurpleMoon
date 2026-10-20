# ==========================================
# 🛡️ 全局构建参数定义区
# ==========================================
ARG PNPM_VERSION=10.12.4

# ---- 第 1 阶段：安装依赖并构建 ----
FROM node:22-alpine AS builder
ARG PNPM_VERSION
# 国内服务器可在构建时指定镜像源：--build-arg NPM_REGISTRY=https://registry.npmmirror.com
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV npm_config_registry=${NPM_REGISTRY}
# 容器内没有 .git，跳过 husky 的 prepare 钩子
ENV HUSKY=0
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# 先只复制依赖清单，源码改动时可复用依赖安装层缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# 再复制全部源码
COPY . .

# 显式设置 DOCKER_ENV，确保 Next.js 在编译时即选择 Node Runtime
RUN find ./src -type f -name "route.ts" -print0 \
  | xargs -0 sed -i "s/export const runtime = 'edge';/export const runtime = 'nodejs';/g"

ENV DOCKER_ENV=true
ENV NEXT_TELEMETRY_DISABLED=1

# 强制动态渲染
RUN sed -i "/^export const viewport: Viewport = {/i export const dynamic = 'force-dynamic';" src/app/layout.tsx

# 生成生产构建
RUN pnpm run build

# ---- 第 2 阶段：生成运行时镜像 ----
FROM node:22-alpine AS runner

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

# 健康检查：/login 是免认证页面（start.js 也用它判断服务是否就绪）
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/login',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

# 使用自定义启动脚本，先预加载配置再启动服务器
CMD ["node", "start.js"]
