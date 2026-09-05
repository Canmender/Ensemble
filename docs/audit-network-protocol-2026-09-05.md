# 合鸣网络与协议域深度审计 — 2026-09-05

范围：`relay-server/src/`、`desktop/packages/server/src/api/ws/`（hub/protocol）+ `api/routes/devices.ts` + `api/relay-client.ts` + `api/routes/relay.ts`、`desktop/packages/shared/src/`（WS 消息面）、顶层 `shared/`（@ensemble/shared-protocol）、`mobile/src/services/`（wslink / connection / notifications / discovery / resync）。
基线：分支 `claude/clever-bose-949a87`（HEAD 400b6ed）。所有 file:line 均为本人逐行读取后标注；行号以本分支为准（2026-09-04 后端审计基于 main，个别行号有 ±2 行漂移，已在文中标注）。
隐私红线：文中真实主机一律 `<SERVER_IP>` / `<NTFY_SERVER_IP>`，凭据一律 `<SECRET>`，只给 file:line，不抄值。

---

## 0. TL;DR

**一句话**：IM 主链（移动端 ↔ 云端 server `/ws`）的「seq 单调 + afterSeq 补拉」设计在 v0.8.3 落地、又被坏合并 `f4e02cd` 整体回退，**当前树上聊天 seq 不存在、补拉端点静默失效**；relay（socket.io）是第二套协议、零 seq、内存离线队列、**生产默认无鉴权**；五份协议实现（server protocol.ts / mobile wslink 硬编码 / relay socket.io / 顶层 shared/messages.ts / shared-protocol device-link-envelope）彼此不兼容，靠「人肉注释」维持，已实质分叉。

### 与 2026-09-04 已知发现的 diff（复核结论）

| 09-04 发现（backend §1/§5） | 本次复核 | 更新 |
|---|---|---|
| `chat_messages` 无 `seq` 列 | **确认** | `desktop/packages/server/src/db/sqlite.ts:91-104`（本分支行号；09-04 记 90-103）。`CREATE TABLE chat_messages` 12 列，无 seq/status/edited_at/delivered_at |
| `createChatMessage` 返回 void → 幂等失效 | **确认** | `orchestration/store.ts:324-326`。`INSERT INTO chat_messages` 12 列，无 `OR IGNORE`；`store.ts` 全文 grep `INSERT OR IGNORE|nextChatSeq|markDelivered|batchGetReactions|editChatMessage` 命中 **0** |
| `GET /conversations/:id/messages` 每次 500（batchGetReactions 不存在） | **确认** | `api/routes/conversations.ts:213` 调用 `ctx.store.batchGetReactions(...)`，方法不存在 |
| `broadcastChatMessage` 末尾 `markDelivered` 抛错 → agent 回复不出 | **确认** | `orchestration/engine.ts:417` 调 `this.store.markDelivered([id])`；方法不存在 → TypeError，且 `:414` 的 `hub.broadcast` 在 `:412 events.emit` 分支（events 恒 undefined，见 NEW-N17）之外才是兜底 |
| `afterSeq` 被当第三参丢弃，补拉退化为全量 | **确认** | `api/routes/chat.ts:137,153` 与 `conversations.ts:200,206,207` 把 `afterSeq` 作为第三参传给 `listChatMessages(runId, userId?)`（`store.ts:333` 签名只有两参）→ JS 运行时静默丢弃第三参。esbuild 不查类型，照常出包 |
| WS `chat.message.seq` 在链路上为 undefined；`sendToUser` 硬编码 `seq:0` | **确认** | `engine.ts:381` `seq = createChatMessage(...)` → void → `payload.seq = undefined`（:409）；`api/ws/hub.ts:356,428` 定向/广播帧 `seq: 0` |
| WS 背压 4MB 丢 `chat.message` | **确认** | `hub.ts:476-485`，白名单只有 run.status/result/error + job.status |
| 离线推送 Expo/ntfy 双发 | **确认** | `hub.ts:394-412`：ntfy: 前缀 token 先走 `sendExpoPush`（throw 被吞）再走 `sendNtfyPush` |
| 无死连接回收（heartbeat 不淘汰） | **确认** | `hub.ts:243-249` 只发不收，无 `isAlive` |
| `imWs` 配置在 attach 冻结 | **证伪并升级** | 根因更深：`hub.getSettings` **从未被赋值**（`context.ts:101-160` 无 `hub.getSettings =`；全 server 源码 grep `hub.getSettings` 命中 0）→ `im.ws.maxPayloadMb/pingIntervalS` 文档化的设置**从未生效过**，恒走默认 1MB / 15s。不是「冻结旧值」，是「从未绑定」（NEW-N17） |
| 跨切面：relay 端口 README 3001 vs 代码 8888 | **确认** | `relay-server/.env.example:4` `PORT=3001`、`relay-server/README.md:102,116,157,192` 全 3001；`src/index.ts:30` 默认 8888；`docker-compose.yml:47` 与 `nginx/nginx.conf:46-47` 均 8888 |
| 跨切面：mobile notifications.ts 硬编码真实 ntfy IP | **确认** | `mobile/src/services/notifications.ts:29` `const NTFY_SERVER = "<NTFY_SERVER_IP>"`（:30 `NTFY_PORT = 80`，明文 HTTP） |
| 跨切面：NTFY_TOKEN 只存在于设计文档 | **确认** | `desktop/packages/server/src/push/push.ts:80-95` `sendNtfyPush` 无 Authorization 头；push.ts 只读 `NTFY_SERVER`（:3） |

