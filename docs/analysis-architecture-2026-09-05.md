# 合鸣（Ensemble）工程架构与框架选型深度分析 — 2026-09-05

范围：全仓库（desktop/ monorepo、mobile/、relay-server/、shared/、ensemble-*、docker/nginx/CI）。
基线：分支 `claude/clever-bose-949a87`（HEAD 400b6ed）。
已知事实直接引用两份审计底稿：`docs/audit-backend-2026-09-04.md`（后端）、`docs/audit-cross-cutting-2026-09-05.md`（跨切面）。
本文件不含任何真实 IP / 凭据；外部主机一律 `<SERVER_IP>` / `<NTFY_SERVER_IP>`，密钥一律 `<SECRET>`。

---

## 0. 结论摘要（TL;DR）

1. **架构骨架是清晰的，但地基正在塌陷**。模块划分（orchestration / api / db / llm / tools / memory / plugins / push / discovery）方向正确，依赖方向基本单向（app → context → engine/store/hub → db）。但 `f4e02cd` 坏合并把 `store.ts` / `db/sqlite.ts` 回退到 pre-v0.8.3，tsc 52 错、25/193 测试红，Docker 走 esbuild 绕过类型检查照发——**架构文档与运行时现实已经脱节**。
2. **最大的工程风险不是框架选错，而是"三处类型源 + 两份源码拷贝 + 一个死协议包"的多头治理**。`desktop/packages/shared`（pnpm workspace）、根 `shared/`（@ensemble/shared-protocol）、`ensemble-cloud/local/packages`（物理拷贝）并存；`device-messages.ts` 三份当前 md5 相同（f9e59107），但已有 24h 内漂移先例（08-28 手工同步，08-29 只改 desktop）。
3. **框架选型整体匹配当前规模（自用/小团队，单实例部署）**：Express + node:sqlite + esbuild、Electron 壳、React 18 + Vite、Expo SDK57、socket.io+ws 双通道——每一项单独看都不算错，错在**没有配套的工程闸门**（CI 不构建部署镜像、不覆盖 mobile/relay、esbuild 跳过 tsc）。
4. **扩展性上限明确**：单进程 WS hub + 单 SQLite + 内存速率限制/去重 + relay 单点内存离线队列。100 用户内无感；1k 用户开始碰内存态无界增长与 WS 背压；10k 用户时单实例模型本身不成立（seq 分配、kick 下线、relay 离线队列全部依赖单进程内存假设）。

---

## 1. 工程结构

### 1.1 Monorepo 布局与 workspace 依赖

```
MultiAgent/ (git root)
├── desktop/                    ← pnpm workspace（根 package.json 0.8.39，落后于子包）
│   ├── pnpm-workspace.yaml     ← packages: packages/*
│   ├── Dockerfile              ← 部署镜像（esbuild 打包 server → 单文件 headless.cjs）
│   ├── scripts/ensure-server-config.mjs   ← 云端版出包门禁（desktop 独有）
│   └── packages/
│       ├── shared   (@ensemble/shared 0.7.45)  ← 类型 + zod schema，被 3 方消费
│       ├── server   (@ensemble/server 0.7.46)  ← Express + WS + SQLite + 编排引擎
│       ├── web      (@ensemble/web    0.7.24)  ← React 18 + Vite + Tailwind
│       └── desktop  (@ensemble/desktop 0.8.42) ← Electron 壳，内嵌整个 server 进程
├── mobile/                     ← Expo SDK57 / RN 0.86（app.json 0.9.33 ≠ package.json 0.9.11）
├── relay-server/               ← 独立服务：Express + socket.io + cors + uuid（0.1.0 永不 bump）
├── shared/                     ← @ensemble/shared-protocol 0.1.0：实际是死包（见 §1.4）
├── ensemble-cloud/             ← 脚手架残留：start.bat + 12 份 server/shared 源码拷贝
├── ensemble-local/             ← 同上（文档称"软链接"，实为物理拷贝且持续漂移）
├── docker-compose.yml / docker-compose.prod.yml
├── nginx/nginx.conf            ← 只代理 relay:8888，不代理主服务（与文档架构图相反）
└── .github/workflows/ci.yml    ← 4 job：typecheck/test/build/docker（docker 只构建 relay）
```

**workspace 依赖方向（实测自各 package.json）**：

```
                ┌──────────────┐
                │  @ensemble/  │  类型 + zod schema（唯一事实源，应当是）
                │   shared     │
                └─────────────┘
            workspace: │*   file:../desktop/packages/shared（metro 别名直指 src/）
        ┌──────────────┼───────────────────────────────┐
        ▼              ▼                               ▼
  @ensemble/server  @ensemble/web                (mobile)
        ▲
        │ workspace:*（desktop 壳内嵌 server 作为本地进程）
  @ensemble/desktop ──── Electron main 里 startLocalServer()
```

**结构合理性评估**：

