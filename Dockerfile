# AI 智能题库助手 - Docker 镜像
# 适用于 Railway / Render / Fly.io / 自建服务器

FROM node:20-alpine AS base

# pnpm 安装
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# 依赖安装层（利用 Docker 缓存）
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

# 生产镜像
FROM base AS production
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 端口通过环境变量 DEPLOY_RUN_PORT 配置
ENV NODE_ENV=production
ENV DEPLOY_RUN_PORT=5000

EXPOSE 5000

# 启动命令
CMD ["node", "server.js"]
