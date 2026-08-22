# 合鸣版本管理

## 概述

合鸣提供**本地版**和**云端版**两个独立版本，均为原生桌面应用（Electron）。
两版共用同一套源代码（`desktop/`），工作区完全隔离、互不污染，且可以**同时运行**。

## 目录结构

```
D:\MultiAgent/
├── 合鸣.bat                    # 主启动器（选择本地版/云端版）
├── desktop/                    # 主开发目录 + 原生桌面启动
│   ├── launch-desktop.bat      # 统一启动入口（构建并拉起 Electron）
│   └── packages/
│       ├── shared/             # 共享类型 + Zod schema
│       ├── server/             # 引擎核心（Express + SQLite）
│       ├── web/                # 前端（React）
│       └── desktop/            # Electron 壳
├── ensemble-local/             # 本地版入口（start.bat → 原生桌面 local）
├── ensemble-cloud/             # 云端版入口（start.bat → 原生桌面 cloud）
├── mobile/                     # 手机端（Expo + React Native）
└── relay-server/               # 云端中继服务器
```

> 历史说明：早期方案是 tsx+vite 浏览器运行、变体目录各自持有一份源码拷贝。
> 现已改为统一从 `desktop/` 启动原生 Electron；`ensemble-local/`、`ensemble-cloud/`
> 仅保留入口脚本，不再承载源码与运行时数据。

## 工作区隔离（v0.8.2 起）

两版的工作区按版本分区，位于各自的 userData 子目录：

```
%APPDATA%\@ensemble\desktop\
├── edition.txt                 # 最近一次启动的版本（无参启动时沿用）
└── editions\
    ├── local\                  # 本地版专属工作区
    │   ├── config\             # agents/providers/workflows/settings 配置
    │   ├── data\ensemble.db    # 本地数据库
    │   └── secrets.json        # API 密钥（DPAPI 加密）
    └── cloud\                  # 云端版专属工作区（结构同上）
```

- **数据库 / 配置 / 密钥**：两版各自独立，互不可见
- **登录态 / localStorage**：Chromium 存储随 userData 分区，天然隔离——
  这解决了旧浏览器方案中同源 `localhost:5173` 登录态互相污染的问题
- **单实例锁按版本作用域**：本地版和云端版可同时运行，互不干扰
- **首次迁移**：分区机制前旧数据直接写在 userData 根下；首次以本地版启动会自动
  迁移到 `editions/local/`。云端版不迁移（业务数据在云端服务器）

## 版本区别

| 特性 | 本地版 | 云端版 |
|------|--------|--------|
| **数据位置** | 本机 SQLite | 云端服务器 |
| **登录** | 无需登录 | 需要云端账号 |
| **网络** | 完全离线 | 连接云端 + 中继 |
| **前端模式** | 强制 local（跳过登录） | 强制 multi（进入登录页） |
| **端口** | 随机（同源自给） | 随机（同源自给），两版可并存 |

## 使用方式

### 方式一：主启动器

1. 双击 `合鸣.bat`
2. 选择「本地版」或「云端版」→ 拉起独立原生窗口

### 方式二：直接启动

```bash
ensemble-local\start.bat     # 本地版
ensemble-cloud\start.bat     # 云端版
```

### 方式三：开发模式

```bash
cd desktop
pnpm dev:local        # 本地版（Vite HMR）
pnpm --filter @ensemble/desktop dev:cloud   # 云端版（Vite HMR）
pnpm start:local      # 本地版（使用已构建产物，无 Vite）
```

## 云端配置

云端地址/中继不再走 `.env`：

1. **推荐**：打包/开发目录放置 `server.config.js`（参考 `server.config.example.js`，
   gitignore 不入库），提供默认 `cloud.host`
2. 或启动后在应用内「设置 → 运行模式」填写云端地址与中继配置
   （保存到云端版自己的工作区）

## 开发说明

- 两版共享同一套源代码（`desktop/packages/`），改代码只改这里
- 运行行为差异由 `--ensemble-edition=local|cloud` 启动参数驱动，
  渲染层经 preload 拿到 `window.desktop.edition` 后锁定对应运行模式