- **合理**：desktop 壳依赖 server（壳内起本地后端）是自托管产品的正确形态；shared 作为 workspace 包被 server/web 消费、被 mobile 通过 metro extraNodeModules 直接吃 TS 源码（同一份源码，避免 dist 版本错位）——这个 mobile 接入方式是全仓库最聪明的工程决策。
- **不合理**：
  1. **版本矩阵失控**。7 个 package.json + 2 个 CHANGELOG + 1 份 README 徽章，互不对齐（详见跨切面审计 §2）。monorepo 的价值就是统一版本，当前等于没有 monorepo 纪律。
  2. **ensemble-cloud/local 悬挂在 workspace 外**。没有 package.json、不进 CI/Docker/启动链，却各跟踪 12 份真实源码（hub.ts 已落后 desktop 62 行、push.ts 20 行）。它们是"不可见漂移"：任何按 README 假描述（"软链接"）修改这些文件的人，改动会静默丢失。建议删除两目录下 packages/，只留 start.bat。
  3. **CI 覆盖与部署链脱钩**：CI 的 docker job 只构建 relay-server 镜像，真正部署用的 desktop/Dockerfile（esbuild 绕过 tsc 的那条链）在 CI 零覆盖——这就是 52 个 tsc 错误能一路绿灯发到云端镜像的结构性原因。

### 1.2 构建链

| 端 | 工具链 | 现状问题 |
|---|---|---|
| shared | tsc 出 dist | dist 产物（.d.ts/.js/.js.map）被一并提交进 src/ 目录，应只提交 src |
| server dev | tsx watch | 正常 |
| server build | tsc（本地）/ **esbuild --bundle（Docker）** | **双构建路径不一致**：tsc 52 错但 esbuild 照打。esbuild 对 ESM 无扩展名导入的 bundle 是必要的，但应当 esbuild + tsc --noEmit 双跑，而不是二选一 |
| web | tsc -b && vite build | 正常 |
| desktop 壳 | esbuild（main/preload 单文件）+ electron-builder | 正常；--ensemble-edition=local/cloud 双版本 + userData 分区设计清晰 |
| mobile | metro（Expo SDK57）+ babel + patch-package | metro.config.js 为 libsignal 生态做了大量 polyfill 补丁（node:crypto 空模块、resolveRequest 重定向），高维护成本脆弱点：每次升级 libsignal/@peculiar 依赖都可能白屏，且 mobile 在 CI 零覆盖 |
| relay | CI 直接 docker build（无本地 build 脚本） | relay 有 typecheck/test 脚本但 CI 不跑 |

### 1.3 Docker 部署链

```
desktop/Dockerfile:  pnpm install → tsc(shared) → vite(web) → esbuild(server→headless.cjs)
                     → node:22-slim + server.cjs + web-dist，EXPOSE 8787
docker-compose.yml:  server(8787) + relay(8888) + nginx(80/443，只代理 relay)
docker-compose.prod.yml: 只给 relay 加资源限制/日志轮转，server 无生产覆盖
nginx: 不代理主服务 → 文档声称的"安全头/限流对 Web UI 生效"是假的（跨切面 C-4）
```

关键结论：**生产部署 = 单容器单进程 server + 单容器 relay**。这决定了 §5 扩展性上限的所有假设都成立（单进程内存态、单 SQLite 文件、单 hub 实例）。

### 1.4 shared 三源问题（治理核心）

| 包 | 路径 | 消费者（实测） | 状态 |
|---|---|---|---|
| @ensemble/shared | desktop/packages/shared | server、web（workspace）；mobile（metro 别名直吃 src）；ensemble-*/packages 拷贝的源头 | 事实上的单一事实源 |
| @ensemble/shared-protocol | 根 shared/ | **构建期无任何包消费**（TECHNICAL.md 还在为它背书）；messages.ts 的 ChatMessage 缺 seq/userId/status 等全部新字段，plan/adversarial 模式、plugin-card 附件类型也没有 | **死包**，但 ChatMessage 形状与活包分叉，任何误 import 都是静默契约错误 |
| device-messages.ts 三份 | desktop/packages/shared、ensemble-cloud、ensemble-local | 当前 md5 相同（f9e59107，257 行） | 08-28 靠手工提交同步，08-29 的 ntfy 提交只改 desktop → **24 小时内漂移复现** |

建议方向（不改代码）：删除根 shared/（或降级为只含 PROTOCOL.md 的文档目录）；删除 ensemble-*/packages；mobile 的 metro 别名保持不动。

---

## 2. 框架选型评估

### 2.1 服务端：Express 5 + node:sqlite + esbuild

**当前用法**（实测）：
- Express 5.2 手搓：createApp(ctx) 工厂，19 个 router 挂载 + apiAuth（三凭证：用户 session → 机器 API key → 设备 token）+ 内存写限流（60/min/IP）+ 手搓 CORS（**origin.startsWith('http://') 放行任意 http origin，是审计里的 P1**）。
- node:sqlite（Node 22 内置 DatabaseSync）：同步 API + WAL + 手调 PRAGMA（cache 64MB、mmap 256MB、busy_timeout 5s）。schema 内联在 sqlite.ts 以便 esbuild bundle；迁移是 migrateUserColumns() 的 PRAGMA table_info 探测 + ALTER 序列，**无 user_version 台账**，且缺 7 张活代码要用的表（user_plugins/plugin_kv/device_link_events/message_reactions/group_members/organizations/departments）。
- esbuild 单文件 bundle：解决 Node ESM 无扩展名导入 + 运行时零 node_modules，运行阶段镜像极小。

**vs 候选**：

| 维度 | 现状（Express + node:sqlite） | Fastify | NestJS | Drizzle | Prisma |
|---|---|---|---|---|---|
| 与单实例自托管定位匹配度 | 高 | 高 | **过度**（DI/装饰器/模块化对当前规模是负资产） | — | 中 |
| 类型安全 | zod schema 在 shared 层做输入校验（只有 tasks 路由用了） | 同 Express，路由 schema 更严格 | 框架内建 | **编译期 SQL 类型，正好补 node:sqlite 裸 SQL 的类型洞** | 强，但迁移/生成链重 |
| 迁移能力 | **无**（最大短板） | 无关 | 无关 | 内建 SQL migrations | 内建，最重 |
| 包体/启动 | 极小（node:sqlite 零依赖） | 小 | 大 | 小 | 中（engine 二进制） |
| 渐进替换成本 | — | 中（router 签名不兼容，30+ 路由文件全改） | 高 | **低**（保留 Express，只换 SQL 写法，可逐文件迁） | 中 |

