# 部署与出包实操手册

> 2026-10-04 电脑端会话产出。取代此前散落在 commit message 与对话里的部署记忆。
> 本文只写「怎么做」与「哪里会踩坑」，不写原理。
> 服务器地址一律用 `<SERVER_IP>` 占位，实际值见本地 `.env`（不入库）。

## 一、云端服务器部署

### 1.1 前提

- Docker 26.1.3 + Compose v2.27，干净环境（无历史容器与网络）
- 代码已推送到远端，本地 `git clone <repo>`

### 1.2 步骤（顺序不能颠倒）

```bash
# 1) 取代码
git clone <repo> && cd Ensemble

# 2) 建备份目录 —— compose 用宿主机 bind mount，目录不存在则容器起不来
mkdir -p /data/backups

# 3) 写 .env（权限 600）
cat > .env <<'EOF'
CLOUD_HOST=<SERVER_IP>
ENSEMBLE_API_KEY=<自行生成>
RELAY_AUTH_KEY=<自行生成>
EOF
chmod 600 .env

# 4) 构建并启动
docker compose build
docker compose up -d

# 5) 验证（见 1.3）
```

### 1.3 ⚠ 容器间通信用服务名，不是 127.0.0.1

```bash
RELAY_URL=http://relay:8888      # ✅ 服务名
RELAY_URL=http://127.0.0.1:8888  # ❌ 在 server 容器里指向自己
```

配成 `127.0.0.1` 的症状：server 日志报 `websocket error`，relay 连接失败，
表现为手机经中继访问桌面端不通。**同一份 compose 内的服务互访一律用服务名**
（`relay`、`server`），因为每个容器有独立的网络命名空间。

### 1.4 验证三档（由易到难，逐档排除）

```bash
# 1) 免鉴权端点（确认 server 活着且路由通）
curl -s http://<SERVER_IP>/api/health
curl -s http://<SERVER_IP>/api/app-version
curl -s http://<SERVER_IP>/api/settings

# 2) 容器层（确认 relay 真的 healthy，而不只是进程在）
docker compose ps        # relay 应显示 healthy

# 3) 鉴权链路（确认 apiAuth 生效，无 key 应被拒）
curl -s -o /dev/null -w "%{http_code}\n" http://<SERVER_IP>/api/agents
# 期望 401（不带 token）；若返回 200 说明鉴权被绕过，比不通更危险
```

## 二、出包前置四条（每条都是实测硬约束）

### 2.1 必须用 `package:cloud`，不能用默认 `package`

```bash
pnpm --filter @ensemble/desktop package:cloud   # ✅
pnpm --filter @ensemble/desktop package         # ❌ 云端版会失效
```

**失效形态**：默认 `electron-builder.yml` 的 `extraResources` 里
（`desktop/packages/desktop/electron-builder.yml:23-29`）**只有**
`../web/dist`、`build/icon.png`、`build/edition-local.txt` ——
**没有 `server.config.js` 这条**；只有 `electron-builder.cloud.yml:31` 才有。

**排查要点**：出问题时产物里**不是这个文件内容为空，而是整个文件不存在**。
两种形态的排查难度差别很大——内容为空会让人想到「配置写错了」，
文件不存在则根本想不到是打包配置漏了，会一路查错方向。

主进程 `desktop/packages/desktop/src/main/server.ts:97` 找不到
`process.resourcesPath/server.config.js` 后，走 `:113` 的 catch **静默继续**，
不报任何错。表现为：App 能启动、界面正常，但**多端协作默认地址与视频通话
的 TURN 配置全部失效**，用户看不到任何提示。

**出包后第一步验证**：在安装目录里搜 `resources/server.config.js` 是否存在。
不存在 → 立刻确认用了哪个打包脚本，而不是去排查云端地址。

### 2.2 构建机须先有 `.env` 含 `CLOUD_HOST`

否则 `scripts/ensure-server-config.mjs` 会 `exit 1`。
**这是正确设计——构建失败好过静默失效。** 见第四节教训 6。

