# 更新日志 / Changelog

合鸣（Ensemble）多 Agent 协作平台的版本更新记录。版本号规则见 [desktop/docs/WIKI.md](desktop/docs/WIKI.md#版本号规则)。

---

## v0.7.17 (2026-08-13) — 聊天页逐条已读/未读

**改动**：
- 每条自己发送的消息显示「已读 / 未读」小字（对方打开会话或正在看时实时变已读）
- 服务端 `markRead` 广播 `chat.read` 事件；对方在会话中收到消息即时重新标记已读

**版本**：0.7.16 → 0.7.17，APK versionCode 26

## v0.7.16 (2026-08-13) — 未读显示改到消息下方小字

**改动**：会话卡片未读从右上角角标改为最后一条消息下方小字「未读 N 条」（红色小字），更清晰

**版本**：0.7.15 → 0.7.16，APK versionCode 25

## v0.7.15 (2026-08-13) — 消息红点 + 手机通知 + 会话预览实时更新

**未读红点**：底部「聊天」Tab 显示未读总数角标；进入会话扣除对应未读
**手机通知**：WS 收到新消息（非当前会话）弹系统通知（Android channel + 13+ 权限请求）；app 前台/后台（未杀）生效
**会话预览实时更新**：收到新消息本地立即更新对应会话卡片最后一条消息，不再等整表刷新（消除预览延迟）
**依赖**：新增 expo-notifications（打包需 prebuild 应用 plugin）
**局限**：通知依赖 WS 连接，app 被杀后需远程推送（FCM / Expo push，自用场景未接）

**版本**：0.7.14 → 0.7.15，APK versionCode 24

## v0.7.14 (2026-08-13) — 发送后键盘保持弹出（可连续输入）

**问题**：发送一条消息后输入法自动收起、界面回全屏——根因是发送时 `isSending` 把 TextInput 的 `editable` 切成 false，editable 变 false 会让输入框失焦收起键盘
**修复**：发送中不再切换 editable（保持可输入）；发送成功后重新聚焦输入框

**版本**：0.7.13 → 0.7.14，APK versionCode 23

## v0.7.13 (2026-08-13) — 联系人进入：已有会话直接进入，无则新建

**问题**：从联系人页点击用户/agent 总是新建 direct 会话，重复点击会产生多个会话
**修复**：进入前先查是否已有与该用户/agent 的 direct 会话——有则直接进入，无才懒创建

**版本**：0.7.12 → 0.7.13，APK versionCode 22

## v0.7.12 (2026-08-13) — 修复：会话列表不显示对方昵称

**问题**：会话列表卡片标题在用户列表异步加载完成后不刷新，一直显示对方 user id（FlatList 缺 `extraData`，data 引用未变则列表不重渲染）
**修复**：FlatList 加 `extraData`（用户列表），users 加载完成后列表重渲染、标题解析为昵称；转发目标列表同步修复

**版本**：0.7.11 → 0.7.12，APK versionCode 21

## v0.7.11 (2026-08-13) — 附件下载（图片 / 视频 / 文件）

**下载**：图片缩略图下方加「下载」按钮、文件/视频卡片右侧加下载图标——下载到本地 `downloads/` 目录并调起系统分享/保存面板（可保存到相册或文件管理器）
**依赖**：新增 expo-sharing

**版本**：0.7.10 → 0.7.11，APK versionCode 20

## v0.7.10 (2026-08-13) — 长按消息菜单：撤回 / 引用 / 转发

**交互**：长按任意消息弹出底部操作菜单——引用 / 转发 / 撤回（仅自己发送的消息显示撤回），取消关闭

- **撤回**：已有功能整合进长按菜单（仅自己的消息）
- **引用**：选择后输入栏显示「回复 xxx: 内容」引用条，发送时携带被引用消息摘要（`ChatMessage.replyTo` + `chat_messages.reply_to` 列迁移）；消息气泡内显示引用块
- **转发**：选择后弹出目标会话列表（排除当前会话），文本 + 附件原样发送到目标会话
- **服务端**：消息发送端点接收 `replyTo`（用户-用户会话），WS `chat.message` 事件透传

**版本**：0.7.9 → 0.7.10，APK versionCode 19

## v0.7.9 (2026-08-13) — 修复：输入法遮挡输入框（手动键盘处理）

**根因**：Android 15+ / RN 0.86 强制 edge-to-edge，`windowSoftInputMode=adjustResize` 在该模式下失效——系统不再随键盘 resize 窗口，键盘直接覆盖输入栏（此前依赖系统 resize 的 KeyboardAvoidingView 因此无效）

**修复**：改为手动监听 `keyboardDidShow`/`keyboardDidHide` 获取键盘高度，给输入栏动态加 `paddingBottom` 顶起；键盘弹出时消息列表自动滚动到底

**版本**：0.7.8 → 0.7.9，APK versionCode 18

## v0.7.8 (2026-08-13) — 修复：用户-用户消息方向 + 输入法遮挡

**消息方向**：用户-用户会话服务端双方 `role` 都是 "user"，此前按 role 判定导致双方消息挤在一边。改为按发送者是否当前用户判定——自己的消息右侧（绿色）、对方左侧（白色），双方屏幕各自正确
**输入法遮挡**：Android 键盘弹出时输入框被挡住。manifest 已有 `adjustResize`，但 KeyboardAvoidingView 用 `behavior="height"` 与系统 resize 冲突；改为 Android 交给系统 `adjustResize`（behavior 置 undefined），iOS 保持 `padding`

**版本**：0.7.7 → 0.7.8，APK versionCode 17

## v0.7.7 (2026-08-13) — 修复：聊天页显示用户昵称（不再显示 user id）

**问题**：移动端聊天页消息发送者名直接显示 user id（`agentId`），会话列表卡片标题也显示对方 user id

**修复**
- 聊天室加载用户与 Agent 列表，消息发送者按 id 解析为昵称（用户-用户会话显示对方 `displayName`/`username`；Agent 会话显示 agent 名）
- 会话列表卡片标题与进入聊天后的标题改为参与者昵称

**版本**：0.7.6 → 0.7.7，APK versionCode 16

## v0.7.6 (2026-08-13) — 修复：移动端明文连接被 Android 拦截（网络安全配置固化）

**背景**：v0.7.4 起移动端新增 expo-image-picker 等原生依赖，打包需 `expo prebuild --clean` 重新生成 android 工程，把此前手动加到构建目录的 `network_security_config.xml` 清掉了 → Android 9+ 默认禁明文，手机端连不上 `http://SERVER_IP_REDACTED:8787`

**修复**：用 config plugin（`mobile/plugins/withNetworkSecurityConfig.js`）固化网络安全配置——prebuild 时自动写 xml + AndroidManifest 引用，后续再 prebuild 也不丢。放行 SERVER_IP_REDACTED / DOMAIN_REDACTED / localhost 明文，其余仍强制 HTTPS

**版本**：0.7.5 → 0.7.6，APK versionCode 15

## v0.7.5 (2026-08-13) — 消息撤回 + 已读回执

**消息撤回（发送者可撤，对方实时可见「已撤回」）**
- 新增 `DELETE /api/conversations/:id/messages/:msgId`（仅发送者可撤；`chat_messages.deleted` 标记，兼容旧库迁移）
- 新增 WS 事件 `chat.deleted`：对方撤回实时生效（web / 移动端）
- 桌面 web：hover 自己消息显示「撤回」；移动端：长按自己消息撤回

**已读回执**
- `conversation_reads` 新增 `read_ts`（记录用户最后已读时间），消息历史接口返回各参与者 `readers`
- 用户-用户会话：自己消息被对方读过 → 显示「已读」（桌面 web / 移动端）

**版本**：0.7.4 → 0.7.5，APK versionCode 14

## v0.7.4 (2026-08-13) — IM 体验修复 + 图片/文件发送 + 微信式会话列表

**P0 修复**
- **断线重连补拉聊天消息**：chat.message 不走 run_events/seq，重连后重拉当前会话历史（web / 移动端）
- **web 端未读清零**：打开会话即调 `/read`（此前未读只增不清）
- **移动端 agent 会话消息去重**：乐观追加 + WS 回显相邻去重（content + role）

**图片 / 文件发送（用户-用户会话）**
- 新增 `POST /api/upload`（base64 JSON，20MB 上限）+ `/uploads` 静态服务
- `ChatMessage` 增加 `attachment` 字段（`chat_messages` 表加列，兼容旧库迁移）
- 桌面 web / 移动端：图片缩略图、文件卡片发送与渲染

**移动端会话列表改版（微信式）**
- 聊天页改为会话卡片列表（头像 / 名称 / 最后消息 / 时间 / 未读角标），点击卡片进入聊天页
- 新增 `ChatRoom` 聊天页（推入式，含附件）；新建对话从联系人页发起

**版本**：0.7.3 → 0.7.4，APK versionCode 13

## v0.7.3 (2026-08-13) — 版本号规则更新（0.7 系列 = IM 聊天优化 + 每次提交 patch +1）

**规则**（写入 [desktop/docs/WIKI.md](desktop/docs/WIKI.md#版本号规则)）
- **0.7 系列整体定位为「IM 聊天优化」**：0.7.x 内所有版本均在 IM 聊天范围内迭代（用户-用户 IM、会话加固、移动端 IM 修复等）；非 IM 新功能/重构升 0.8.0
- **每次代码提交 → 修订号 +1**：每个提交都是一个可追踪的迭代版本，便于按提交数核对代码迭代
- **提交时同步全部版本号位置**：desktop 根 + cli/desktop/server/shared/web 共 6 处 package.json、mobile package.json、mobile app.json（version + versionCode）、移动端 SettingsPage `APP_VERSION`、connection.ts `appVersion`

**版本**：0.7.2 → 0.7.3，APK versionCode 12

## v0.7.2 (2026-08-12) — 移动端登录门禁 + 服务器标签 + 数据层修复

**登录门禁**
- 打开应用先进登录页，登录/注册成功后进入主界面（未登录进不了主界面）
- 登录页含品牌/服务器连接状态/重连按钮；设置页登出回登录页
- 登录失败显示具体错误原因（不再吞成「操作失败」）；登录成功后即使 WS 重连失败也进入主界面

**连接标签**
- 连接显示改「云端服务器」（原「桌面端」）；各页空态/报错文案同步

**移动端网络安全配置**
- 仅放行自用服务器（SERVER_IP_REDACTED / 域名 / localhost）明文 HTTP，其余强制 HTTPS（解决 Android 9+ cleartext 拦截）
- 注：域名 HTTPS 被阿里云备案拦截（80/443 均拦），先用受限明文连 IP；备案合规后切 `https://DOMAIN_REDACTED`（服务器 nginx + 证书已就绪）

**数据层修复（登录/聊天/联系人进不去的真根因）**
- `api.request()` 解包服务器 `{data:...}` 信封（原又包一层，`res.data.token` / 数组全 undefined，桌面端正确而移动端漏解包）
- 影响：登录失败、聊天/联系人数据加载错位；修复后全部正常

**版本**：0.7.1 → 0.7.2，APK versionCode 11（v0.7.2 修订多次，最后为数据层修复版）

## v0.7.1 (2026-08-12) — 修复：桌面端启动崩溃 + 移动端直连云服务器 + 白色主题

**桌面端（v0.7.0 安装后打不开）**
- 修复数据库迁移崩溃：`migrateUserColumns` 重建 `chat_messages` 时兼容无 `user_id` 列的旧库（v0.6.0 之前的库升级时 `no such column: user_id`）
- 已用真实旧库副本 + 构造旧库验证迁移，数据保留

**移动端**
- 移除「连接模式」设置（LAN 直连/云端中继/手动 IP/连接历史/设备发现），应用启动自动直连云服务器 `SERVER_IP_REDACTED:8787`
- 新增账号登录/注册（用户 token AsyncStorage 持久化）；WS 携带用户会话 token（云服务器 ws-token 已禁用，登录鉴权）
- 修复设置页版本号显示（原硬编码 0.6.0）

**移动端白色主题**
- `theme.ts` 浅色系配色 + `userInterfaceStyle: light` + 启动页/图标白底

**移动端联系人**
- 底部导航新增「联系人」标签：用户（好友）+ Agent 分组、搜索、点击开聊（参考微信/Telegram 通讯录）
- 聊天页顶部连接状态条（已连接云端/未连接/重连中）；Dashboard 移除局域网设备发现

**版本**：0.7.0 → 0.7.1（bug 修复 → patch）

## v0.7.0 (2026-08-12) — 用户-用户 IM 全链路（桌面端）+ 会话加固

**用户-用户 IM（桌面 web 端补全，与移动端对齐）**
- 新增「用户」联系人分区（`/api/auth/users` 排除自己），已有会话显示未读 / 最后消息
- 点击用户首次发送时懒创建 direct 会话；消息方向按发送者==当前用户判定（用户会话双方 role 都是 user）
- 发送者昵称显示；历史 + WS 实时合并去重；打开会话清空旧 live 以历史为准
- 新消息到达节流刷新会话列表（未读 / 最后消息实时更新）

**服务端修复（Node 集成验证，4 处真实 bug）**
- `sendToUser` 补传 runId（原为空串，用户-用户实时消息两端关联不上会话）
- 用户-用户会话历史不过滤 userId（原按归属过滤，对方看不到消息）
- `listConversations` 增加 participant_ids 匹配（原只按归属，会话在对方列表不可见）
- 用户-用户推送接收者含会话归属用户（原只遍历 participantIds，创建者收不到对方回复）

**会话加固**
- **per-user 未读**：新增 `conversation_reads` 表，用户-用户会话各自计数，`/read` 只清当前用户（原共享计数，A 读会清 B 的未读）
- **访问控制**：用户-用户会话仅参与者可读写；agent 会话仅归属用户或共享会话可访问

**测试**
- server 145 单元测试（新增 per-user 未读回归）；Node 双用户集成验证 12 项全通过

## v0.6.0 (2026-08-11) — 企业级升级：账号系统 + agent 原生支持 + 会话系统

**账号系统（P0）**
- users/sessions 表 + 密码登录（scrypt，零新依赖）
- 认证双凭证：用户 session token / 机器 API key / 设备 token（桌面本地）
- `/api/auth`：注册 / 登录 / 当前用户 / 登出
- 数据隔离：任务 / 运行 / 聊天按用户隔离（userId 全链传播）；agents 团队共享
- Web 登录/注册页 + 路由守卫 + token 持久化

**agent 原生支持（P1）**
- 启动自动检测并接入本机 harness（opencode / claude-code / hermes 等）
- 缺失一键安装（npm/pip，走中文镜像 npmmirror/阿里）
- 已安装的本地 agent 默认启用

**会话系统 / 企业级 IM（P2）**
- conversations 表：direct（1:1 个体对话）/ group（多 agent 群聊）
- `/api/conversations`：列表 / 创建 / 消息分页 / 发送 / 已读 / 删除
- 未读计数、会话生命周期（终态拒绝发送）
- 前端会话列表持久化 + 消息落库统一

## v0.5.0 (2026-08-11) — 安全加固 + RAG 向量检索 + 移动端局域网直连 + 依赖升级

**安全加固**
- HTTP API 认证：所有 `/api/*` Bearer token；`/api/ws-token` Origin 校验；`ENSEMBLE_API_KEY` 支持
- relay-server 鉴权：`RELAY_AUTH_KEY` 握手鉴权 + `/devices` 保护 + 同设备顶替防串扰
- 三轮代码审查修复：headless 默认回环绑定 + 对外强制 API key；workflow id 路径穿越；settings 第三方 key 掩蔽；MCP 解释器命令白名单；全量写限流；health 收敛
- 取消语义：run 级取消（plan/adversarial 取消不再误标成功；取消终止本地子进程）

**新功能**
- RAG 向量检索：OpenAI 兼容 embedding 接入，vector/BM25/混合（RRF 融合）
- Chat 事件驱动：`WsHub.waitForRun` 替代 200ms 忙等待轮询
- 移动端局域网直连：桌面端 `ENSEMBLE_LAN_HOST` + mDNS；移动端原生 WebSocket 事件流（wslink）
- ConfigManager async：读缓存 + 异步写 + 互斥串行

**依赖升级**
- Express 5、reactflow → @xyflow/react v12、vitest 3、Vite base "./" + target es2022

**测试**
- server 128 单元测试 + relay-server 9 集成测试；移动端 typecheck 0 错误

## v0.4.3 (2026-08-10) — 安全加固 + 画布修复 + 内部弹窗 + 移动端全面改进

**桌面端安全加固（两轮深度审查，16 项高危修复）**
- 命令注入防护：Shell 元字符检测 + 词边界黑名单 + MCP 命令审计
- API Key AES-256-GCM 加密存储
- WebSocket Token 认证 + timingSafeEqual
- Electron CSP + will-navigate + 权限拒绝
- SSRF 防护（私有 IP + 符号链接穿越 + OpenAPI loader）
- 速率限制（API + WebSocket 双层）
- 数据库级联删除 + 复合索引

**桌面端新增功能**
- 工具确认内部弹窗（ToolConfirmDialog，替代 native dialog）
- ErrorBoundary 全局错误边界
- LLM 指数退避重试（尊重 Retry-After）
- RAGStore 持久化 + 中文 bigram 分词
- CI/CD 流水线（GitHub Actions）
- 58 个单元测试（vitest）

**桌面端修复**
- 协作画布：AgentNode 注册 + 历史事件绕过节流
- 前端性能：Dashboard/ChatPage/TasksPage memo 优化
- 编排引擎：错误传播 + DAG 死锁改进
- 记忆池：LIKE 转义 + 过期清理 + ID 碰撞消除
- 错误处理：silent catch → 日志 + toast 反馈
- 无障碍：7 个页面 ARIA 属性

**移动端全面改进**
- 新增 RunPage：任务执行详情页（实时事件流、工具调用、取消操作）
- ChatPage 改进：直接 Agent 对话 + Agent 选择器 + 错误反馈
- API 服务：全面类型化 + 15s 超时 + 用户友好错误信息
- 连接服务：事件发射器 + 指数退避重连 + 连接质量监控
- DashboardPage：任务卡片可点击 + REST API 刷新 + 连接质量显示
- SettingsPage：Ping 测试 + 连接历史 + 调试信息 + 中继认证
- ErrorBoundary 全局错误边界
- Store：事件订阅 + 类型化选择器 + 级联删除

## v0.4.2 (2026-08-10) — 测试与依赖清理
- 新增 vitest 单元测试框架
- 新增 `security.ts` 单元测试（shell 元字符检测、命令黑白名单、边界情况）
- 新增 `retry.ts` 单元测试（重试逻辑、Retry-After、AbortSignal）
- 移除未使用的 `p-limit` 依赖
- 更新架构文档：补充记忆池系统与 plan/adversarial 编排模式说明

## v0.4.1 (2026-08-10) — 深色模式修复
- 修复硬编码颜色，统一使用语义化 token
- 深色模式完全兼容

## v0.4.0 (2026-08-10) — 双记忆池系统
- 显式记忆池: 长期持久化，导航栏可见
- 隐式记忆池: 项目/Run 作用域，多 Agent 共享
- 记忆池工具 + API

## v0.3.0 (2026-08-10) — 多 Agent 架构
- Plan-Execute-Reflect 三阶段编排
- Coder vs Tester 对抗迭代
- RAG 知识库 + Function Calling 适配层
- 容器化部署 (Docker + Nginx)

## v0.2.0 (2026-08-09) — 性能优化

**前端**:
- React.lazy 路由懒加载（首屏 ↓55%）
- reactflow 动态加载（RunPage ↓92%）
- Vite vendor chunk 拆分
- 移除死依赖 -94 包

**Electron**:
- GPU 光栅化 + 零拷贝
- 后台渲染节流

**引擎**:
- Auto-Compact 阈值 0.5→0.95（参考 OpenCode）
- 工具循环恢复（参考 OpenClaw）
- Steering 消息注入（参考 OpenClaw）
- 预编译 SQL 语句（参考 OpenCode sqlc）

## v0.1.0 — 初始版本

- 内置 Agent + 本地 harness 接入
- 多 Agent 协作（single/workflow/chat）
- 实时监控 + 日志/时间线/画布
- 分层记忆 + Skill 系统
- Electron 桌面应用 + 自动更新