**结论**：
- **Express 保留**。30+ 路由文件、19 个 router 工厂、大量 asyncH/ok/fail 辅助已成型，换 Fastify/NestJS 的收益（性能/结构）对单实例自用产品为零，迁移成本却是全量路由重写。Express 的问题不在框架，在**中间件纪律**：CORS 任意 http 放行、9 个 router 未挂载、envelope 不一致（memory-pool/relay 裸 res.json）——这些都是代码问题不是框架问题。
- **node:sqlite 保留，但必须补迁移台账**。同步 API + WAL + busy_timeout 在单进程内是安全的（JS 单线程保证 seq MAX+1 与 INSERT 不交错，见后端审计 §6）。真正的债是：无 PRAGMA user_version、缺表、多写不包事务。**不需要换 Prisma**（其 client 生成 + 迁移链对"schema 内联便于 bundle"的约束是反向的）；若要 SQL 层类型安全，Drizzle 的 sqlite-core 可以逐文件渐进迁（支持 node:sqlite 驱动、无运行时依赖），优先级 P2。
- **esbuild 保留，但 CI 必须加 tsc --noEmit 闸门**。当前"esbuild 绕过类型检查照发"是全仓库最危险的构建决策：它让 52 个编译错误、5 个 P0 运行时崩溃全部能上生产。修法不是换构建器，是把 Dockerfile 的 build 阶段改成 tsc --noEmit && esbuild。

### 2.2 Electron（vs Tauri）

**当前用法**：Electron 43 壳（main/preload esbuild 单文件 cjs），核心设计是**壳内直接 import @ensemble/server 起本地后端**（startLocalServer()），prod 随机端口 + 同源托管 web/dist，local/cloud 双 edition 按 userData 分区（单实例锁随分区，两版可同开）。

| 维度 | Electron（现状） | Tauri |
|---|---|---|
| 与"内嵌 Node 后端"匹配 | **完美**（server 就是 Node，壳内进程内零成本调用） | **根本冲突**：Tauri 前端是系统 WebView，后端必须是独立二进制/子进程；@ensemble/server 要么 Rust 重写，要么改 IPC + 独立 node 子进程 |
| 内存占用 | 高（Chromium） | 低 |
| 更新链 | 自研 app-version 走云端存储（无 electron-updater，与 desktop/README 声称相反） | tauri-updater |
| 桌面端 UI 技术 | 直接复用 web 包（React 一份代码两端） | 同 |

**结论**：**Electron 是唯一正确选择，不要换**。"壳内嵌 Node server"是这个产品自托管定位的架构基石（同一份 server 代码跑桌面/云端 Docker/headless），Tauri 会把它撕成两半。桌面端真正的债在更新链：文档声称 electron-updater/GitHub Releases，实际是自研 /api/app-version/desktop + 云端存储——文档要改口径（跨切面 A2），不是代码要改。

### 2.3 React web 栈

**当前用法**：React 18.3 + Vite 5 + Tailwind 3 + zustand 4 + react-router 6 + @xyflow/react（工作流图）+ recharts。18 个页面，lib/ 下 api/auth/ws/events/token/historyCache 分层清晰。

**评估**：与规模匹配，无替换必要。注意点：
- 与 mobile 是**两套独立 UI 实现**（29 个 mobile 页面 vs 18 个 web 页面），shared 只提供类型不提供 UI——这是有意的（RN 与 DOM 差异太大），但要意识到 IM 功能每加一个（如 reactions、群公告）要双端各写一次，且已经出现双端调用未挂载路由的同步失败（groups/tokens/reactions 三端都在调）。
- React 18（web）vs React 19（mobile RN 0.86）版本不一致，暂时无害（不共享组件），但 hooks 行为差异在将来任何共享代码尝试时会咬人。

### 2.4 Expo SDK57 + RN 0.86

**当前用法**：Expo 预构建路线（app.json 0.9.33 / versionCode 133），29 个页面，zustand 5 + react-navigation 7 + reanimated 4 + skia + expo-glass-effect（Liquid Glass）+ react-native-webrtc（视频通话）+ libsignal（E2EE）+ zeroconf（mDNS 发现）。

**评估**：
- Expo SDK57 选型正确，**Android 16 白屏根因（newArchEnabled）从未落到可跟踪状态**（修复只进了一个 stray worktree 拷贝，见跨切面 H-4）——这是流程债不是框架债，但代价是移动端至今不能发 Android 16 包。
- **theme.ts 缺 ms() 导出是当前的移动端白屏 P0**：theme.ts（271 行，实测）导出了 colors/spacing/radius/elevation/Proxy 兼容层等全部设计 token，但不存在 ms 符号；47 个文件 import 它（其中 25 个显式带 ms），24 处在模块顶层调用 ms({...})——metro 在模块求值期抛 "ms is not a function"，整树加载失败 = 白屏。这与 newArch 是**两个独立的白屏源**，且 ms 缺失更基础（任何设备都白，不只是 Android 16）。
- 依赖卫生：3 个未使用的 @capacitor 依赖（RN 项目零引用）；libsignal 的 metro polyfill 链（node:crypto 空模块 + 自研 MinimalWebCrypto 注入替换 @peculiar）是已知脆弱点。
- CI 零覆盖（四大端唯一）+ 版本号双源（app.json 0.9.33 vs package.json 0.9.11）+ 硬编码 IP（P0）——移动端是当前**工程护栏最薄弱**的端。