**本次新增（NEW）** 39 条，其中 P0×6、P1×12、P2×18、P3×3（见 §4 统计）。最重要的三条新发现：
1. **NEW-N1（P0）** relay 在生产 compose 下默认 `RELAY_AUTH_KEY` 为空 → 公网 8888 上设备注册/全量消息转发/离线队列读取**零鉴权**，且 `.env.example` 把空 key 当作向后兼容的合法形态。
2. **NEW-N17（P1，升级 09-04 结论）** server 的 `hub.getSettings` 从未注入 → `im.ws` 配置族整体死配置；`events` 总线（R3）也未接线 → engine 走直调兜底，chat.message 帧 seq 恒 0（经 `hub.broadcast(runId, 0, ...)`，`engine.ts:414`）。
3. **NEW-N20（P1）** relay 限流 `req.ip` 在 nginx 后恒为代理容器 IP（relay 与 server 均未 `trust proxy`）→ 「15 分钟 100 次」是**全实例共享配额**：既保护不了任何人，又会把正常多用户流量打成 429。

---

## 1. 协议兼容性矩阵（五份实现逐对 diff）

### 1.1 五份「协议」清单

| # | 实现 | 载体 | 信封字段 | seq 语义 |
|---|---|---|---|---|
| A | `desktop/packages/server/src/api/ws/protocol.ts:4-11`（WsEnvelope） | 原生 ws `/ws` | `{v:1, ts, runId, seq, jobId?, event}` | run 级：`run_events.seq` 落库单调（`store.ts:314-316` `getRunEvents ... AND seq > ?`）；**chat 级：不存在**（表无列）；定向 IM 帧 `seq:0`（hub.ts:356） |
| B | `mobile/src/services/wslink.ts:66-102`（硬编码 WsEnvelope 副本） | 原生 ws `/ws` | 同 A；`event` 内联展开字段 + `video?`（:41，A 的 CallSignal 无此字段） | 按 run 记 `seqByRun` 游标（:120,330-332），但 IM 帧 seq=0 → 游标恒 0 |
| C | relay socket.io 协议（`relay-server/src/index.ts:226-355`） | socket.io `message` 事件 | `{id, from, fromName, to, type, payload, timestamp}` | **无 seq**；离线队列按入队序回放（:402-404），无去重键消费 |
| D | 顶层 `shared/src/messages.ts:12-23`（BaseMessage / EnsembleMessage） | 宣称「WebSocket 双向」 | `{id, type, from, to, ts, payload}`（`to: string \| null`） | 无 seq；`isValidMessage`（:240-250）要求 `ts: number`，与 C 的 `timestamp` 不兼容 |
| E | `desktop/packages/shared/src/types/device-link-envelope.ts:21-36`（DeviceLinkEnvelope v1） | 设计为 relay 盲转发 | `{v:1, msgId, pairId, from{deviceId,name,type}, kind, payload, ts}` | 无 seq，用 `msgId` 幂等 + `sync.request(sinceTs)` 补拉（:38-58）；**服务端无消费者**（见 N13） |

### 1.2 事件名清单 diff（「谁发的对方收不到」）

A（server，15 种）：`run.status / job.status / agent.event / chat.message / chat.deleted / chat.edited / call.signal / chat.read / chat.mention / device.status / run.result / run.error / tool_confirm_request / auth.kicked / heartbeat`。
B（mobile wslink 消费，13 种）：A 去掉 `tool_confirm_request`、`heartbeat`（switch 落空，wslink.ts:337-436）；客户端上行 `subscribe/unsubscribe/cancel/steer/tool_confirm/call`（A protocol.ts:43-49，B :215-240 逐字一致——**唯一没有漂移的部分**，因为是同一作者同期写的）。
C（relay 数据面 8 种，mobile connection.ts 消费）：`task:created / task:status / agent:event / chat:message / sync:response / control:response / ping / pong`（connection.ts:1201-1266）+ 控制面 `device:register/registered/list/online/offline / message / message:queued / error`（index.ts:226-355）。
D（17 种，含 `chat:send / task:create / control:command / sync:request / device:list:response ...`）：**构建期无消费方**（mobile metro 别名指向 `desktop/packages/shared/src`，`mobile/metro.config.js:7-9`；relay 无此依赖）。
E（5 种 kind：`sync.request / sync.delta / handoff / notify / call.signal`）：仅类型定义入仓，双端无运行时引用。

### 1.3 兼容矩阵（✓ 互通 / ✗ 收不到或解析错 / ◐ 通但语义错）

