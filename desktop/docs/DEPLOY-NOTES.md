# 合鸣 Docker 部署踩坑记录与反思

> 2026-08-12 自用系统部署到阿里云（Ubuntu/Docker，node:22）实战记录。
> 每次部署失败背后都对应一个真实的工程陷阱，逐一记录并给出反思。

## 背景

部署目标：把 ensemble-server（含账号系统/agent/会话）+ relay-server 通过 docker compose 部署到阿里云（<SERVER_IP>，Docker 26 + Compose 2.27，内存 1.8G）。

## 踩坑清单

### 1. relay-server `.dockerignore` 误排除 `src`

- **现象**：relay 构建报 `TS18003: No inputs were found in tsconfig.json`，`src/**` 目录为空。
- **根因**：`relay-server/.dockerignore` 里写了 `src`——把构建所需源码排除了。
- **反思**：`.dockerignore` 的本意是排除不需要进镜像的（node_modules/.git），但**构建依赖的源码绝不能排**。加 dockerignore 规则前要问"这行是否会导致构建输入缺失"。

### 2. Dockerfile 未 COPY 根 `tsconfig.base.json`

- **现象**：shared 构建报 zod 类型错误（`Cannot find name 'Set'/'Symbol'`）。
- **根因**：各包 tsconfig `extends ../../tsconfig.base.json`，但 Dockerfile 只 COPY 了各 package.json，根 `tsconfig.base.json` 没进构建上下文 → tsc 用默认 lib（ES5）→ zod 的 ES2015+ 类型全报错。
- **反思**：pnpm workspace 的**共享编译配置是构建输入**。Dockerfile 列 COPY 清单时，除了 package.json 还要把 `tsconfig*.json`、`pnpm-workspace.yaml` 等一起 COPY。

### 3. `pnpm deploy` 提取的 dist 不完整

- **现象**：server 镜像 `/app/dist` 只有部分文件（appContext/config），运行时缺模块。
- **根因**：`pnpm --filter @ensemble/server deploy --prod` 提取产物时 dist 不完整（仅部分编译产物）。
- **反思**：**`pnpm deploy` 是包发布语义，不适合"复制构建产物"**。构建产物直接用 `COPY --from=build` 拷贝，别依赖 deploy 的隐式行为。最终方案用 **esbuild 打包单文件**，彻底绕开。

### 4. pnpm v10 `deploy` 需 `--legacy`

- **现象**：`ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE`。
- **根因**：pnpm v10 默认要求 workspace `inject-workspace-packages=true` 才能 deploy。
- **反思**：pnpm 版本行为差异大，遇到怪错先查版本迁移说明。（此坑随方案 3 一并废弃。）

### 5. Node ESM 无扩展名相对导入（最隐蔽的坑）

- **现象**：容器运行报 `ERR_MODULE_NOT_FOUND: Cannot find module '/app/dist/config/env'`，但文件明明存在。
- **根因**：server 是 `"type": "module"`（ESM），tsc 编译输出 `import ... from "./config/env"`（**无 `.js` 扩展名**）。Node 原生 ESM 解析相对导入**不自动补扩展名**。本地开发用 tsx/Electron esbuild 运行所以从未暴露，`node dist/index.js` 直接跑就炸。
- **反思**：
  - **ESM 相对导入必须带扩展名**（`./config/env.js`），或运行时用 bundler/tsx 处理。
  - **本地能跑 ≠ 部署能跑**：本地用了 tsx/esbuild，掩盖了 ESM 扩展名问题。部署前要"模拟部署运行方式"验证（纯 node 跑 dist）。
  - **最终方案**：esbuild 打包 server 为单文件（`--platform=node`），运行时零依赖解析、无扩展名问题。这也是 Electron 一直用的方式（`server.ts` 由 esbuild 打包）。

### 6. node:20 无 `node:sqlite`

- **现象**：运行报 `ERR_UNKNOWN_BUILTIN_MODULE`。
- **根因**：`node:sqlite` 是 Node 22+ 内置，容器 node:20 没有。
- **反思**：**依赖较新 Node 内置特性时，容器版本必须匹配**（本项目需 node:22+）。基础镜像别用太旧。

### 7. 容器服务绑 127.0.0.1 → 端口映射不可达

- **现象**：health 从外部 `Connection reset by peer`，但容器日志显示 listening。
- **根因**：compose 端口映射（host 0.0.0.0 → 容器 eth0）通过 DNAT 到**容器 IP**，而服务只绑了容器内 `127.0.0.1`（loopback）→ 到达不了。
- **反思**：**容器内服务要绑 0.0.0.0** 才能被端口映射到达。Docker 的"127.0.0.1"是容器自己的 loopback，不是宿主机的。

### 8. `npx esbuild` 在 workspace 根找不到 bin

- **现象**：`sh: 1: esbuild: not found`。
- **根因**：esbuild 是 server 的 devDependency，bin 在 `packages/server/node_modules/.bin`，`npx esbuild` 从 `/app`（workspace 根）找不到。
- **反思**：pnpm 隔离 node_modules，**bin 查找要在包目录内**（`cd packages/server && npx esbuild ...`）。

### 9. 服务器旧代码导致 Dockerfile 改了但构建没变

- **现象**：反复改 Dockerfile 上传，构建仍用旧代码（如 server 没装 esbuild）。
- **根因**：`deploy_fix` 只上传 Dockerfile，**没同步 package.json/pnpm-lock** → pnpm install 用旧的依赖清单。
- **反思**：**部署脚本必须保证代码 + 依赖清单 + Dockerfile 同步上传**。只改部分文件的"热修复"容易漏。

### 10. 阿里云安全组未放行端口

- **现象**：8888 可达、8787 不可达（服务器内防火墙全开）。
- **根因**：阿里云安全组（控制台）只放行了之前配过的 8888。
- **反思**：公网部署的端口放行要在**云控制台安全组**配置，服务器内防火墙只是第二层。

### 11. 服务器内存 1.8G 的构建限制

- **现象**：构建较慢，但最终成功。
- **反思**：小内存服务器构建 pnpm workspace 可行但紧张；若失败可考虑服务器本地构建或用构建机预构建镜像。

## 最终可行的部署方案（已跑通）

```dockerfile
# 构建：esbuild 打包 server 单文件 + 前端产物
RUN pnpm --filter @ensemble/shared build \
  && pnpm --filter @ensemble/web build \
  && cd packages/server \
  && npx esbuild src/index.ts --bundle --platform=node --format=cjs --outfile=dist/headless.cjs

# 运行：单文件 + 静态资源，零依赖解析
FROM node:22-slim
COPY --from=build /app/packages/server/dist/headless.cjs ./server.cjs
COPY --from=build /app/packages/web/dist ./web-dist
CMD ["node", "server.cjs"]
```

**要点**：esbuild 单文件（绕开 ESM 扩展名 + 依赖解析）、node:22（node:sqlite）、容器绑 0.0.0.0。

## 部署流程教训（操作层）

1. **先本地验证最终运行方式**：`node <bundle>.cjs` 能跑，再上 Docker——本地跑通能挡住 80% 的问题。
2. **部署脚本原子化**：代码 + 依赖 + Dockerfile 一起上传，避免热修复漏文件。
3. **验证用 curl 分层**：容器内 → host 端口 → 公网，逐层定位（绑地址/端口映射/安全组）。
4. **看镜像而非记忆**：`docker run --rm <image> ls ...` 直接检查镜像内容，别靠推断。
