# 合鸣移动端（Ensemble mobile）开发须知

## Expo HAS CHANGED
Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## 项目关键记忆（务必先读，避免重踩已有坑）

### 版本号与构建（最高优先级，极易出错）
- `mobile/android/` 是 **git-ignored** 的 expo prebuild 产物，`android/app/build.gradle` 会**硬编码过期版本号**（曾导致安装界面显示旧版、versionCode 不递增）。
- **发布 APK 一律用** `cd mobile && node scripts/build-release.cjs`（从 app.json 读版本注入 build.gradle 再 assembleRelease）；**不要**裸 `./gradlew assembleRelease`。
- **worktree/深路径下构建必挂**（ninja 报 build.ninja still dirty，CMake 目标路径>250 字符）：用 `git archive HEAD mobile shared | tar -x -C /d/ens-mb` 导出到短路径目录构建，并把 gitignore 的 server.config.js/getui.config.js 一并拷入；详见 `docs/mobile-ui-pitfalls.md` 第 10 节。
- 出包后先验证：`aapt dump badging .../app-release.apk | grep package`，确认 versionCode/versionName 与 app.json 一致再部署。
- 完整发布流程见 `docs/DEPLOY.md`。

### 数据模型易错点
- 1:1 会话在 `conversations.participant_ids` 存 JSON 数组字符串，有两种形态（手动建只含对方 / 好友接受含双方）。判断「已是好友」必须**双方同属任一 direct 会话**，不能按 user_id 单向。
- 云端 DB 在 Docker 命名卷 `/data/ensemble.db`，改数据用容器内 node 脚本（sqlite3 CLI 不在容器），或 `docker cp`。

### 通话 / WS 信令
- 服务器 `sendToUser(target, event, runId)` 缺省 runId=`""`；移动端 `wslink.ts` 入口若用 `!env.runId` 会丢弃无 runId 事件（call.signal / chat.mention 等）→ 收不到来电。**入口必须只判断 `!env.event`**。
- WebRTC ICE：默认 STUN + host；跨公网需 TURN（`mobile/server.config.js` turn 段，gitignored）。

### 应用内更新 / 安装
- 后台下载完成拉不起安装器：`expo-intent-launcher` 依赖当前 Activity，`launchInstaller` 需**先等 AppState 回前台**再拉起，失败重试。
- manifest 需 `REQUEST_INSTALL_PACKAGES`；安装被拦引导「允许安装未知应用」。

### 原生活动 / 插件
- 文件系统旧 API 在 **`expo-file-system/legacy`**（SDK57 新 API 分家）。
- 自定义 config plugin（个推/网络）放 `mobile/plugins/`，用 `withAndroidManifest`/`withDangerousMod`/`withAppBuildGradle`；改完必须 `expo prebuild --clean` 生效，安卓产物不进 git。
- 个推 `GETUI_APPID` 等凭据在 gitignore 的 `mobile/getui.config.js`；仓库只有 `getui.config.example.js`。

### 凭据与安全（绝对红线）
- 仓库**禁止**出现真实服务器 IP、密钥、SSH 密码。部署用临时 paramiko 脚本，用完删除；真实配置放 gitignore 文件。