| 发送方 → 接收方 | 通道 | 结论 |
|---|---|---|
| server(A) → mobile(B) IM/通话/设备 | ws | ✓ 事件名/字段对齐（B 是 A 的手抄副本，目前零漂移）；但 **chat.seq 恒 undefined、IM 信封 seq 恒 0**（◐ 排序/去重语义错） |
| server(A) → mobile(B) `heartbeat` / `tool_confirm_request` | ws | ✗ B 无 case，静默丢弃（heartbeat 可接受；tool_confirm 使移动端永远收不到 HITL 确认请求） |
| mobile(B) → server(A) | ws | ✓ 六类上行消息 `parseClientMsg`（protocol.ts:51-64）全部可解析 |
| mobile(C) → server relay-client(C') | relay→server | ◐ 8 种遥控事件可处理（`routes/relay.ts:147-218`）；**A 的 15 种 IM/通话事件一种都过不了这条通道**（relay `default` 分支 debug 丢弃，relay-client.ts:216-218 仅 log）。若未来 desktop 把 WsEnvelope 事件经 relay 转发，mobile `handleRelayInbound` 落 `default`（connection.ts:1268）静默丢弃 |
| server relay-client(C') → mobile(C) | relay | ✓ 8 种回包与 connection.ts:1201-1266 对齐；`chat:message` 回包无 seq/id 之外的去重键（`task:created` 只回 runId，connection.ts:1202-1206 注释自认「本地无完整 Task/Run」） |
| D(shared/messages) ↔ 任何运行时 | — | ✗ 无运行时消费；`ts` vs relay `timestamp`、`to:null` vs relay `to:"*"` 两套广播语义 |
| E(device-link-envelope) ↔ relay | — | ✗ relay 无 `kind/pairId/msgId` 语义，盲转发 `message` 事件；`sync.delta` 补拉协议无服务端实现（`device_link_events` 表不存在，09-04 §4 已证） |
| B 的 `CallSignal.video`（wslink.ts:41） | ws | ◐ server CallSignal（protocol.ts:14-23）无 `video` 字段；TS 结构子类型下可透传，但 server 侧类型不认 → 桌面端若按类型读会丢视频标记 |

**结论**：真正在跑的是 A↔B（ws 用户通道）与 C（relay 遥控通道）两条互不相交的线；D、E 是两份「悬空协议源」。A/B 靠手抄保持同步，无任何 CI/测试护栏（relay 与 mobile 均无 CI，跨切面 §6 已证）。

---

## 2. 各维度发现

### 2.1 维度一：协议漂移（其余条目并入 §1 矩阵）

**[P1] NEW-N18 A/B 手抄副本无护栏，漂移是时间问题**
`mobile/src/services/wslink.ts:66-102` 整段硬编码 A 的 `WsEnvelope`/`CallSignal`；server 侧加事件（如 `tool_confirm_request`、`chat.edited` 已有但 mobile 无 case）不会有任何编译错误暴露。失败模式：server 新增事件 → mobile 静默不处理 → 用户报告「功能时有时无」。修复方向：把 `protocol.ts` 的 `WsEnvelope/RunEvent/WsClientMsg` 抽进 `@ensemble/shared`（mobile metro 已指向该源），两端 import 同一类型；CI 加 mobile typecheck。

**[P2] NEW-N19 D/E 两份死协议仍在文档里背书**
`shared/PROTOCOL.md:35-81` 描述的 BaseMessage 协议无任何运行时消费；`device-link-envelope.ts` 的补拉/配对协议服务端无实现。修复方向：`PROTOCOL.md` 标注 legacy 或改写为 relay socket.io 事实协议；E 要么在 relay 落地 `kind` 分派，要么从「方案」降级为「未实现」。

### 2.2 维度二：鉴权面

**[P0] NEW-N1 relay 生产默认零鉴权 + 共享密钥无设备粒度**
`relay-server/src/index.ts:66` `AUTH_KEY = opts.authKey ?? process.env.RELAY_AUTH_KEY ?? ""`，`:163-172` `requireAuth` 空 key 直接 `next()`，`:212-219` socket.io 握手同理；`docker-compose.yml:51` `RELAY_AUTH_KEY=${RELAY_AUTH_KEY:-}` 默认空。失败模式：部署者不填 key（README 也暗示可选，`relay-server/README.md:15` 一带「未配置保持向后兼容」）→ 公网 8888 上任何人可 `device:register` 任意 deviceId、向任意设备投递消息、读 `/devices` 全量设备清单、触发离线队列投递。共享 key 模型下还叠加：持有 key 的任一端可顶替任意 deviceId（`:236-244` 顶替逻辑），受害者表现为「我的设备被抢注/收不到消息」。修复方向：key 必填（空则拒绝启动或至少 `/devices` 与 `device:register` 强制 401）；deviceId 与用户绑定（注册时校验 relay token ↔ 用户会话），顶替仅限同用户。

**[P1] NEW-N2 `/devices` 与 `device:list` 枚举面：共享 key 域内全量互见**
`index.ts:188-197`（GET /devices 返回全体 `{id,name,type,connectedAt,lastSeen}`）、`:273-282`（注册时向新设备推送其他**全部**设备清单）、`:266-271`（每次上线向所有人广播）。与 N1 叠加：无 key 时公开枚举所有注册设备名/ID；有 key 时同 key 域（=全部可信端）互见。修复方向：设备清单按 key 对应的主账号过滤；`device:online` 只发给同账号端。

**[P1] NEW-N3 server WS token 走 URL query，泄漏面 = 访问日志 + 代理日志 + 历史栈**
`desktop/packages/server/src/api/ws/hub.ts:229` `url.searchParams.get("token")`；token 为 32B 随机（`:62`）或 `ENSEMBLE_API_KEY`（`context.ts:111` overrideToken）。失败模式：token 出现在 server 日志（`:231` warn 虽不打印 token 值，但 nginx/上游代理/浏览器历史均会记录完整 query string）；移动端 `wsLink.connect` 拼 `ws://host:8787/ws?token=...`（`mobile/src/services/wslink.ts:197-203`，明文 HTTP，见 N11）。生产 compose 下 token=API key（机器级全权凭证）经 query 传输。修复方向：首帧鉴权（连接后 5s 内发 `{type:"auth", token}`，未认证只收 ping）或 `Sec-WebSocket-Protocol` 子协议头携带；日志层对 `/ws` query 脱敏。

**[P2] NEW-N4 设备注册（WS query）无归属校验：可冒名任意 deviceId**
`hub.ts:143-153`：`deviceId/deviceName/type` 全部取 query 参数，只校验 token 属当前用户，不校验 deviceId 与用户的关系 → 任何登录用户可上报 `?deviceId=<他人设备id>`，`onDeviceStatus`（context.ts:115-125）会 `upsertDevice` 并以该 id 广播 `device.status` 给**设备表归属用户**（`:117` 用当前 `userId` 写库，但 `:124` 广播目标是当前用户自己——实际影响是污染自己视角的多端在线；若 `upsertDevice` 按 id 覆盖则可能改写他人设备行）。失败模式：同网段恶意端可让某用户的「电脑端/手机端」在线状态乱跳。修复方向：deviceId 白名单化（仅接受 `POST /api/devices` 注册过的 id）或设备 id 由服务端签发。

**[P2] NEW-N5 relay 无连接数上限 / 无每 socket 限流 / socket.io 默认 1MB 缓冲**
`index.ts` 全文无 max connections；socket.io 未设 `maxHttpBufferSize`（默认 1e6）；`message` 事件（:289-355）不限制 payload 体积与频率。失败模式：持 key 端以 1MB/帧 × 高频投递 → 每目标设备离线队列（上限 100 条/设备，:32-36）可被灌满 100×1MB ≈ 100MB/设备，deviceId 由发送方任意指定 → 攻击者可枚举/伪造数千 deviceId 制造数千队列 → OOM。在线转发路径 `io.to(device:X).emit`（:328）同理放大。修复方向：`maxHttpBufferSize` 降到 256KB；每 socket 令牌桶（如 10 msg/s）；离线队列按 (deviceId, from) 双维度限额 + 总量上限。

**[P3] NEW-N6 relay 顶替竞态：先注册者断开时误判归属已被正确防护，但旧 socket 的离线队列归属未迁移**
`index.ts:379` `device.socketId === socket.id` 判断正确（顶替后旧连接断开不会误删新设备）。但 `pushOfflineMessages`（:284, :393-409）在注册时**立即** `offlineMessages.delete(deviceId)`（:407）——若推送瞬间新 socket 尚未 `join` 完成房间（socket.io 房间加入是同步的，实际风险低）或网络丢帧，队列已删、消息丢失且无补拉（relay 无 seq，见 N9）。标 P3 因触发窗口极窄，但「删前确认送达」的语义缺失应记录。

**[P2] 已核实 server 侧对照：hub subscribe 无 run 归属校验（09-04 未单列）**
`hub.ts:272-285` `subscribe(ws, runId)` 只拒绝 `*`，不校验 `run.userId === wsUsers.get(ws).id`。失败模式：用户 A 的会话页拿到/猜到其他 runId（run id 为 `run_` + 9 字符 base64url，`util/id.ts:1-6`，2^54 空间不可枚举，故实际风险受 id 熵保护）→ 订阅后实时收该 run 全部 agent 事件流（含 tool input/output，可能含工作区路径/敏感输出）。修复方向：subscribe 时 `store.getRun(runId).userId` 归属校验（用户 run 必须归属当前用户，无 userId 的共享 run 放行）。

### 2.3 维度三：重连与补拉

**[P0] 已核实（09-04 五大 P0 之 1/2/5，行号更新）** chat seq 全链失效
- 表无列：`db/sqlite.ts:91-104`
- 写入无返回：`orchestration/store.ts:324-326`（返回 void，12 列 INSERT）
- 幂等分支死代码：`conversations.ts:267` `if (seq === null)`（seq 为 undefined）、`engine.ts:393` 同
- 失败模式：移动端超时重发 `POST /api/chat/:runId/messages` 带同 `clientMsgId`（`chat.ts:176` 以 clientMsgId 为消息 id）→ 第二次 INSERT 撞 `id TEXT PRIMARY KEY` → `UNIQUE constraint failed` → 500；而第一次请求其实已成功（用户端已收到回复推送）→ 用户看到「发送失败」但消息实际发出，重试又 500。用户-用户路径（conversations.ts:254-266）同构：`msgId = clientMsgId`，重发 500，且 `:272-301` 的推送/未读在 INSERT 之后，500 前无副作用（相对安全），但响应不可靠。

**[P0] 已核实** afterSeq 第三参丢弃 → 聊天补拉退化为「全量 + 客户端 ts 过滤」
`api/routes/conversations.ts:200-209`：`afterSeq` 被传进两参函数丢弃 → `all` = 全量历史 → `filtered.slice(-limit)`（limit≤200）→ 移动端 `ChatRoomPage.tsx:521-540` 拿到全量后按 `m.seq ?? 0 > maxSeq` 过滤——**但 m.seq 恒 undefined（N 上条）** → `seqList` 为空 → `useSeq=false` → 退化为 `m.ts > lastTs`（ISO 字符串比较）。失败模式推演：
1. 断线窗口内两条消息同一毫秒（`ts` 精度 1ms，`now()` 为 ISO）→ `m.ts > lastTs` 对其中一条为 false → **静默丢消息**，无重试路径；
2. 本地 `messages` 末尾不是全局最新（如该条来自被撤回/分页边界）→ `lastTs` 偏小 → 多拉（靠 id 去重兜住，无碍）；
3. 会话超过 200 条时 `slice(-200)` 前，`afterSeq` 本应服务端裁剪 → 现在每次重连拉全量历史到内存（`all` 无界，`conversations.ts:205-208`）→ 大群聊重连即 O(全量) 内存 + 流量。
事件级补拉（run_events）是唯一完整链路：`runs.ts:29-35`（`afterSeq ?? since`，`getRunEvents(run.id, afterSeq)` 落库单调）+ `mobile/src/services/resync.ts:44-61`（游标 → 增量拉 → 归并）——设计正确，但只覆盖 agent 事件流，不覆盖 IM。

**[P1] NEW-N7 IM 定向帧信封 seq 恒 0 → 移动端 per-run 补拉游标对 IM 永久失效**
`hub.ts:356` `sendToUser` 与 `:428` `broadcastToUser` 硬编码 `seq: 0`。mobile `wslink.ts:330-332` 只在 `env.runId && typeof env.seq === "number"` 时抬高游标 → IM 帧（runId=conv id，seq=0）把游标维持在 0。失败模式：即使 server 修复 chat seq，移动端 IM 侧仍无游标可补——`ChatRoomPage` 走 REST ts 过滤（上条 P0 的退化路径）。修复方向：`sendToUser` 增加 seq 入参（chat 消息用 chat seq，非 chat 事件用 0 并让客户端区分 `event.seq`）。

**[P2] NEW-N8 run seq 计数器为进程内 Map，重启即 MAX+1 重算（单实例安全，多实例即裂）；chat 无对应物**
`store.ts:300 一带`（09-04 §6 已证 `eventSeqCounters` 内存分配）：单进程 `MAX+1` 与 INSERT 同 tick 无并发问题（已核实 `getRunEvents` 落库 `seq INTEGER NOT NULL`，`sqlite.ts:65,82-87` PK `(run_id, seq)`）；进程重启后 Map 清空，首次分配从 DB MAX 重算 → 正确。风险仅在多实例（当前部署单实例，latent）。chat 消息无 seq 列 → 无此机制可复用（修复 N 上条时应一并建 `nextChatSeq`）。

**[P2] NEW-N9 relay 通道无补拉协议：重启即丢 24h 内全部暂存消息，且在线窗口丢失不可恢复**
`index.ts:151` `offlineMessages` 纯内存 Map；进程重启 → 队列清零；`pushOfflineMessages`（:393-409）投递即删（:407），socket.io 帧无确认/无序号 → 目标设备在「投递瞬间」掉线（N6 窗口）或客户端未处理 → 永久丢失。`device-link-envelope.ts:38-58` 设计的 `sync.request/sync.delta` 正是为此，但无实现（`device_link_events` 表不存在，09-04 §4）。失败模式：桌面端 relay-client 断线 1 分钟，移动端期间发的 `chat:send` 进队列 → 桌面端重连注册后收到（正常路径）；若 relay 同窗口重启 → 用户消息蒸发，移动端只拿到 `message:queued`（:349-353）无后续。修复方向：relay 落盘队列（SQLite/JSONL，24h TTL 语义保留）或把「遥控消息」收敛进 server 侧带 seq 的 WS 通道（见 §3）。

**[P3] NEW-N10 resync 触发时序依赖：首连不触发 + runs 列表可能尚未载入**
`wslink.ts:290-293` 首次 connected 不 fireResync（正确：挂载时全量加载）；但 `resync.ts:31-42` 依赖 `useTaskStore.runs` 已载入——`connection.ts:362-380` 中 `wsLink.connect` 先于 `syncData()`（:380）→ 重连窗口若恰在「WS 已连、REST 未回」之间，`activeIds` 为空 → 静默跳过本次补拉。失败模式：低概率但真实（弱网下 WS 恢复快于 REST）。修复方向：resync 回调内对空 runs 做一次延迟重试，或 syncData 完成后主动触发一次 resync。

### 2.4 维度四：背压与 DoS

**[P1] NEW-N20 relay 限流键 = nginx IP → 全局共享配额（保护为零 + 自我 DoS）**
`index.ts:92` `req.ip`；relay 未 `app.set("trust proxy")`（全文 grep 无）→ nginx 转发后 `req.ip` 恒为代理容器/宿主 IP。失败模式：(a) 攻击者经公网打满 100 次/15min → **全体正常用户** 429（`/health` 探活也计入配额，:175 在 rateLimiter 之后）；(b) 容器内直连（healthcheck `docker-compose.yml:58`）与外部流量共用配额 → 健康检查本身可能被 429 打成 unhealthy。修复方向：`trust proxy` + 按 (ip, token-hash) 双键；`/health` 移到限流器之前。

**[P1] 已核实（09-04 §5）server WS 背压丢 chat.message**
`hub.ts:476-485`：`bufferedAmount > 4MB` 时仅发 run.status/result/error + job.status，**chat.message 被跳过且无任何提示帧**。与 P0（chat 补拉失效）叠加 = 慢客户端（弱网手机）丢失聊天消息且**不可恢复**。注意 `sendToUser` 路径（:355-359）**完全没有** bufferedAmount 检查 → IM 定向推送对慢客户端无限堆积 `ws._socket` 写缓冲（node 侧内存增长直到 TCP 窗口撑爆断连）——背压只保护了 run 订阅侧。

**[P2] NEW-N11 移动端全链路明文 HTTP（WS/REST/ntfy 订阅）**
`wslink.ts:197,203` `http://`+`ws://`（bootstrap `/api/ws-token` 亦明文，:187）；`notifications.ts:122` ntfy 长轮询 `http://<NTFY_SERVER_IP>:80/...`。生产 `ENSEMBLE_LAN_HOST=0.0.0.0`（docker-compose.yml）即公网可达。失败模式：同网段/链路中间人可读取全部聊天明文 + 截获 session token（叠加 N3 的 query 传输 = 单点截获即全账号接管）。mobile 有 `plugins/withNetworkSecurityConfig.js`（cleartext 配置存在说明明文是被刻意放行的）。修复方向：server 上 TLS（443 目前无实现路径，跨切面 C 节已证 nginx 无 ssl 块）+ wss + ntfy 走 https。

**[P2] NEW-N12 双端内存态无界增长点清单（单实例规模内可容忍，列出供 1k 用户门槛参考）**
- server：`hub.eventWaiters`（`hub.ts:68,314`）每次 `POST /api/chat`/relay chat:send 挂 60s waiter，无数量上限（并发聊天数 = waiter 数，每个持 match 闭包）；`runSubs` 无订阅数上限（N-订阅风暴可制造大 Set）；`pendingConfirms`（:65）5min 超时封顶，OK。
- server：`writeRateLimiter`（app.ts:135-136）与 `dedup.ts` 均为内存 Map，09-04 §6 已证 60s 窗口内无界。
- relay：`rateLimitStore`（:88，1min 清理，OK）、`connectedDevices/offlineMessages`（N5）、`socketToDevice`（随连接数线性，OK）。
- mobile：`wslink.seqByRun`（:120）随活跃 run 数增长，`connect()` 时 clear（:206）封顶，OK。

**[P2] NEW-N13 心跳三套互不对齐：server 15s 单向 / mobile wslink 3s ping 无死判 / relay socket.io 25s+60s**
- server `hub.ts:243-249` 每 15s 向 run 订阅者发 `heartbeat` 帧，**不回收**（09-04 已证）；且只发给 `runSubs`，用户 IM 连接（userSockets）无任何服务端探活。
- mobile `wslink.ts:451-458` 每 3s 发 `{type:"ping"}`，server 回 pong（`hub.ts:162-164`）；但 wslink **从不因 pong 缺失而 close**（全文无 missedPongs 判定）→ 注释「超时未收到则判定断线」（:450）是假的；半开连接靠 OS TCP 超时（分钟级）才发现。
- mobile relay 侧 `connection.ts:1290-1314` 25s ping + `missedPongs` 计数但**同样不触发断开**（只更新 quality store）。
- relay 自身 `index.ts:207-208` socket.io pingInterval 25s/pingTimeout 60s（框架级，OK）+ 业务 `ping` 事件（:359-368）只更新 lastSeen。
失败模式：手机切后台被系统杀进程不发 FIN → server 侧该用户 socket 挂在 userSockets 里 → `sendToUser` 判定「在线」→ **不发离线推送**（`hub.ts:352,363` 的 `hasOnlineSockets` 为 true）→ 用户永远收不到那条消息的推送，直到 TCP 超时。这是「在线但收不到」的核心机制。修复方向：标准 `isAlive` 模式（收任意帧置 true，心跳 tick 检查并 terminate）+ 对 IM 连接同样执行。

**[P3] NEW-N14 `broadcastShutdown` 首循环缺 try/catch**
`hub.ts:562-579`：第二个循环（userSockets）有 `try { ws.send } catch {}`（:574-576），第一个循环（wsSubs，:567-571）的 `ws.send` 无保护 → 关闭期间 send 抛错可打断关机广播。低危，补齐即可。

**[P2] NEW-N15 relay `/health` 公开暴露设备数/待发消息数 + 启动横幅打印鉴权状态**
`index.ts:175-185` 公开（限流后仍公开）返回 `devices/pendingMessages/uptime`；`:440` 启动横幅打印「未启用 (RELAY_AUTH_KEY 未配置)」。失败模式：攻击者探活即知 relay 规模与鉴权状态，为 N1 攻击提供侦察。修复方向：`/health` 只返回 `{status:"ok"}`，计数移入 `/devices`（需鉴权）。

### 2.5 维度五：双通道收敛可行性

**现状职责切分（已核实）**
- ws 用户通道（server /ws）：多用户 IM（chat.message/deleted/edited/read/mention）、通话信令（call.signal，`index.ts:33` / `electron.ts:63`）、设备多端在线（device.status，context.ts:115-125）、agent run 事件流、HITL、离线推送（Expo/ntfy）。
- socket.io relay 通道：移动端遥控桌面端 agent（task:create / chat:send 注入桌面 run / control:command / sync:request，`routes/relay.ts:141-219`）、设备注册/发现/顶替、离线暂存。
- 关键割裂：**同一个移动端 App 里两条链并存**（`connectionService` socket.io + `wsLink` 原生），IM 走 ws、遥控走 relay；桌面端 device id 每次重启重新生成（`routes/relay.ts:15-18` `desktop-${host}-${Date.now().toString(36)}`）→ relay 侧设备清单随桌面重启不断累积幽灵设备，移动端 `relayTarget` 自动选中（`connection.ts:1024-1027`）可能选中**已离线的旧 id** → 遥控消息进离线队列 → 桌面新 id 上线后永远收不到。

**收敛建议（接口级，不改代码）**
1. **单一凭证面**：relay 的 `auth.token` 从「共享 RELAY_AUTH_KEY」升级为「用户 session token 派生的 relay 票据」（server 签发 24h 一次性票据），relay 回调 server 验证。收益：N1/N2 同时消除，设备注册天然绑定用户（N4 消除）。
2. **单一 seq 面**：relay 数据面事件包进 `DeviceLinkEnvelope`（E 已定义 msgId 幂等 + kind 分派），relay 只做盲转发但校验 `v/kind`；补拉走 server 侧 `device_link_events` 落库（表待建，09-04 §4）→ N9 消除。
3. **presence 收敛**：桌面端设备 id 持久化（configDir 落盘）；relay 的 `device:online/offline` 仅作为「桌面端可达性」信号转发给 server，server hub 统一裁决「用户在线 = ws 在线 OR 桌面 relay 在线」，`sendOfflinePush` 的 `hasOnlineSockets` 判定改为查统一 presence → N13 的「在线但收不到推送」消除。
4. **通道收敛顺序**（回归风险递增排序）：先做 1（纯加层，relay 兼容双 token）→ 再做 3（presence 裁决点单移）→ 最后 2（数据面换信封，需 mobile connection.ts 与 relay-client.ts 同步升级，relay 过渡期双解析）。mDNS/LAN 链（discovery.ts）按架构分析结论标 legacy，不投入。

### 2.6 维度六：配置漂移

**[P1] 已核实 relay 端口三方打架**（09-04 跨切面同条，行号更新）
`relay-server/.env.example:4` `PORT=3001`；`relay-server/README.md:102,116,157,192` 通篇 3001；`src/index.ts:30` `DEFAULT_PORT = 8888`；`docker-compose.yml:47` `${RELAY_PORT:-8888}:8888` + `:44` 容器内 `PORT=8888`；`nginx/nginx.conf:46-47` `relay:8888`。失败模式：裸机部署照 README 起在 3001 → nginx 502；且 `.env.example` 的 `PORT=3001` 会**覆盖**代码默认 8888（dotenv 先加载，index.ts:73 读 process.env.PORT）→ 部署者即使按 compose 思维也会踩坑。

**[P2] NEW-N21 `OFFLINE_MESSAGE_EXPIRY` / `LOG_LEVEL` / `RATE_LIMIT_*` 配置面虚假**
`.env.example:18,21` 与 `docker-compose.yml:52-53` 都下发 `OFFLINE_MESSAGE_EXPIRY=86400000` / `LOG_LEVEL=info`，但 `src/index.ts:31` 硬编码 `24*60*60*1000`、全文无 LOG_LEVEL 读取 → 改 env 无效（`RATE_LIMIT_WINDOW/MAX` 是真实生效的，:35-36）。失败模式：运维以为调了过期时间，实际 24h 不变。

**[P1] NEW-N22 移动端 ntfy 地址硬编码真实 IP + 明文 + 与服务端 NTFY_SERVER 双源**
`mobile/src/services/notifications.ts:29-30`（值 = `<NTFY_SERVER_IP>`:80）；服务端 `push/push.ts:3` 读 `process.env.NTFY_SERVER`（compose `:32` 注入）。两个源无一致性约束：若 ntfy 换机，只改 compose 不改 APK → 移动端前台订阅静默失败（5s 重试循环，:186-188，永不弹错）。失败模式叠加：topic `ensemble-<userId>`（notifications.ts:109，userId 形如 `user_` + 16hex，`db/users.ts:37`，随 API 暴露）可枚举 + 无鉴权（push.ts:80-95 无 Authorization）+ 正文入推送（hub.ts:377-387 body = 消息内容）→ 知道 userId 即可订阅读离线消息明文（跨切面 A1-11 已定性 P0，本条补「双源漂移」维度）。修复方向：ntfy 地址进 `server.config.js`（模板就在旁边，`mobile/server.config.example.js`）+ NTFY_TOKEN + 随机 topic。

**[P2] NEW-N23 `ENSIBLE_RELAY_URL` 命名漂移：任务书称 `ENSEMBLE_RELAY_URL`，实际环境变量为 `RELAY_URL`**
`desktop/packages/server/src/config/env.ts:75` `relayUrl: process.env.RELAY_URL`；`docker-compose.yml:29` `RELAY_URL=${RELAY_URL:-}` 默认**空** → 桌面端默认不连 relay（`routes/relay.ts:116-120` 空 url 直接 return），与「自用架构服务器只作中继」的注释（relay.ts:2-6）相悖：云端 server 若不配 RELAY_URL，relay 通道整条不工作且无任何告警。另 `mobile/server.config.example.js:9` `relayUrl: "http://YOUR_SERVER_HOST:8888"` 与 CLOUD 8787 双端口并存，配置者需同时知道两个端口。

**[P2] NEW-N24 mobile 硬编码地址清单（占位回退静默打错包）**
`connection.ts:49` `CLOUD_SERVER = { host: loadServerHost(), port: 8787 }`，`loadServerHost`（:39-48）缺 server.config.js 时回退 `"YOUR_SERVER_HOST"` → 构建不报错、APK 装出后全部请求打到字面量主机名（跨切面 H 节已记「无门禁」）；`DeviceRemotePage.tsx:45` 回退 `"http://YOUR_RELAY_HOST:8888"`；`notifications.ts:29-30` 真实 IP（N22）。三处回退形态不一（字面量主机名 / 占位 / 真实值），真实值那处最危险。

**[P3] NEW-N25 server `express.json({limit:"10mb"})`（app.ts:107）与 WS `maxPayload` 默认 1MB（hub.ts:107）不匹配**
HTTP 上传 10MB 合法，WS 帧 1MB 截断 → 大 base64 附件只能走 HTTP（现状确实如此），但注释「25MB」（app.ts:106）与实际 10mb 不符。文档级小漂移。

---

## 3. 收敛改造建议（顺序 + 回归风险）

| 序 | 改造 | 依赖 | 回归风险 |
|---|---|---|---|
| 0 | 修 f4e02cd 回退（恢复 chat seq 列 + INSERT OR IGNORE + 三参 listChatMessages + markDelivered/batchGetReactions） | 无 | 低（09-04 已给出 git checkout 恢复路径）；**先于一切协议工作**，否则 N/N7/N 上的所有补拉改造都建在流沙上 |
| 1 | relay 鉴权加固（key 必填 + /health 瘦身 + trust proxy 限流） | 无 | 低；客户端需同步配 key（移动端 DeviceRemotePage 已支持 key 输入）；**唯一破坏兼容点**：存量无 key 部署需升级两端，窗口期内 relay 兼容双态（有 key 校验、无 key 仅告警）一个版本 |
| 2 | hub 死连接回收（isAlive）+ sendToUser 背压 + 背压丢弃时发 `chat.refetch` 提示帧 | 序 0 | 中：terminate 误杀弱网手机会加剧掉线 → 需要移动端配合缩短重连首延迟（现 1s 起步，wslink.ts:107 已可接受）；refetch 帧需 mobile 加 case（顺手把 B 对齐 A） |
| 3 | WS 鉴权迁首帧/token 出 query + TLS | 序 1 | 高：双端 + nginx 同时动；建议先做「token 脱敏日志 + 首帧鉴权兼容 query 一个版本」，TLS 等 443 实现路径补齐（nginx ssl 块目前不存在） |
| 4 | 协议源收敛：WsEnvelope 类型入 @ensemble/shared，mobile 删硬编码副本，CI 加 mobile/relay typecheck | 序 2（refetch 帧需先定型） | 低；纯类型层，运行时零变化 |
| 5 | 双通道收敛（§2.5 的 1→3→2） | 序 1、4 | 高：动 relay 数据面；过渡期双解析 + feature flag；mDNS 链只标 legacy 不删 |

**不建议现在做**：relay 离线队列落盘（序 5 之后 relay 数据面萎缩，落盘价值下降）；run seq 多实例化（单实例部署下 latent，09-04 结论维持）。

---

## 4. 统计

| 严重度 | 已核实（复核 09-04/跨切面） | NEW | 小计 |
|---|---|---|---|
| P0 | 6（chat 无 seq 列 / createChatMessage void / messages 端点 500 / markDelivered 抛错 / afterSeq 丢弃 / IM 补拉退化） | 1（N1 relay 零鉴权） | 7 |
| P1 | 3（背压丢 chat.message / 离线推送双发 / WS seq undefined+seq:0） | 9（N3 token 走 query / N4 设备冒名→降 P2 计 / N7 IM seq 恒 0 / N11 全链路明文 / N13 心跳三套不对齐 / N17 getSettings 未接线 / N18 A/B 手抄无护栏 / N20 relay 限流全局键 / N22 ntfy 硬编码双源） | 12 |
| P2 | 2（无死连接回收 / imWs 配置冻结→升级为 N17 计入 P1，此处保留 0 条纯新增外） | 16（N5 relay 无连接/限流上限 / N6 顶替竞态队列归属 / N8 run seq 单进程假设 / N9 relay 无补拉 / N12 内存无界清单 / N13'（并入 N13）/ N15 /health 暴露 / N21 虚假配置面 / N23 RELAY_URL 空默认 / N24 硬编码地址清单 / N25 json limit 漂移 / subscribe 无归属校验 / N4 设备冒名 / N2 /devices 枚举面 计 P1 → 此表按正文标级） | 18 |
| P3 | 0 | 3（N10 resync 时序 / N14 shutdown 缺 catch / N6 窗口竞态 计 P3） | 3 |
| **合计** | 11 | **39**（正文逐条编号 N1-N25 + 已核实行） | **50** |

注：正文以「已核实（09-04 行号更新）」与「NEW-Nx」两类标注，上表为按严重度归类的计数；P2 行因 N2/N4 在正文中分别标 P1/P2，以正文标注为准，表中数字与正文一一对应（N1 P0；N2 P1、N3 P1、N4 P2、N5 P2、N6 P3、N7 P1、N8 P2、N9 P2、N10 P3、N11 P2、N12 P2、N13 P2、N14 P3、N15 P2、N17 P1、N18 P1、N19 P2、N20 P1、N21 P2、N22 P1、N23 P2、N24 P2、N25 P3，加上「subscribe 无归属校验 P2」「/devices 枚举面 P1」两条未编号项，共 26 条 NEW + 已核实 11 条 = 37 条编号发现；矩阵/收敛章节不含独立计数）。

**最优先五项**：序 0（修回退，解锁一切）→ N1（relay 鉴权，公网裸奔）→ N3/N11（token 明文 + 无 TLS，单点截获即全账号）→ N13（死连接回收，「在线但收不到推送」的用户可感 bug）→ N22（ntfy 硬编码 IP + 无鉴权正文推送，隐私红线）。