### 2.5 socket.io + ws 双通道

**当前用法**（实测三条链）：

```
[桌面端 UI / 云端 Web]
   └── 原生 WebSocket → server /ws（WsHub：token 校验，run 订阅 + 用户 IM + 通话信令 + HITL 确认）
[移动端 IM/遥控]
   └── socket.io-client → relay-server(8888) → 转发 → 桌面端 server 的 relay-client.ts(socket.io) → WsHub
[桌面端 mDNS 发现（LAN 模式）]
   └── bonjour-service 发布 _ensemble._tcp ↔ mobile react-native-zeroconf
```

**评估**：
- **双通道是有历史包袱的合理设计**：桌面端 /ws 用原生 ws（与 RN WebSocket 兼容、token 走 query、16ms 批量 flush/4MB 背压/HITL 全自研）；移动端走 relay 用 socket.io（relay 侧有设备注册/顶替/离线暂存 100 条/24h 过期）。socket.io 的重连+房间模型对 relay 这个"纯转发"场景确实是顺手的。
- **问题在双通道带来双协议面**：WsEnvelope（v1, runId, seq, event）与 relay 的 device-link 消息是两套格式，移动端 connection.ts（socket.io 链）与 wslink.ts（原生 WS 链）两个客户端并存，事件解析逻辑双写。跨切面审计已记录"relay 五份协议漂移"。
- **收敛方向**：cloud-first 是既定共识（不做局域网直连），那么 mDNS/LAN 链（server discovery/advertise + mobile zeroconf + wslink 的 LAN 模式）应标记 legacy（advertise 仍被 electron.ts 启动时调用，但无消费方）；长期看 relay 消息面应向 WsEnvelope 收敛（device-messages.ts 已是这个方向的产物，但还没收敛完），移动端最终只留一条 socket.io→relay 链。

---

## 3. 架构模式

### 3.1 Agent 编排（orchestration/engine）

```
Task ──createAndExecuteTask──▶ Run（queued→running→success/error/cancelled）
                                  │ 5 种 Mode（Strategy 模式，全部经引擎执行）
                                  │  Single / Workflow / Chat / Plan(plan-execute-reflect) / Adversarial
                                  ▼
                              executeJob()
                                  │ withAgentLock(agentId)：同 agent 串行（Promise 链锁），跨 agent 并行
                                  ▼
                              AdapterRegistry.get(agentId).startTask()
                                  │ AsyncIterator<AgentEvent>（流式事件）
                                  ▼
              store.appendRunEvent()（原子分配 seq：MAX+1 与 INSERT 同一同步块）
              hub.broadcast(runId, seq, agent.event)（先落库后广播）
              客户端断线 → afterSeq 补拉（设计如此；当前因回退失效，见后端审计 §1）
```

**模式评估**：
- **runs/jobs/tasks 三级模型 + 事件流落库 + seq 补拉**是正确的"可观测执行"架构（对齐了 im-gap-analysis 定下的 P0：message seq + 幂等键 + 状态字段 + 已送达回执——代码写对了，被坏合并打掉了）。
- **取消是 run 级粘性的**（cancelledRuns Set + 每 job AbortController + adapter.cancel() 杀子进程），**steering 是 run 级队列注入**（OpenClaw 式）——这两个设计干净。
- **HITL 工具确认**经 hub.requestConfirm()（confirmId → Promise + 5min 超时自动拒绝），WS 双向闭环。
- **耦合点（黄灯）**：
  1. engine.ts 里 getProviderRegistry()/getToolRegistry() 用 (this.registry as any).deps 强拆私有依赖——Mode 层不该伸手进 adapter 内部，应经引擎显式注入。
  2. broadcastChatMessage 里 R3 事件化只完成一半：有 events 总线走 emit，没有则直调 hub.broadcast 兜底——**传输层依赖没有真正退役**，engine 仍直接持有 WsHub。
  3. IM（用户-用户消息）寄生在 agent 编排的 Run/Job 模型里（conversation 1:1 绑定 run_id），语义上是两套系统（agent 执行 vs 人对人聊天）硬共用一张事件表——功能上能跑，但 chat_messages 的 run_id 外键曾被被迫重建（sqlite.ts:200 迁移注释自认）。若 IM 独立增长，这张表会先撑不住。

### 3.2 WS Hub fanout

WsHub（611 行，单类承担 5 种职责）：
- run 订阅 fanout：wsSubs（ws→runId 集）/ runSubs（runId→ws 集）双向索引；16ms 批量 flush + 同 run 共享序列化 + 4MB bufferedAmount 背压（**背压丢弃 chat.message 是 P1**：慢客户端丢消息且 seq 补拉已断，丢失是永久的）。
- 用户级 fanout：userSockets（userId→ws 集）支撑 IM 定向推送、设备多端在线（wsDevices + onDeviceStatus 回调写 devices 表并广播 device.status）、异地登录 kick 下线。
- WebRTC 信令：onCallSignal A→B 定向转发（runId 占位 "call"，注释自曝了对 run 缓存污染的认知）。
- HITL confirm 与事件等待者（waitForRun 事件驱动替代忙轮询——这个改得漂亮；checkWaiters 在 broadcast 时同步匹配，不依赖批量 flush 保证即时性）。

