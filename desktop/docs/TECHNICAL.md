# 合鸣（Ensemble）全局技术文档

合鸣是自托管的**多 Agent 协作平台**：Agent 自动化引擎 + 用户-用户/用户-Agent 实时 IM + 移动端控制。本文档是项目全局技术参考。

- 开发 Wiki：[WIKI.md](WIKI.md)
- 部署指南：[DEPLOYMENT.md](DEPLOYMENT.md) / [DEPLOY-NOTES.md](DEPLOY-NOTES.md)
- 踩坑记录：[PITFALLS.md](PITFALLS.md)
- 版本记录：[CHANGELOG.md](../../CHANGELOG.md)

---

## 1. 项目概述

- **定位**：自用多 Agent 协作 + IM 即时通讯，全量自托管
- **服务端**：阿里云 SERVER_IP_REDACTED，Docker Compose（server 8787 + relay 8888）
- **客户端**：Android 手机端（Expo/React Native）、桌面端（Electron，备用）、Web 前端
- **实时**：原生 WebSocket `/ws`（消息/事件流）+ socket.io relay（设备在线广播）

## 2. 技术栈

| 层 | 技术 |
|---|---|
| 移动端 | Expo SDK 57 / React Native 0.86 / TypeScript / Zustand / React Navigation |
| 移动端原生 | expo-audio（录音播放）、expo-notifications、expo-file-system、expo-application、expo-intent-launcher |
| 服务器 | Node.js 22 / Express / node:sqlite（SQLite） |
| Web | Vite + React（`desktop/packages/web`） |
| 共享协议 | `shared/src`（`@ensemble/shared-protocol`，TS 类型 + 消息校验） |
| 中继 | `relay-server`（socket.io，设备在线广播） |
| 部署 | Docker Compose / 阿里云 |

## 3. 架构总览

```
┌───────────────────────────────────────────────────────┐
│  移动端 (mobile)  Expo + React Native                 │
│  pages/ 各页面 │ components/ 组件 │ services/ 服务    │
│  store/ Zustand │ utils/ │ theme.ts 设计系统           │
└──────────────┬────────────────────────┬───────────────┘
               │ REST (8787/api)        │ WebSocket (8787/ws)
┌──────────────▼────────────────────────▼───────────────┐
│  服务器 (desktop/packages/server)  Express + SQLite    │
│  api/ 路由 (auth/conversations/chat/privacy/devices…) │
│  api/ws/hub.ts  WebSocket 事件中心（设备/消息/已读）   │
│  orchestration/ 编排引擎 + store.ts（预编译 SQL）      │
│  db/sqlite.ts  数据表 + 迁移                            │
└──────────────┬─────────────────────────────────────────┘
               │ /api/app-version + /apk/（应用内更新）
┌──────────────▼─────────────────────────────────────────┐
│  数据 /data（Docker 命名卷 ensemble_ensemble-data）    │
│  ensemble.db（SQLite）│ uploads/（附件）│ apk/（APK）  │
└────────────────────────────────────────────────────────┘
```

## 4. 目录结构

```
/
├── mobile/                  # Android 移动端 (Expo)
│   ├── src/
│   │   ├── App.tsx          # 入口：导航 + 登录门禁 + 启动
│   │   ├── pages/           # 16 个页面（登录/看板/任务/聊天/会话/联系人/我…）
│   │   ├── components/      # AppHeader/Avatar/VoiceRecorder/VoiceMessage/SmartMenu/UpdateManager…
│   │   ├── services/        # api(REST)/connection(连接)/wslink(WS)/notifications/appUpdate
│   │   ├── store/           # Zustand：authGate/device/unread/task/chatTarget/me/update
│   │   ├── utils/           # timeAgo/draft/convCache/convTitle…
│   │   └── theme.ts         # 设计系统（颜色/间距/圆角/字号）
│   ├── app.json             # Expo 配置（图标/插件/版本）
│   └── android/             # 原生工程（gitignored，本地构建）
├── desktop/
│   ├── packages/server/     # 服务器（Express + SQLite）
│   ├── packages/web/        # Web 前端（Vite）
│   ├── packages/desktop/    # 桌面端（Electron，备用）
│   └── docs/                # WIKI/架构/部署/踩坑
├── shared/src/              # @ensemble/shared-protocol（类型 + 协议）
├── relay-server/            # socket.io 中继
├── docs/DEPLOY.md           # 云端部署操作手册（本地）
└── CHANGELOG.md             # 版本更新日志
```

## 5. 数据模型（SQLite 核心表）

