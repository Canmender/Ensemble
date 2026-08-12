# 合鸣 ensemble-server 镜像（自用/商用部署）
# esbuild 打包 server 为单文件（解决 Node ESM 无扩展名导入问题），运行时零依赖解析

# ── 构建阶段 ──
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable

# 依赖安装（利用层缓存）
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts

# 源码
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/web packages/web

# 构建：shared → web；server 用 esbuild 打包单文件（platform=node 自动 external node: 内置）
RUN pnpm --filter @ensemble/shared build \
  && pnpm --filter @ensemble/web build \
  && cd packages/server \
  && npx esbuild src/index.ts --bundle --platform=node --format=cjs --outfile=dist/headless.cjs

# ── 运行阶段 ──
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app

# server 单文件（无需 node_modules）+ 前端静态资源
COPY --from=build /app/packages/server/dist/headless.cjs ./server.cjs
COPY --from=build /app/packages/web/dist ./web-dist

EXPOSE 8787
CMD ["node", "server.cjs"]
