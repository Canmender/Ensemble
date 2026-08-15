# 踩坑记录 / Pitfalls

合鸣开发过程中踩过的坑与解决经验。按领域分类，每条含**症状 → 根因 → 解决**。

---

## Expo / React Native

### 1. expo-av 已从 SDK 57 移除（启动即崩溃）
- **症状**：安装 v0.7.47 后打开即退出（启动崩溃）
- **根因**：expo-av 16.0.8 是为 SDK 53/54 编译的旧包，**SDK 57 已移除 expo-av**（改用 expo-audio/expo-video），与 expo-modules-core 57 ABI 不兼容，应用启动注册原生模块时崩溃。v0.7.47 与 v0.7.46 的唯一原生差异就是 `libexpo-av.so`
- **解决**：迁移到 **expo-audio**（`useAudioRecorder`/`useAudioPlayer`）。验证方式：对比前后 APK 的 `lib/*.so` 差异

### 2. 模板字符串 → 字符串拼接转换漏改，导致 URL 变量丢失
- **症状**：消息/语音发送失败（404），多处排查无果
- **根因**：某次"模板字符串转字符串拼接"时，`sendConversationMessage` 的 URL 被误写成**字面量字符串** `"/api/conversations/${convId}/messages"`（非模板串），`${convId}` 原样发给服务器 → 404
- **解决**：改为 `"/api/conversations/" + convId + "/messages"`。排查：`grep -rn '"[^"]*\${'` 找所有残留的字面量 `${}`

### 3. bottom-tabs 自定义 header 不经过 elements Header（无安全区 inset）
- **症状**：看板/任务/聊天等 tab 标题一直被摄像头遮挡，改了很多次都不生效
- **根因**：`elements/Screen.js` 里 `HeaderShownContext = isParentHeaderShown || headerShown !== false`，tab 屏幕 `headerShown=true` → elements Header 的 `headerStatusBarHeight=0`，**自定义 header 是直接渲染的 JSX，无 spacer**。`headerStatusBarHeight` 选项对自定义 header 完全无效
- **解决**：AppHeader 自行加顶部 padding（`max(insets.top, StatusBar.currentHeight, 24)`）

### 4. 部分设备 insets.top 与 StatusBar.currentHeight 都返回 0
- **症状**：顶部文字仍被摄像头遮挡，加了 padding 但没效果
- **根因**：部分国产 ROM safe-area-context 测量返回 0，`StatusBar.currentHeight` 也可能为 0
- **解决**：padding 用 `Math.max(insets.top, StatusBar.currentHeight ?? 0, 24)`，24dp 是 Android 状态栏最小高度兜底

### 5. expo-file-system 新旧 API 混淆
- **症状**：`expo-file-system/legacy` 存在但直接 `expo-file-system` 找不到方法
- **根因**：SDK 57 的 expo-file-system 是全新 API（File/Directory/Paths），旧 API 在 `expo-file-system/legacy` 子路径
- **解决**：按需 `import * as FileSystem from "expo-file-system/legacy"`（旧 API）或新 API

### 6. 应用内更新下载到旧版 APK
- **症状**：弹窗显示新版本（0.7.52），但系统安装器显示旧版（0.7.50）
- **根因**：下载用固定文件名 `ensemble-update.apk` + 无缓存破坏参数，可能复用残留的旧文件或命中缓存
- **解决**：版本化文件名（`ensemble-update-{versionCode}.apk`）+ 缓存破坏参数（`?v=版本&t=时间戳`）+ 下载后大小校验（>20MB）

### 7. 服务端重置后登录被拦（死锁）
- **症状**：云端重置数据后，应用无法登录（一直"未连接"）
- **根因**：旧 session token 失效 → WS 连接失败 → 连接状态"reconnecting" → 登录页把"未连接"当服务器不可达而阻止登录。首次安装（无 token）时 WS 被跳过、状态保持"已连接"，所以能注册；有失效 token 时反而卡死
- **解决**：登录/注册走 REST 不依赖 WS 状态；api 收到 401 时清除持久化的失效 token

### 8. 设备重复注册（每次重装出现新的"我的手机"）
- **症状**：卸载重装后联系人「设备」出现新的"我的手机"
- **根因**：重装清空 AsyncStorage → 设备 ID 重新生成 → 服务器按 ID 存设备 → 重复
- **解决**：设备 ID 改用 Android ID（`expo-application.getAndroidId()`，重装/更新稳定）；服务器端清理同类型同名称的离线旧设备

---

## 原生 / Android

### 9. 自适应（adaptive）图标不能用作通知小图标
- **症状**：Android 13+ 收不到消息通知
- **根因**：无通知图标配置时 expo-notifications 用应用 launcher 图标，自适应图标渲染成空白/不显示
- **解决**：配置独立通知图标（白色剪影 vector drawable）+ manifest meta-data

