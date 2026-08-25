# AI 智能题库助手 - Docker 镜像
# 适用于 Railway / Render / Fly.io / 自建服务器

FROM node:20-alpine

WORKDIR /app

# 依赖安装
COPY package.json ./
RUN npm install

# 复制代码
COPY . .

# 端口通过环境变量配置（Railway 用 PORT，沙箱用 DEPLOY_RUN_PORT）
ENV NODE_ENV=production

EXPOSE 5000

# 启动命令
CMD ["node", "server.js"]