| 表 | 说明 | 关键字段 |
|---|---|---|
| users | 用户 | username/password_hash/role/display_name/avatar_url |
| sessions | 登录会话 | user_id/token/expires |
| conversations | 会话（1:1/群） | type/participant_ids/muted/pinned/announcement/group_muted/group_owner/group_admins |
| chat_messages | 聊天消息 | run_id/agent_id/role/content/attachment/reply_to/mentions/deleted |
| conversation_reads | 已读状态 | conv_id/user_id/unread/read_ts |
| devices | 设备（多端在线） | id/user_id/name/type/last_seen_at |
| upload_files | 上传文件 | md5/url/mime（MD5 去重） |
| privacy_settings | 隐私设置 | 7 项开关 |
| friend_requests | 好友请求 | target_id/message/status |
| tasks/runs/jobs/run_events | Agent 任务 | 状态/事件流 |

## 6. 关键流程

### 6.1 连接与认证

1. 启动 → `connection.init()` 生成设备 ID（Android ID）→ `connectToCloud()`（`connect(CLOUD_SERVER, 8787)`）
2. REST 探活 `/api/health` → 记录 `connectedDevice` → 状态"connected"
3. `wsLink.connect(ip, port, token)`：有 token 连 `/ws`；无 token 尝试 `/api/ws-token`（配置 API key 时 404 → 跳过 WS）
4. `api.getMe()`：有效 token → gate "in"；失效 → 清 token → gate "out"（登录页）
5. 登录/注册走 **REST**（不依赖 WS 状态），成功后重建 WS

### 6.2 消息发送与实时

- 发送：`ChatRoomPage.handleSend` → `api.sendConversationMessage`（POST `/api/conversations/:id/messages`）→ 乐观追加 → 服务器回执换真实 msgId → 3 次重试
- 接收：服务器广播 `chat.message`（WS）→ `wslink.onGlobalChatMessage` → 非当前会话则**弹系统通知** + 未读 +1
- 已读：`chat.read` 事件 → 对方打开/正在看时实时变已读
- @提及：`chat.mention` 事件 → 高优先级通知

### 6.3 应用内更新

1. 登录后自动检查（或「我」→「检查更新」）→ `GET /api/app-version`（无缓存）
2. 对比 `nativeBuildVersion`（versionCode）> 当前 → 弹窗
3. 下载：版本化文件名 + 缓存破坏参数 + 大小校验 → `getContentUriAsync` + `expo-intent-launcher` 调系统安装器
4. **发布新版**：更新 `/data/apk/version.json` + `docker cp` APK 进命名卷（详见 DEPLOY.md）

### 6.4 设备多端在线

- WS 连接上报 `deviceId/deviceName/type` → hub 记录 → `onDeviceStatus` 广播
- 服务器 `upsertDevice`（按 ID）+ `cleanupDuplicateDevices`（清同名离线旧设备）
- 联系人「设备」组实时显示在线状态

## 7. 构建与部署

### 移动端 APK
```bash
cd mobile
npm install            # 国内网络加 --registry=https://registry.npmmirror.com
# 新原生依赖需 expo prebuild + 腾讯 gradle 镜像（见 WIKI 构建 APK）
cd android && ./gradlew assembleRelease
# 输出 android/app/build/outputs/apk/release/app-release.apk
# 验证：aapt dump badging（版本/权限）+ unzip bundle 检查新代码
```

### 服务器部署（云端）
```bash
# 服务器无法直连 GitHub → SFTP 上传源码到 /opt/ensemble + docker compose up -d --build
# 数据卷 /data（命名卷 ensemble_ensemble-data）：DB/uploads/apk
# .env 未跟踪需保留；改文件用 docker cp 进容器
```

## 8. 版本管理

- 语义化 `x.y.z`；**每次提交 → 修订号 +1**（0.7 系列 = IM 聊天优化主题）
- 同步更新：desktop 6 处 package.json + mobile package.json + mobile app.json（version + versionCode）+ SettingsPage/AboutPage `APP_VERSION` + connection.ts `appVersion`
- **versionCode 严格递增**（Android 安装校验）；version.json 里 versionCode 需 > 客户端当前值才触发更新
- 发布新版流程见 [DEPLOY.md](../../docs/DEPLOY.md)「发布移动端新版本」

## 9. 移动端核心模块

| 模块 | 职责 |
|---|---|
| `services/api.ts` | REST 封装（类型化 + 信封解包 + 401 自动清 token + 重试） |
| `services/connection.ts` | 云端连接 + 设备信息 + 连接状态机 |
| `services/wslink.ts` | 原生 WS 事件流（chat.message/mention/read/device） |
| `services/notifications.ts` | 系统通知（channel + 权限 + WS 触发） |
| `services/appUpdate.ts` | 应用内更新（检查/下载/安装） |
| `store/meStore.ts` | 全局用户信息（昵称/头像即时刷新） |
| `store/unreadStore.ts` | 全局未读（Tab 红点/通知判定） |
| `components/AppHeader.tsx` | 全局导航栏（头像昵称 + 安全区处理） |
| `components/VoiceMessage.tsx` | 语音消息播放（expo-audio） |
| `components/UpdateManager.tsx` | 应用内更新弹窗 + 下载进度 |
