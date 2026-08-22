# 高并发 IM 服务器架构调研

> 调研日期：2026-08-22 | 主题：高并发 / 高性能
> 关联项目现状：合鸣云端架构（服务器 + relay）、移动端/桌面端、v0.9.1 刚上线 1v1 WebRTC 视频通话
> 方法：网络检索工程实践文章与生产案例，交叉比对共识结论

## 结论速览

1. 长连接规模化的标准答案：**无状态网关层 + Redis 协调骨干**，单实例 5 万连接是舒适区，超百万上 Redis Cluster。
2. 消息可靠性不追求"真 exactly-once"，而是 **at-least-once + 客户端幂等去重**；顺序用**会话内单调序列号**，不用时间戳。
3. 离线同步靠 **设备级游标 + 重连增量拉取**；推送通知只是唤醒信号，不是传输通道。
4. WebRTC：Mesh 只够 ≤4~5 人；群聊通话需要 SFU（mediasoup 单节点可扛 500~800 路）。

## 一、长连接网关层

### 架构共识（多来源一致）

```
客户端 ──WS──▶ [LB] ──▶ Gateway Pod ×N（只挂连接，内存里仅存 userId/deviceId）
                          │
                     Redis（pub/sub 或 Streams + 在线状态 Hash：用户→Pod 映射）
                          │
                       业务 Hub 层（核心逻辑，独立扩缩容）
```

- Dyte 生产环境采用三层设计：Edge（连接）/ Broker（路由）/ Hub（逻辑），各层独立伸缩。
- 粘性会话（sticky session）中等规模可用，大规模下脆弱（节点故障带走所有绑定连接）；**外置共享状态**才是长期方案——任意节点都能接住重连的客户端。

### 实测数据锚点

| 指标 | 数值 | 来源 |
|---|---|---|
| uWebSockets.js vs ws 库 | 同内存连接数约 ×2，内存减半 | truongsoftware.com 实测 |
| 单 Pod 承载 | 5 万连接 ≈ 890MB 内存 / 31% CPU | 同上 |
| 每 socket 内存 | 约 1.3 KB（uWebSockets.js） | 同上 |
| Redis 单实例瓶颈 | >100 万连接时换 Redis Cluster | 同上 |

### 工程要点

- 需要**持久化/确认语义**时用 Redis Streams（`XADD`/`XREADGROUP`，自带消费者组与背压），fire-and-forget 用 pub/sub 即可。
- 消费循环加熔断器 + 指数退避。
- 发布期优雅排水：SIGTERM → 通知客户端重连 → 等待 → 退出。

## 二、消息投递可靠性与顺序

### 核心原则："durability before delivery"

先持久化（带分配好的序号）再 ACK 发送方——**在线推送只是延迟优化，不是系统真相**。发送方 3 秒没收到 ACK 就重发。

### "Exactly-once to the eye"

真正的 exactly-once 投递代价极高；工业界做法是：

- 服务端 at-least-once 投递；
- 每条消息带 `client_msg_id`（客户端生成 UUID），存储 UPSERT、接收端按服务端 ID 本地去重；
- 用户看到的效果等价 exactly-once。

### 顺序：时间戳不可用

服务器时钟漂移在负载下可达数十毫秒，NTP 也救不了。正确做法：**每会话单调递增的 server_seq**。全局排序（Snowflake 类全局发号器）通常没必要——跨会话本来就不需要全序，且引入争用点。

### 回执与离线同步

- 回执是**游标状态机**：sent → delivered → read，best-effort，不值得做重试。
- 离线同步协议（Stream 的四步）：① 按上次已提交的 sync token 增量拉取（新设备全量快照）；② 原子应用到本地库；③ 以幂等事务 ID 重放本地排队的写操作；④ 最后才打开实时 socket。
- 多设备同步键：`(user_id, device_id, conversation_id) → lastSeq` 游标，重连从 store 回放，无需服务端按设备建队列。
- **FCM/APNs 推送只是唤醒信号**——可能被丢弃、乱序、最长延迟 30 天，绝不能当传输通道。

### 与合鸣现状的对照（2026-08-22 代码审计核实）

> 以下每条都已对照真实代码验证，非推测。路径相对仓库根。

**已具备的能力（超出预期）：**

- ✅ **WS 事件层已有 per-run 单调 seq**：`WsEnvelope.seq`（`ensemble-cloud/packages/server/src/api/ws/protocol.ts:8`），事件先落 `run_events` 表分配 seq 再广播（`api/ws/hub.ts:11`），并有补拉端点 `GET /api/runs/:id/events?afterSeq=N` 返回 `lastSeq`（`api/routes/runs.ts:28-34`）——服务端补拉基础设施完整。
- ✅ 移动端有指数退避重连（`mobile/src/services/connection.ts:1261`）。

**确认缺失（调研建议逐条落实为改造项）：**

1. ❌ **IM 聊天历史没有 seq，靠时间戳排序**：`chat_messages` 表无 seq 列，`ts TEXT` + `ORDER BY ts`（`db/sqlite.ts:90-103`、`orchestration/store.ts:98`）。同毫秒消息顺序不稳定，正是调研警告的"时间戳不可作排序键"。WS 的 seq 只覆盖编排事件流，不覆盖聊天历史本身。
2. ❌ **去重是"2 秒内容窗口防重"而非幂等投递**：`api/routes/dedup.ts` 按 userId+convId+内容前缀在 2 秒窗口内拒绝重复——这是防手抖双击，防不了"3 秒超时重发"场景的重复入库。`chat_messages.id` 是 `TEXT PRIMARY KEY`，改成客户端供 id + `INSERT OR IGNORE` 即可零成本获得幂等。
3. ❌ **补拉参数名不匹配（bug）**：移动端 `getRunEvents` 发送 `since` 参数（`mobile/src/services/api.ts:472`），服务端读取的是 `afterSeq`（`api/routes/runs.ts:32`）——即使客户端调了补拉，服务端也忽略游标从 0 全量返回。
4. ❌ **重连后无补拉动作**：socket `connect` 事件里只做设备注册 + 心跳重启（`mobile/src/services/connection.ts:783` 附近），不调用事件补拉，也不做会话增量同步——"增量拉取→重放→再开 socket"标准次序尚未实现。

