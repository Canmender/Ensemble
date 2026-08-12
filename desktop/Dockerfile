# 合鸣 ensemble-server 镜像（自用/商用部署）
# 构建 server + web，运行 headless server 并托管前端静态资源

# ── 构建阶段 ──
FROM node:20-slim AS build
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

# 构建（先清理旧产物，避免层缓存残留不完整 dist）
RUN rm -rf packages/shared/dist packages/server/dist packages/web/dist \
  && pnpm --filter @ensemble/shared build \
  && pnpm --filter @ensemble/server build \
  && pnpm --filter @ensemble/web build

# ── 运行阶段 ──
FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app

# server 源码（tsx 运行时：Node ESM 不解析无扩展名相对导入，tsx 处理）
COPY --from=build /app/packages/server/src ./src
COPY --from=build /app/packages/server/package.json ./package.json

# pnpm workspace 依赖（根 node_modules，含 .pnpm store 与包 link）
COPY --from=build /app/node_modules ./node_modules

# 修复 workspace 链接：@ensemble/shared → 实体（symlink 目标须存在）
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
RUN mkdir -p node_modules/@ensemble \
  && ln -sfn ../../packages/shared node_modules/@ensemble/shared

# 前端静态资源（headless 托管）
COPY --from=build /app/packages/web/dist ./web-dist

# tsx 运行时（处理 ESM 无扩展名导入；走中文镜像）
RUN npm config set registry https://registry.npmmirror.com && npm install -g tsx

EXPOSE 8787
CMD ["tsx", "src/index.ts"]