### 10. Android 13+ 通知权限
- **症状**：有通知代码但不弹通知
- **根因**：Android 13+ 需运行时 `POST_NOTIFICATIONS` 权限；国产 ROM 默认关通知
- **解决**：先 `getPermissionsAsync` 再请求；告知用户去设置开启

### 11. CMake/ninja 原生构建缓存损坏（EBUSY / build.ninja 重建失败）
- **症状**：`./gradlew clean` 报 `externalNativeBuildCleanRelease` ninja 失败
- **根因**：`.cxx` 原生构建缓存陈旧/损坏（加/换原生模块后）
- **解决**：手动删除 `android/app/.cxx`、`build/`、`.expo` 后重建

### 12. Gradle daemon 文件锁
- **症状**：prebuild/构建时报文件被占用（EBUSY）
- **根因**：gradle daemon 锁住文件
- **解决**：`<gradle-dist>/bin/gradle.bat --stop` 停 daemon 再操作

### 13. 应用内安装 APK 需 FileProvider + REQUEST_INSTALL_PACKAGES
- **症状**：下载完 APK 调不起安装器
- **根因**：Android 7+ 禁止 file:// URI（FileUriExposedException），需 content:// URI + 安装未知应用权限
- **解决**：`FileSystem.getContentUriAsync` 转 content:// + `expo-intent-launcher`（`flags: FLAG_GRANT_READ_URI_PERMISSION|FLAG_ACTIVITY_NEW_TASK`）+ manifest 声明 `REQUEST_INSTALL_PACKAGES`

---

## 服务器 / 部署

### 14. Docker 命名卷 vs 主机路径（/data 写错地方）
- **症状**：`/data/apk/version.json` 写了但 `/api/app-version` 读不到
- **根因**：`volumes: ensemble-data:/data` 是**命名卷**，不是主机 `/data` 目录！主机 `/data` 是另一处
- **解决**：用 `docker cp` 进容器（`docker cp file ensemble-server:/data/apk/`）或访问卷挂载点 `/var/lib/docker/volumes/ensemble_ensemble-data/_data`

### 15. 服务器（阿里云）连不上 GitHub
- **症状**：`git fetch origin main` 超时/失败
- **根因**：国内网络访问 GitHub 不稳定/被墙
- **解决**：SFTP 直接上传改动文件到 `/opt/ensemble`（或打 tar 全量同步）+ `docker compose up -d --build`。`.env` 未跟踪需保留

### 16. Docker 构建用 esbuild（不做类型检查）
- **症状**：服务器 tsc 有类型错误但 Docker 构建能过
- **根因**：`Dockerfile` 用 `npx esbuild src/index.ts --bundle`（剥离类型，不检查）
- **解决**：服务器类型错误不阻塞部署；但应尽量修（`tsc --noEmit` 本地检查）

### 17. Docker 构建失败：引用了服务器上没有的文件
- **症状**：上传了新 `app.ts`（引用 `./api/routes/privacy`）但服务器旧代码没有该文件 → esbuild 报 `Could not resolve`
- **根因**：只上传了部分文件，服务器代码不同步
- **解决**：服务器代码需整体同步（tar 全量上传）或上传所有新增/改动的文件

---

## Git / 工具链

### 18. Windows 上 sed 会把 CRLF 转成 LF（git 行尾噪音）
- **症状**：`sed -i` 改版本号后，git diff 显示整个文件 1000+ 行变化
- **根因**：Windows Git Bash 的 sed 重写文件时把 CRLF 变 LF，git（autocrlf=false）视为全部变更
- **解决**：改版本号等小改动用 `sed -i 's/.../'` 后检查 diff 行数；或改用 perl 保留行尾；避免对 CRLF 文件用 sed

### 19. Hermes 字节码 grep 不到中文字符串
- **症状**：从 APK 的 `index.android.bundle` 验证中文文案（如"群聊"）grep 不到
- **根因**：release 版 bundle 是 Hermes 字节码，中文字符串不以明文存储
- **解决**：用 ASCII 标识符（函数名/变量名）验证 bundle 内容；中文用 aapt/badging 验证

### 20. Android 桌面图标缓存
- **症状**：更新应用后桌面图标还是旧的
- **根因**：Android 启动器缓存旧图标，不会立即刷新
- **解决**：重启手机或刷新启动器

---

## 其他

### 21. 语音录制重录失效
- **症状**：重录按钮点了没反应（计时走但录不到声）
- **根因**：expo-audio 构造器不自动 prepare，`stop()` 后 reset，用轮询的 `canRecord` 判断导致跳过 prepare → `record()` 空操作
- **解决**：每次 start 前无条件 `prepareToRecordAsync()`（官方 docs 模式）

### 22. FlatList 没有 getScrollOffset 方法
- **症状**：消息分页加载静默失败
- **根因**：`FlatList.getScrollOffset()` 不存在（TS 报错 + 运行时 TypeError）
- **解决**：用 `onScroll` 跟踪 `scrollYRef` 恢复滚动位置
