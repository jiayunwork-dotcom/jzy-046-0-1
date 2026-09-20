# 前端构建与后端运行时均锁定 Node.js 20
FROM node:20-slim

WORKDIR /app

# 先装依赖（利用 Docker 层缓存）
COPY package.json package-lock.json* ./
RUN npm install

# 拷贝源码并构建前端静态产物
COPY . .
RUN npm run build

# 构建完成后移除开发依赖，保持运行镜像精简
RUN npm prune --production

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Express 同时托管 API 与 web/dist，容器拉起后浏览器直接访问
CMD ["node", "server/index.js"]