**评估**：fanout 模式本身（先落库分配 seq → 内存索引 fanout → 背压降级）是对的。问题是**单一职责被 5 种业务挤爆**：run 事件、用户 IM、设备状态、通话信令、HITL 全在一个类里，靠可选回调字段注入（onDeviceStatus/onCallSignal/getSettings）与外部解耦——依赖方向反了（传输层持 store 引用发离线推送：hub.ts 的 store?: {listDevices} 是结构化类型注入，勉强合格但语义上 hub 开始懂业务）。10k 连接规模下这个类应按域拆（run-hub / im-hub / signal-hub），当前规模（<100 连接）可以不动。

### 3.3 Push 通道

```
在线：WsHub.sendToUser → ws 帧
离线：hub.sendOfflinePush（仅当用户无任何在线 socket 时触发）
      → devices.push_token 分支：
         ntfy:<topic> → sendNtfyPush(HTTP POST <NTFY_SERVER_IP>/topic，无鉴权，正文入 body)
         其他        → sendExpoPush（EXPO_ACCESS_TOKEN 当前 compose 下进不了容器 → 抛错被吞）
      → ntfy 设备会**双发**（先 Expo 失败再 ntfy，P1）
移动端接收：前台 fetch 长轮询（notifications.ts），App 被杀即断
```

**评估**：ntfy 选型对"自用/小团队、不想养 FCM/个推审核"是正确的务实选择（设计文档 docs/自建推送方案-ntfy.md），但**实现与文档的安全承诺四连反**（topic 可枚举、无 token 鉴权、正文入推送、无后台通道，P0）。架构层面还差一块：push 决策逻辑散在 hub（触发条件 + 内容提取）和 push.ts（发送）两处，"哪类 event 值得推、标题怎么取"写死在 hub 里——应抽成独立的 push-policy 模块，否则加 UnifiedPush/APNs 时还得动 hub。

### 3.4 E2EE 集成点

- **服务端**：e2e.ts 路由（78 行）只做**密钥目录**——PUT /register 存身份密钥包（identityKey/signedPreKey/OPK≤500，含 base64 与 keyId 校验），GET /bundle/:userId 取走即删（OPK 一次性）。服务器无感转发密文信封，私钥永不离网络——**架构上正确**（标准 Signal 服务端模型）。但路由未挂载 + upsertE2eIdentity/getE2eBundle 依赖的表不存在（回退产物）= 整条链当前不可用。
- **移动端**：services/e2e/（e2eService.ts + store.ts + minimalCrypto.ts）用 libsignal-protocol-typescript 实现 X3DH + Double Ratchet，私钥存 SecureStore/Keychain；自研 MinimalWebCrypto 替换 @peculiar（RN Hermes 无 WebCrypto，且 peculiar 的 node:crypto 依赖经 metro 空模块会在加载期抛错白屏）。对外仅 ensureEnrolled/encryptFor/decryptFrom 三方法，解密失败给占位文案不抛错。
- **桌面端**：web/src/lib/e2e.ts 走同一目录路由。
- **耦合点**：信封格式 {"e2e":1,"v":1,"ct":{...}} 复用 chat 消息通道、服务器不感知——这是对的（避免给 server 加解密职责）；代价是**加密消息的投递回执/补拉语义与明文不一致**（密文拉不到时无法区分"没发"和"解不开"）。

### 3.5 Relay 设备互联层

relay-server/src/index.ts 单文件：Express + socket.io + 内存 connectedDevices/offlineMessages（每设备 100 条上限、24h 过期）/socketToDevice 映射；同 deviceId 重连顶替旧连接（防串扰）；RELAY_AUTH_KEY 共享密钥鉴权（timingSafeEqual；未配置则警告放行）；内存速率限制（15min/100）。

**评估**："云端只做传输媒介、不持久化业务数据"的定位清晰且正确。架构局限即扩展性上限（§5.3）。**单点是当前部署形态的既定事实**，真正的风险是**离线队列在内存**：relay 重启 = 24h 内未达消息全丢，且桌面端 relay-client 重连后没有"补拉 relay 队列"的协议（relay 本就不持久化）——这个 trade-off 应当写进文档成为明示假设，而不是留给事故发现。

### 3.6 模块边界与依赖方向总图

```
                    ┌────────────────────────── desktop/ ──────────────────────────┐
                    │  web(React UI) ──HTTP/WS──▶ server ◀──Electron main 进程内──  │
                    │                        │                                     │
                    │  server 内部：          ▼                                     │
                    │  app.ts ──▶ context.ts(AppContext 组装 17 个服务)             │
                    │      │            ├── ConfigManager(yaml/json 文件=SoT)      │
                    │      │            ├── Store(51 方法，SQLite)                 │
                    │      │            ├── UserStore / WsHub                      │
                    │      │            ├── OrchestrationEngine ─▶ Adapters ─▶ LLM │
                    │      │            │        │                                 │
                    │      │            │        └── tools/memory/mcp/skills 注册表 │
                    │      └── api/routes(30 文件，9 个未挂载) + api/ws + relay-client
                    └──────────────────────────────────────────────────────────────┘
                          ▲ HTTP/WS              ▲ socket.io(relay-client)
                          │                      │
  mobile(Expo) ──socket.io──▶ relay-server(内存转发+离线暂存) ◀── 桌面端
```