### 2.3 安装包须传到服务器 `apkDir`

`apkDir` 由 `context.ts:157-163` 推导：`dirname(DB_PATH)/apk`。
当 `DB_PATH=/data/ensemble.db` 时即 **`/data/apk`**。
安装包（`setup.exe` / `.apk`）须与更新元数据放同一目录，
否则应用内更新拿不到包。

```bash
mkdir -p /data/apk
# 把 ensemble-setup-<version>.exe 传进去
```

### 2.4 更新元数据：`version.json` 与 `desktop.json`

路径同上（`/data/apk/`）。字段名由
`desktop/packages/server/src/api/routes/app-version.ts` 与
`desktop/packages/desktop/src/main/updater.ts:57,70` 决定：

| 文件 | 字段 | 读取方 |
|---|---|---|
| `version.json` | `version`、`versionCode`、`apkUrl` | app-version.ts:39-44 |
| `desktop.json` | `version`、`url` | app-version.ts:17-19；updater.ts:57 读 `meta.url` |

⚠ **是 `url` 不是 `desktopUrl`**。写错字段名时 `updater.ts:57` 的
`if (!meta?.version || !meta.url)` 直接判为「无可用更新」，**不报错**。

⚠ `url` 支持相对路径与绝对 URL 两种（`updater.ts:71` 会把相对路径拼到
`base`），但相对路径依赖 `cloudBaseUrl()` 正确解析；建议写完整 URL 更省事。

## 三、打包常见故障与解法

### 3.1 Gradle 报错：worktree 深路径必挂

```
ninja: error: manifest 'build.ninja' still dirty
Filename longer than 260 characters
```

**根因**：Windows 长路径限制。仓库在 `.claude/worktrees/<name>/` 下时路径
深度必然超限，**这不是偶发，是必挂**。必须导出到短路径构建：

```bash
# 导出到短路径（如 D:\emb3），三个源缺一不可
mkdir -p D:/emb3
git archive HEAD mobile desktop/packages/shared | tar -x -C D:/emb3

# ⚠ desktop/packages/shared 必须带：
#   mobile/package.json:17 指向 file:../desktop/packages/shared
#   漏了它则移动端依赖装不上

cd D:/emb3/mobile
npm install          # ⚠ node_modules 不进 git archive，必须重装
npx expo prebuild --platform android
```

### 3.2 `Cannot find module 'react-native-worklets/plugin'`

reanimated 4.x 时代的 babel 插件，依赖降级到 3.19.5 后失效。
需同步调整 `babel.config.js` 里对 `react-native-reanimated/plugin` 的引用。

### 3.3 导出后依赖装不上

`git archive` 只含 git 跟踪的文件，**`node_modules` 不在其中**，
每个短路径副本都要重新 `npm install`。

## 四、密钥与隐私纪律

| 规则 | 说明 |
|---|---|
| 真实 IP 不入库 | 文档与代码里一律 `<SERVER_IP>` 占位；测试用例用 RFC 5737 保留段（如 `203.0.113.5`） |
| `.env` gitignored | 部署时现写，权限 600 |
| `server.config.js` gitignored | 打包时由 `ensure-server-config.mjs` 生成 |
| 临时部署脚本用完即删 | 不要留在仓库目录里（即使未跟踪，也干扰 `git status` 判读） |
| 提交前自查 | `grep -iE "password\|secret\|api[_-]?key\s*=" <文件>` 应无命中 |

## 五、一页速查

```
出包：      package:cloud（不是 package）→ 确认 resources/server.config.js 存在
            → 安装包传到 /data/apk → 写 version.json / desktop.json
部署：      mkdir /data/backups → 写 .env(600) → build → up -d
            → RELAY_URL 用服务名不用 127.0.0.1
验证：      /api/health → docker compose ps(healthy) → 无 token 应 401
移动端：    git archive 导出到短路径（带 desktop/packages/shared）→ npm install → prebuild
```