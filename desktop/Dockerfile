# 合鸣 ensemble-server 镜像（自用/商用部署）
# 构建 server + web，运行 headless server 并托管前端静态资源

# ── 构建阶段 ──
FROM node:20-slim AS build
WORKDIR /app
RUN corepack enable

# 依赖安装（利用层缓存）
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts

# 源码
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/web packages/web

# 构建
RUN pnpm --filter @ensemble/shared build \
  && pnpm --filter @ensemble/server build \
  && pnpm --filter @ensemble/web build

# 提取 server 运行时（含 workspace 依赖解析，仅生产依赖）
RUN pnpm --filter @ensemble/server deploy --prod /app/deploy

# ── 运行阶段 ──
FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/deploy ./server
COPY --from=build /app/packages/web/dist ./web-dist
EXPOSE 8787
CMD ["node", "server/dist/index.js"]