**修订后 P0：**

1. `chat_messages` 加会话内单调 `seq` 列（AUTOINCREMENT 或按 run 分配），历史接口与 WS 推送统一用它排序。
2. 客户端消息携带 `client_msg_id`（可直接复用现有 TEXT id），服务端 `INSERT OR IGNORE` 实现幂等入库；dedup.ts 的窗口防重可保留作第一道闸。
3. 修参数名：服务端兼容 `since`/`afterSeq`（一行改动），或移动端改发 `afterSeq`。
4. 重连成功后：按本地已存 lastSeq 调补拉端点 → 原子合并 → 重放排队写 → 恢复订阅。

## 三、WebRTC 规模化（视频通话的下一步）

### 三种拓扑的硬数据

| 拓扑 | 上限 | 延迟 | E2EE | 备注 |
|---|---|---|---|---|
| Mesh（P2P 全连） | ~4-5 人 | 最低 | 天然支持 | 每人上传 N−1 路流，上行带宽先崩 |
| MCU（服务端混流） | 高 | 200–400ms | ❌ 破坏 | 解码再编码，CPU 贵 |
| SFU（选择性转发） | 单节点 500–800 路 | 100–200ms | ✅ 兼容 | 生产标准；simulcast 配合自适应码率 |

关键事实：
- SFU 是「字节搬运工」：解传输层、看包头、按订阅者重新封包加密，**从不碰视频字节**，所以 CPU 便宜且能保 E2EE。
- Signal 团队实测：改造开源 SFU 很难稳定超过 **8 人**，最终自研 Rust SFU 轻松支撑 40+ 人加密群通话。
- LiveKit Cloud 的分布式方案：会话是跨机房逻辑对象，参会者就近接入 SFU（<100ms），SFU 之间自组织媒体中继网格（无中心协调器，容忍单机房故障）；直播场景退化为分层转发（2 万+观众）。

### 对合鸣的建议

当前 1v1 视频通话走 P2P Mesh 是正确选择，无需动。触发升级的条件：**群聊语音/视频会议 ≥5 人**成为需求时，引入 SFU——优先评估 mediasoup（Node.js 生态契合）或 LiveKit 自托管（Go/Pion，自带分布式），不要自研。

## 四、落地优先级（按性价比排序，已对照代码核实）

1. **P0-a（一行修复）**：补拉参数名不匹配——服务端 `runs.ts:32` 兼容 `since`/`afterSeq`，或移动端 `api.ts:472` 改发 `afterSeq`。
2. **P0-b**：`chat_messages` 加会话内单调 `seq` 列；客户端消息带 `client_msg_id` + 服务端 `INSERT OR IGNORE` 幂等入库（改动小，可靠性收益最大）。
3. **P0-c**：移动端重连成功后按本地 lastSeq 调补拉端点 → 原子合并 → 重放排队写 → 恢复订阅。
4. **P1**：在线状态 Redis Hash（用户→节点映射）为横向扩容铺路；凭据轮换待办（见 [[privacy-protection-convention]]）可与网关无状态化同批做。
5. **P2（规模化触发才做）**：relay-server 目前用 socket.io@4.7（自带重连/降级，当前规模够用）；连接数上千后压测评估迁移 uWebSockets.js（注意需放弃 socket.io 协议层，客户端同步改）。群聊通话 ≥5 人需求出现后再上 SFU。

## 参考来源

- [Scaling to 100k Concurrent WebSocket Connections with Node.js and Redis Streams](https://truongsoftware.com/blog/nodejs-realtime-websocket-scale/)
- [WebSockets at Scale: Architecture for Millions of Connections](https://websocket.org/guides/websockets-at-scale/)
- [Scaling WebSockets to Millions — Dyte](https://dyte.io/blog/scaling-websockets-to-millions/)
- [Chat Application Architecture — Stream](https://getstream.io/blog/chat-application-architecture/)
- [How to Sync Chat State After a User Goes Offline? — Stream](https://getstream.io/blog/sync-chat-state-offline/)
- [Chat / DM System Design Walkthrough](https://semicolony.dev/codex/system-design/playbook/chat/)
- [Chat App System Design — System Design School](https://systemdesignschool.io/problems/chatapp/solution)
- [Design Real-Time Chat and Messaging — Sujeet Jaiswal](https://sujeet.pro/articles/design-real-time-chat-messaging)
- [Signal: How to Build Large-Scale E2EE Group Video Calls](https://signal.org/blog/how-to-build-encrypted-group-calls/)
- [LiveKit SFU Internals](https://docs.livekit.io/reference/internals/livekit-sfu/)
- [LiveKit: Scaling WebRTC with Distributed Mesh](https://www.livekit.io/blog/scaling-webrtc-with-distributed-mesh)
- [Mesh vs SFU: When to Graduate](https://www.real-time-media-architecture.com/media-server-architecture/sfu-vs-mcu-topologies/mesh-versus-sfu-when-to-graduate/)