**依赖方向总体健康**（UI→API→context→engine/store→db，无反向 import；hub 对 store 是类型注入不是 import 循环）。**三个边界模糊点**：
1. context.ts 的 AppContext 是 17 字段的上帝对象——所有路由都拿整个 ctx，路由间隔离只靠约定（无 DI 容器、无 per-router 依赖裁剪）。当前可控，但 ctx.storage 缺失导致 upload 500 的事故（后端审计 §2）正是这种"字段靠人记得加"的代价。
2. engine 与 hub 的 R3 解耦停在半程（events 总线存在但 hub 直调未退役）。
3. IM 语义寄生在 agent-run 模型上（§3.1）。

---

## 4. 技术债地图

图例：🟢 稳固地基 / 🟡 脚手架未填充 / 🔴 回退产物（f4e02cd）或当前事故 / ⚫ 死代码 / 🟠 漂移/护栏风险

### 4.1 技术债矩阵

| 模块 | 文件/范围 | 级别 | 状态 | 说明 |
|---|---|---|---|---|
| **store.ts** | orchestration/store.ts（619 行，51 方法，实测） | 🔴 | 回退产物 | chat 消息段退回 pre-v0.8.3：无 seq/幂等/已送达/reaction/群成员/组织/e2e 方法（createChatMessage 返回 void、无 markDelivered/batchGetReactions 等）。tsc 52 错的主要来源。修复路径已被审计验证：git checkout fba820c c021aaa 1971e11 5a4130f 对应文件 |
| **sqlite.ts** | db/sqlite.ts（295 行） | 🔴 | 回退产物 | schema 缺 seq/status/edited_at/delivered_at 列 + 7 张活表。迁移机制本身（PRAGMA 探测+ALTER）是 🟢 可保留的，缺的是 user_version 台账 |
| **WS seq 链** | hub.ts / protocol.ts | 🔴 | 回退产物 | chat.message 线上 seq 恒 0/undefined，afterSeq 补拉死链（三参被丢） |
| **9 个未挂载路由** | groups/tokens/reactions/assistant/org/user-plugins/pairs/e2e（+groups.ts 里 userSearch） | 🟡 | 脚手架未填充 | 路由文件已写（含校验）、客户端已在调（mobile/web 多处 404）；挂载后仍会撞 🔴 缺方法。e2e/pairs 另有"表不存在"问题 |
| **storage 层** | storage/index.ts（LocalStorageAdapter） | 🟡 | 脚手架未填充 | 从未实例化，AppContext 无 storage 字段 → upload 路由 100% 500 |
| **plugins 内核** | plugins/kernel.ts(311) + per-user.ts + routers.ts + user-kv.ts + builtin/ | 🟡 | 脚手架未填充 | 四挂载面（工具/路由/消息管线/定时）框架在；user-plugins 路由未挂载、user_plugins/plugin_kv 表不存在。R3/R4 分期计划中 |
| **org 权限** | org.ts + 依赖的 org 表/方法 | 🟡 | 脚手架未填充 | O1-O3 设计（Zulip 五级角色+部门树+Guest）已定；路由未挂载、方法被回退；r.patch("/../../users/:id") 路径 hack 需顺带清理 |
| **memory 子系统** | memory/（8 文件）+ mem0 后端 | 🟢 | 稳固 | 双池（explicit/implicit）+ SQLite FTS5 后端 + Mem0 可切换。但 memory.ts 路由 fail 未 import（P1 笔误） |
| **llm 子系统** | llm/（anthropic/openai/registry/retry/sse） | 🟢 | 稳固 | provider 注册表 + retry（有测试） |
| **engine/模式** | orchestration/（single/workflow/chat/plan/adversarial，共 ~1600 行） | 🟢 | 稳固 | 策略模式 + 串行锁 + 粘性取消 + steering，engine.test 在。黄灯：as-any 拆 deps、IM 寄生 |
| **WsHub** | api/ws/hub.ts（611 行） | 🟢+🟠 | 地基稳，债在身 | 批量/背压/事件等待者/踢下线都在；债：背压丢 chat.message、离线推送双发、无死连接回收（无 isAlive 驱逐）、imWs 配置 attach 时冻结、五职责一类 |
| **auth** | api/auth.ts(149) + db/users.ts(118) | 🟢 | 稳固 | 三凭证 + timingSafeEqual + 对外绑定强制 API key（index.ts 的启动拒绝逻辑是好的安全设计） |
| **ntfy push** | push/push.ts(95) + hub.sendOfflinePush | 🔴 | 安全债 P0 | 可枚举 topic + 无鉴权 + 正文入推送 + 无后台通道；Expo 双发；EXPO_ACCESS_TOKEN 进不了容器 |
| **mobile theme** | theme.ts 缺 ms() | 🔴 | 当前白屏 P0 | 271 行实测无 ms 符号；47 文件 import、25 文件用、24 处模块顶层调用。独立于 newArch 的第二个白屏源 |
| **mobile newArch** | Android 16 白屏修复 | 🔴 | 未落地 | newArchEnabled 修复只进了 stray worktree 拷贝（.claude/worktrees/... 被提交进主仓库，H-4），可跟踪载体缺失 |
| **mobile e2e** | services/e2e/ + minimalCrypto | 🟢 | 稳固（但链路断） | 客户端实现完整；服务端路由未挂载 + 表缺失 → 整链不可用 |
| **relay-server** | src/index.ts 单文件 | 🟢 | 稳固 | 定位清晰、9 测试在、timingSafeEqual 鉴权；债：无 CI 回归、离线队列纯内存、端口文档 3001/8888 打架、Dockerfile healthcheck 用 curl（slim 镜像无 curl） |
| **discovery/mDNS** | server discovery/(5 文件) + mobile zeroconf + wslink LAN 模式 | ⚫ | 死代码候选 | cloud-first 共识下 LAN 直连不做；advertise 仍被 electron.ts 启动时调用（发布 _ensemble._tcp，无消费方）。建议标记 legacy，保留一个版本周期后删 |
| **ensemble-cloud/local/packages** | 24 份源码拷贝 | ⚫+ | 死代码+漂移 | 无任何构建消费；hub.ts 已落后 62 行、push.ts 20 行；文档"软链接"描述为假；且原样复制了坏合并产物，扩大 P0 修复波及面。删除 packages/ 只留 start.bat |
| **根 shared/** | @ensemble/shared-protocol | ⚫ | 死包 | 构建期零消费；ChatMessage 形状与活包分叉（静默契约陷阱）；PROTOCOL.md 有保留价值 |
| **shared dist 产物** | desktop/packages/shared/src/ 下混 .d.ts/.js/.js.map | 🟠 | 卫生 | 编译产物入 git，应 .gitignore 移出；同包还有 npm package-lock.json（pnpm workspace 杂物） |
| **CI** | ci.yml 4 job | 🟠 | 护栏缺口 | server tsc 52 错能绿的直接原因（部署镜像不在 CI 构建）；mobile/relay 零覆盖；Electron 壳 build 不在 CI |
| **CORS** | app.ts:83-96 | 🟠 | 安全债 | origin.startsWith('http://') 放行任意 http origin（P1） |
| **文档** | README×3 / CHANGELOG×2 / DEPLOY / ntfy 方案 | 🟠 | 系统性失真 | 47 项跨切面发现的大半是"文档说 X 代码是 Y"。TECHNICAL/DEPLOYMENT 架构图与真实部署链（nginx 不代理 server、自研更新非 electron-updater）相反 |

### 4.2 一句话分类

- **稳固地基（别动）**：engine 五模式、llm 注册表、memory 双池、auth 三凭证、WsHub 的事件等待者/批量/背压骨架、relay 的定位、mobile 的 metro 别名吃 shared 源码、Electron 内嵌 server 的壳设计。
- **脚手架未填充（按计划填）**：plugins 四挂载面、org O1-O3、storage 接线、9 个路由挂载——"已设计未通电"，价值在，缺收尾。
- **回退产物（最高优先级恢复）**：store.ts/sqlite.ts 的 f4e02cd 回退 + 连带死掉的 seq/幂等/已送达链。**一次性可修复**（git checkout 对应 commit 文件，审计已给路径），修复后 5 个 P0 全部解除、tsc 与 25 个红测试大概率转绿。
- **死代码（删）**：ensemble-*/packages（24 文件）、根 shared/ 的 TS 源码（留 PROTOCOL.md）、mDNS 链（标记后删）、mobile 的 3 个 @capacitor 依赖、.claude/worktrees stray 文件。

