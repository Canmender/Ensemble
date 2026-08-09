# 合鸣（Ensemble）开发指南

面向开发者的本地开发 / 构建 / 测试 / 打包 / 发布流程。

## 环境要求

- Node.js ≥ 20（推荐 22+）
- pnpm（推荐 10+）
- Windows（桌面原生），macOS/Linux 理论上可运行但打包仅配置了 Windows

## 快速开始

```bash
# 1. 安装依赖（Electron 二进制已配国内镜像）
pnpm install

# 2. 构建共享类型包（其他包依赖其构建产物）
pnpm --filter @ensemble/shared build

# 3. 启动后端（仅开发调试用；桌面版会自起后端）
pnpm --filter @ensemble/server dev

# 4. 启动前端（Vite dev server，端口 5173）
pnpm --filter @ensemble/web dev

# 5. 启动桌面应用（开发模式：加载 Vite dev server，本地 server 固定 8787）
pnpm --filter @ensemble/desktop dev
```

> 日常开发：`pnpm dev:desktop`（桌面应用，最常用）；也可浏览器直开 `http://localhost:5173`（需先起 server）。

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm -r typecheck` | 全量类型检查 |
| `pnpm --filter @ensemble/server test` | 单元测试（vitest） |
| `pnpm --filter @ensemble/server build` | 构建 server |
| `pnpm --filter @ensemble/web build` | 构建前端 |
| `pnpm --filter @ensemble/desktop build` | 构建桌面 main/preload |
| `pnpm cli -- status` | CLI 健康检查 |
| `pnpm --filter @ensemble/desktop package` | 打包 Windows 安装包 |

## 开发模式详解

桌面开发模式（`pnpm --filter @ensemble/desktop dev`）：

1. `RENDERER_URL=http://localhost:5173` 环境变量 → 窗口加载 Vite dev server
2. 本地 server 固定 `127.0.0.1:8787`（Vite proxy `/api`、`/ws` 指向它）
3. 前端改动热更新（Vite HMR）；后端改动需重启（或 `tsx watch`）

### 改代码后重启

后端（server 包）改动影响桌面主进程（`@ensemble/server` 被打进 main bundle）：
```bash
pnpm --filter @ensemble/desktop build   # 重新打包 main/preload
pnpm --filter @ensemble/desktop dev     # 重启
```

> 注意：桌面存在**单实例锁**，改代码前先关闭已运行的实例，否则新实例会直接退出。

## 测试

单元测试位于 `packages/server/test/`（vitest），覆盖核心逻辑：

```bash
pnpm --filter @ensemble/server test          # 全部
pnpm --filter @ensemble/server test -- src/context.test.ts   # 单个
```

新增关键逻辑时请补充测试（hook、压缩、记忆、skill、offload、安全围栏等）。

## 打包

```bash
pnpm --filter @ensemble/desktop package
```

- 产物在 `packages/desktop/release/`
- `ensemble-<version>-setup.exe`（NSIS 安装包）+ `latest.yml`（自动更新元数据）+ blockmap
- 配置见 `packages/desktop/electron-builder.yml`

## 发布新版

```bash
# 1. 更新版本号（packages/desktop/package.json 与根 package.json）
# 2. 打包
pnpm --filter @ensemble/desktop package

# 3. 发布到 GitHub Releases
cd packages/desktop/release
gh release create vX.Y.Z "ensemble-X.Y.Z-setup.exe" "ensemble-X.Y.Z-setup.exe.blockmap" latest.yml \
  --repo Canmender/ensemble --title "合鸣 vX.Y.Z" --notes "..."
```

已安装用户启动时会自动检测新版本并一键更新（electron-updater 读 latest.yml）。

## 配置目录

应用运行时的配置在 userData 目录：

```
%APPDATA%/ensemble/
├─ config/
│  ├─ agents/*.yaml     # Agent 配置
│  ├─ providers/*.json  # LLM Provider
│  ├─ workflows/*.json  # 工作流
│  ├─ settings.json     # 应用设置（含安全围栏）
│  └─ mcp.json          # MCP 服务器
├─ data/
│  ├─ multiagent.db     # SQLite（任务/运行/记忆条目）
│  ├─ memories/         # 文件记忆
│  └─ skills/           # Skill 池
└─ secrets.json         # API Key（系统加密）
```

## CLI

```bash
pnpm cli -- status          # 健康 + 概览
pnpm cli -- agents          # Agent 列表
pnpm cli -- run --agent ds-assistant "prompt"
pnpm cli -- create provider --id deepseek --name DeepSeek --type openai --base-url https://api.deepseek.com --api-key sk-xxx
```

## 常见问题

- **Electron 二进制下载失败**：`.npmrc` 已配 `electron_mirror=https://npmmirror.com/mirrors/electron/`
- **pnpm 忽略 electron 构建脚本**：根 `package.json` 的 `pnpm.onlyBuiltDependencies` 已允许
- **桌面启动即退出**：检查是否有残留 electron 进程（单实例锁），`taskkill /F /IM electron.exe`
- **改了 server 代码不生效**：桌面需重新 `pnpm --filter @ensemble/desktop build`
