# 合鸣移动端 IM 开发 Wiki

> 本页沉淀 0.7.x 迭代中移动端 IM 相关功能（即时通讯、语音通话、好友、应用内更新、推送）的架构要点、关键经验与发布流程，供后续开发与排障参考。

## 目录
- [架构概览](#架构概览)
- [技术栈与版本](#技术栈与版本)
- [版本号与发布流程](#版本号与发布流程)
- [应用内更新系统](#应用内更新系统)
- [语音通话（WebRTC）](#语音通话webrtc)
- [好友会话模型](#好友会话模型)
- [个推（GeTui）推送接入](#个推getui推送接入)
- [多端协作（云端 / 局域网）](#多端协作云端--局域网)
- [安全与凭据管理](#安全与凭据管理)

---

## 架构概览

| 端 | 技术栈 | 说明 |
|---|---|---|
| 移动端 | Expo SDK 57 / RN 0.86 / TypeScript | 聊天、语音通话、推送 |
| 桌面端 | React + Electron / Vite | Web UI + 桌面壳，与手机共用云端账号 |
| 云端 | Node + Express + WS（esbuild bundle 成 server.cjs） | REST + WS 信令转发，Docker 部署 |

移动端核心目录：`mobile/src/pages/ChatRoomPage.tsx`（聊天会话）、`mobile/src/services/`（callService/updateDownloader/getui 等）。

---

## 技术栈与版本
- Expo **57.0.11**，React Native **0.86**（新架构 New Architecture）
- 原生模块：`react-native-webrtc`（语音）、`expo-audio`（录音播放，替代已移除的 expo-av）、`expo-notifications`（本地通知）、`expo-intent-launcher`（调系统安装器）
- 文件系统：SDK57 新 API 与旧 API 分家，旧接口在 **`expo-file-system/legacy`**
- 网络：REST（`desktop/packages/server`）+ 原生 WS（`mobile/src/services/wslink.ts`）

---

## 版本号与发布流程

> **关键教训**：`mobile/android/` 是 git-ignored 的 Expo prebuild 产物，其中的 `android/app/build.gradle` 会硬编码过期版本号。直接 `gradlew assembleRelease` 会出「安装界面显示旧版本、versionCode 不递增」的错。

**正确发布流程**：

1. 只改 `mobile/app.json` 的 `expo.version`（版本号）和 `expo.android.versionCode`（严格递增）
2. 构建用 `cd mobile && node scripts/build-release.cjs`（它会从 app.json 读版本注入 build.gradle，再跑 assembleRelease）
3. 出包后先验证：`aapt dump badging .../app-release.apk | grep package`，确认 `versionCode/versionName` 与 app.json 一致
4. 部署：`scp` APK → `docker cp` 进容器 `/data/apk/` → 更新 `version.json`（versionCode 必须 > 当前）→ 验证 `/api/app-version`

> **不要**裸露 `.\gradlew assembleRelease`：prebuild 重生成时版本会回到旧值。

---

## 应用内更新系统

**流程**：登录后 `bootstrapUpdate()` → `checkAndPromptUpdate()` → UpdateManager 弹窗 → 后台下载 → 调起系统安装器。

**下载管理**（`mobile/src/services/updateDownloader.ts`，v0.7.76+）：
- 模块级单例 + AsyncStorage 账本（`@ensemble/update_download`），支持**后台下载 / 断点续传 / 等待重连**
- 断点续传：中断时用 expo `DownloadResumable` 的 `resumeData` 持久化，下次 `resumeAsync()` 续传
- 大小校验 >20MB 防下载到 HTML 错误页；版本化文件名防复用旧版

**安装器拉起的坑**（v0.7.79 修复）：
- `expo-intent-launcher` 依赖当前 Activity（`throwingActivity`），**后台完成的下载会因 Activity 丢失而拉不起安装器**
- 解决：拉前等 `AppState` 回 active + 重试 5 次；另提供 `installReadyApk()` 失败后重装已下载包（不重下）
- 权限：manifest 需 `REQUEST_INSTALL_PACKAGES`；安装被拦截时引导「允许安装未知应用」

---

## 语音通话（WebRTC）

**信令链路**：主叫 `wsLink.sendCall(target, offer)` → 服务器 `onCallSignal` → `sendToUser(目标, call.signal)` → 被叫 `handleSignal` → 响铃/接听。

**接听关键教训**（v0.7.77 修复）：服务器 `sendToUser` 默认 runId 为空字符串，移动端 WS 分发入口 `!env.runId` 会**丢弃无 runId 的事件** → 来电永远收不到。
- 修复：移动端 `wslink.ts` 入口放宽为 `!env.event`，放行 runId 为空的事件
- 服务器：call.signal 转发用占位 runId=`"call"`，避免桌面端建污染 run

- ICE：默认 STUN + host；跨公网需 TURN（`mobile/server.config.js` 的 turn 段，gitignored）
- 语音仅（无视频）；1:1 用户会话可用，群聊不提供

---

## 好友会话模型

**数据**：`friend_requests` 表存请求；`conversations` 表 `type=direct` 存 1:1 会话；`participant_ids` 是 JSON 数组字符串。

**关键教训**（v0.7.77 修复）：「已经是好友」判断不能只按 `user_id` 单词判断（会话创建者方向）。1:1 会话有两种存储形态（手动建 participant_ids 只含对方 / 好友接受含双方），正确判断是**双方同属任一 direct 会话**。
- 反向 pending：对方已发请求时，再发提示去处理，避免双向 pending
- 接受请求复用已有会话，不重复创建

---

## 个推（GeTui）推送接入

移动端接入个推 Android SDK（v0.7.78），使应用被杀也能收到通知。

**Config Plugin**（`mobile/plugins/withGetuiPush.js`，可持续、prebuild 后生效）：
- 注入 gtsdk/gtc/gsido + 个推 Maven 仓库（`https://mvn.getui.com/nexus/content/repositories/releases/`）+ `GETUI_APPID`/`GT_INSTALL_CHANNEL` manifestPlaceholder + Java8
- AndroidManifest：`GETUI_APPID` meta-data、`GeTuiPushService`（独立 push 进程）、`GeTuiIntentService`、`<queries>`
- `MainApplication.onCreate` 自动 `PushManager.preInit + initialize`
- 生成原生 Kotlin：`GeTuiPushService.kt` / `GeTuiIntentService.kt`

**JS 桥**：`mobile/src/services/getui.ts` 用 `DeviceEventEmitter` 收 `getui:clientId` / `getui:message` / `getui:notificationClicked`，缓存 cid 供服务端按用户绑定。

**凭据**：APPID/AppKey/AppSecret 放 gitignore 的 `mobile/getui.config.js`，模板 `getui.config.example.js` 提交；真实凭据不入库。

**配置坑**：
- 依赖不在默认仓库，需加个推 Maven 源
- `<queries>` 需 `<intent><action .../></intent>` 结构（action 不能直接放 intent 上，会报 manifest 合并错）
- 个推 SDK manifest 引用 `GT_INSTALL_CHANNEL` placeholder，缺值会合并失败

---

## 多端协作（云端 / 局域网）

- 「多端协作」切到云端：`connectionService.connectToCloud()` → `connect(CLOUD_SERVER.host, 8787)`，配置 `connectedDevice` 指向云端，REST/WS/下载/更新全部走云端服务器
- 局域网模式：直连桌面端发现的 IP；下载/更新同样走 `connectedDevice`
- 云服务器：`<SERVER_IP>`，容器 `ensemble-server`，数据在 `/data/ensemble.db`（Docker 命名卷，须 `docker cp` 访问）

---

## 安全与凭据管理

| 凭据/隐私 | 存放 | 是否入库 |
|---|---|---|
| 服务器地址/TURN | `mobile/server.config.js` | 否（gitignore，有 example 模板） |
| 个推 APPID/Key/Secret | `mobile/getui.config.js` | 否（gitignore，有 example） |
| 服务器 SSH 密码 | 会话内临时脚本 | 否（用完即删） |
| APK 文件 | /data/apk/ | 否（*.apk gitignore） |

> 原则：仓库内不含任何真实 IP、密钥、密码；部署用临时 paramiko 脚本，用完删除。

---

## 常见恢复操作

- **清理 gradle 文件锁**：`./gradlew --stop`（或杀 java 进程）后重试
- **清原生缓存**：`expo prebuild --clean` 前删 `android/app/.cxx`、`build/`
- **出包版本不对**：用 `node scripts/build-release.cjs` 构建 + aapt 验证
- **通话/消息收不到**：先查 WS 信令（`wslink.ts` 事件、服务器 sendToUser 的 runId）；再查 TURN/网络