---

## 5. 扩展性瓶颈（100 / 1k / 10k 用户推演）

前提：当前部署 = 单容器 server（单 Node 进程 + 单 SQLite 文件）+ 单 relay 容器，无 Redis、无队列、无读副本。

### 5.1 单实例 SQLite

| 负载 | 表现 |
|---|---|
| **100 用户**（~50 在线） | 无感。WAL + synchronous=NORMAL 单进程写吞吐 10k+ TPS 富余；seq MAX+1 在 JS 单线程下正确 |
| **1k 用户**（~500 在线，群聊峰值） | 开始碰壁：(1) 每条用户-用户消息 = createChatMessage + updateConversationMeta + N×incrementUnread，**多写不包事务**，群广播一次 N+2 次独立写，WAL 写锁排队时间随群规模线性涨；(2) tokens/stats 全历史无界扫描、全局搜索 50 会话 × LIKE '%q%'（无 FTS 表）——O(历史) 查询随数据量永久变慢，先于并发问题出现；(3) participant_ids LIKE '%id%' JSON 成员扫描在会话数过千后每次 listConversations 全表扫。**此时不需要换库，需要的是：事务包裹 + conversation_members 连接表 + FTS5（memory 后端已会用 FTS5，chat 搜索没用上）+ 分页** |
| **10k 用户** | SQLite 单文件本身仍可能是够的（其官方上限远超此规模），但**当前代码不是**：无界内存查询 + 无分页列表 + N+1 hydrateJobEvents 会先把 Node 堆撑爆。10k 的真正门槛是 §5.2 的单进程 WS，不是 SQLite。迁移路线：先 Drizzle 化 + 索引/FTS 补全 → 若单文件 SQLite 仍瓶颈，再考虑 Postgres（差异集中在 PRAGMA 与 JSON 函数，迁移面可控） |

### 5.2 单进程 WS Hub

- 内存态无界清单：rateLimitStore、dedup Map（60s 窗口内随流量增长）、eventWaiters（每次 broadcast 线性扫 O(n)）、userSockets/runSubs/wsDevices（仅 close 时清理，**无死连接回收**——半开 socket 常驻直到 OS 超时；subscribe-without-unsubscribe 堆积 runSubs）。
- **100 用户**：无感。
- **1k 用户**（~500 长连接）：背压丢消息从理论变现实——移动端弱网是常态，4MB bufferedAmount 触发后 **chat.message 被静默丢弃且无补拉**（seq 链已断），用户看到"消息消失"。半开连接在 NAT 网关场景累积，userSockets 幽灵条目导致"离线却判定在线"→ 离线推送不触发。
- **10k 用户**：单进程上限。(1) waitForRun 的 chat 端点同步等待 + 每事件 appendRunEvent 同步 SQLite 写，事件循环延迟吃掉批量 flush 的 16ms 预算；(2) **seq 分配假设单进程**（后端审计 §6：两实例共享同一 SQLite 会算出相同 seq）——水平扩容前必须把 seq 改成 DB 侧 nextval 或 BEGIN IMMEDIATE；(3) kick 下线/设备在线状态都是单进程内存视图，多实例直接错乱。**10k 的正确形态不是"把 hub 拆多进程"，而是 IM 消息面独立成服务（hub + relay 合并成一个"消息网关"，SQLite 只留业务库）**——与 relay 现有"纯传输"定位是自然演进，不是重构。

### 5.3 Relay 单点

- 内存离线队列（每设备 100 条 / 24h）+ 无持久化 + 单实例：**relay 每次重启/发布 = 全量未达消息丢失**。当前发布频率（频繁 docker cp 更新）下这是常态性数据丢失，只是自用规模感知不到。
- 共享密钥鉴权（所有设备同一 RELAY_AUTH_KEY）：任何一台设备被攻破 = 全设备身份可冒充。1k 设备规模前应改 per-device token（server 侧已有用户 session 体系，relay 应校验 server 签发的短期 token 而非共享密钥）。
- **10k 用户**：与 server 同构问题，且 relay 连 tsc 回归都没有——它是五份协议拷贝里"最关键的对外对端"，却是最没有护栏的。

### 5.4 无队列/无缓存的后果汇总

| 缺失层 | 100 用户 | 1k 用户 | 10k 用户 |
|---|---|---|---|
| 无消息队列（任务直接 void runAsync()） | 并发 agent run 共享事件循环，LLM 流式 token 突发拖慢 WS flush | 一个长 workflow（adversarial 多 agent 对抗）可占满单核，其余请求延迟飙升；**executeJob 的 agent 串行锁在进程内，无法跨实例扩** | 必须引入 run 队列 + 执行 worker 分离 |
| 无缓存层 | 无感 | config 有内存缓存（好），但 provider list 每次 map 拷贝、tokens/stats 全扫——热点读全打 SQLite | Redis 缓存热点读 + 设备在线状态外置（目前只在单进程 hub 内存里，天然无法跨实例） |
| 限流/去重无外置 | 内存限流单进程够用 | 多实例时限流失效（每实例独立计数 = 实际限额 ×N） | 限流/去重/session 全部需要 Redis |

**一句话**：这个架构的"设计容量"约是 **1k 在线用户 / 单机**；10k 需要"IM 网关独立 + run 队列 + seq 外置"三件事，而不是换数据库或换框架。当前优先级应当全部押在修复 🔴 回退产物和补 CI 闸门上——地基没修好之前讨论扩容是空中楼阁。

---

## 6. 行动建议（按解锁价值排序，不修改代码）

1. **P0-1 恢复 f4e02cd 回退**（audit-backend 修复顺序 1）：checkout fba820c/c021aaa/1971e11/5a4130f 的 store.ts+sqlite.ts，tsc 转绿，5 个 P0 解除。这是所有后续工作的闸门。
2. **P0-2 CI 加两道闸**：docker job 构建 desktop/Dockerfile（并跑 tsc --noEmit）；mobile/relay 的 typecheck+test 进 CI。成本半天，消灭"CI 绿 ≠ 能部署"的结构性盲区。
3. **P0-3 移动端白屏双源**：theme.ts 补 ms() 导出（1 个函数）；newArchEnabled 找正确载体（app.json gradleProperties 插件或 prebuild 后检查）落地到可跟踪文件。
4. **P1 删死代码**：ensemble-*/packages（24 文件）、根 shared/ 源码、stray worktree 文件、@capacitor×3。每次合并前"单一事实源"检查能少一份。
5. **P1 挂载 9 路由 + 接线 storage + 修路径漂移**（assistant /chat vs /ask、memory vs memory-pool/explicit），移动端 Phase 2-3 的 404 页面（群管理/Token 用量/reactions）随之复活。
6. **P1 ntfy 安全整改**：NTFY_TOKEN + 随机 topic + 推送正文脱敏（或文档明示"仅限可信网络"）。
7. **P2 数据层加固**：迁移台账（user_version）+ 7 张缺表 + 事务包裹 + conversation_members + FTS5 搜索 + 分页 + conversations.run_id 索引。
8. **P2 收敛传输面**：标记 mDNS/LAN 为 legacy；relay 协议向 WsEnvelope 靠拢；移动端双连接客户端（connection.ts/wslink.ts）二选一。
9. **P3 文档重建**：以本分析 + 两份审计为准重写 TECHNICAL.md/DEPLOYMENT.md 的架构与部署链章节，版本号单一源化。

---

*附：本分析中所有"实测"均来自 HEAD 400b6ed 的源码直读（app.ts / hub.ts / engine.ts / store.ts / sqlite.ts / context.ts / appContext.ts / index.ts / electron.ts / relay.ts / relay-client / relay-server/index.ts / metro.config.js / app.json / theme.ts / e2e.ts / e2eService.ts / ci.yml / Dockerfile / docker-compose.yml / 各 package.json）。与两份审计底稿冲突处以源码实测为准（未发现实质冲突；device-messages.ts 三份拷贝当前 md5 一致，漂移为速度问题而非状态问题）。*
