# 合鸣（Ensemble）网络与实时层前沿技术调研 — 2026-09-05

> 范围：2025–2026 前沿网络技术调研，面向「合鸣」自部署 IM + AI Agent 的网络/实时层选型与扩展路径。
> 合鸣现状基线（摘自 `docs/analysis-architecture-2026-09-05.md` §5 与两份审计底稿）：
> - 生产部署 = **单容器单进程 server（Express 5 + node:sqlite）+ 单容器 relay（socket.io）**，无 Redis、无队列、无读副本。
> - **单进程 WsHub**（611 行单类承担 run/IM/信令/HITL/设备 五职责），socket.io + ws **双通道**、**双协议面**（WsEnvelope v1 与 relay device-link 两套格式，"relay 五份协议漂移"）。
> - **seq 分配假设单进程**：`store.appendRunEvent` 用 `MAX+1` 与 INSERT 同一同步块；`chat_messages` 线上 seq 恒 0/undefined、`afterSeq` 补拉死链（被坏合并 f4e02cd 打断）。
> - **无队列**（任务直接 `void runAsync()`）、**无缓存**（热点读全打 SQLite）、内存限流/去重无外置。
> - **relay 单点**：内存离线队列（每设备 100 条 / 24h 过期）、无持久化、共享密钥 `RELAY_AUTH_KEY` 鉴权。
> - 设计容量约 **1k 在线/单机**；10k 需「IM 网关独立 + run 队列 + seq 外置」。
>
> 取证方法说明：本环境 `WebSearch` / `WebFetch` 不可用（返空 / 域名无法验证），非 GitHub 域名（discord.com、core.telegram.org、datatracker 等）的 `curl` 直连亦失败（exit 000）。因此**全部事实改由官方 GitHub 仓库取证**（`raw.githubusercontent.com` 源码 + `gh api` 实时元数据），被反爬拦截的非官方页面一律回落该项目官方 GitHub 源交叉核实，并在文中以 **【实测】**=直接读到源码/配置、**【文档/推断】**=公开架构常识或据代码结构推断 标注。本文件不含任何真实 IP / 凭据；外部主机一律 `<SERVER_IP>` / `<NTFY_SERVER_IP>`，密钥一律 `<SECRET>`。

---

## 0. TL;DR

1. **传输层：WebSocket 在 2025-2026 仍是 IM 主消息面的事实标准，不要换。** WebTransport（QUIC/HTTP3，支持可靠流+不可靠数据报、原生连接迁移/0-RTT、消除头阻塞）是 W3C 现行规范，但其价值集中在「延迟敏感且可丢」的支路（实时状态同步、视频信令、协作光标），**不适合作为要严格有序的 IM 文字主面**；且合鸣服务端无 HTTP3/UDP:443 端点、移动端 iOS Safari 与 RN 生态支持不完整。结论：**IM 主面维持 WS，把预算投到「WS 下把 seq 补拉做对」，WebTransport 数据报只作 P2 前瞻支路**。

2. **fanout 的工业解法高度收敛，OpenIM 是现成可逐行读的范式**：「**每会话单调 seq（Malloc 一段+批内连续校验）+ 按 maxSeq 补拉（isEnd 收尾）+ 在线扇出/离线持久化/离线推送三链路用可插拔队列解耦 + 批量按会话哈希分桶落库 + presence 外置 Redis ZSET（翻转才广播）**」。这套不需要 Kafka——**进程内队列扮演 broker 即可**，且直接补上合鸣被 f4e02cd 打死的 P0「message seq + 重传」。

3. **seq 外置是 10k 的前置闸门，也是 P0 与 P1/P2 的分水岭**：OpenIM 的 seq 机制已完整验证；Discord 的 RESUME（`seq+session_id` 续传）、Slack 的 envelope ack、Matrix 的 since-token、Nostr 的 event.id 去重**全部收敛到同一模型——「每条消息可寻址（seq）+ 可去重（id）+ 可补拉（seq 区间）；状态外置、翻转才广播；扇出/持久化/推送解耦；连接恢复幂等续传而非全量重建」**。地基（seq+幂等 id）不修好，上面所有并发/扩容/handoff 都是空中楼阁。

4. **标杆系统给的机制级干货**：Discord（13 opcode 状态机、心跳 110/min 预算、指数退避 `rand(0,base·2^exp)` 封顶 2^10、RESUME 续传、zlib 压缩、4096B 硬限→应用层分片、`(user_id>>22)%shard` 分片）、Slack Socket Mode（RTM 继任、envelope id+ack+客户端去重、主动/被动断开 sentinel、`apps.connections.open` 一次性 WSS URL）、Matrix（**Synapse/Dendrite 均已 archived，Rust 轻量系 Tuwunel 活跃**；federation 三类单元 PDU/EDU/Query + txnId 幂等 single-flight、prev_events DAG 的归并成本是最大税、单写者+Postgres+Redis 复制流+worker 拆分）、Phoenix（每 channel 一个 BEAM GenServer 进程、`phash2` 分区 DynamicSupervisor、fastlaning「编码一次写 N 次 socket」、Presence 每节点副本+心跳+版本号、PubSub 默认 PG2 而非 Redis）。

5. **relay 拓扑：Nostr 的「event.id 去重 + relay 哑存储」是设备互联 handoff 的现成工业范式**——合鸣 relay 应从「共享内存态的一致性锚点」降级为「哑转发+短期缓冲」，一致性上移到客户端（id 去重）+ server（seq 补拉）；handoff 应做成「续传」（目标设备用 sessionId+maxSeq 续传）而非状态迁移；`RELAY_AUTH_KEY` 共享密钥 1k 设备前应换 server 签发的 per-device 短期 token。**多 relay 水平扩是「id 去重+seq 补拉+per-device token」三件套齐备后的自然结果，不是当前目标。**

---

## 1. 实时传输层：WebSocket vs WebTransport vs QUIC/HTTP3

### 1.1 机制本质

**WebSocket（RFC 6455）**：基于 TCP 的单条、可靠、有序消息流，穿透性好（443/WS 升级），是 2025-2026 实时应用的默认选择。固有缺陷是**头阻塞（HOLB）**：所有消息必须按序收发，即使彼此独立、即使某些已过期——「since the abstraction it provides is a single, reliable, ordered stream of messages, it suffers from head-of-line blocking」。对 IM **文字消息**（本就要求严格有序）这是特性而非缺陷；但对**可丢、可乱序**的数据（实时状态、视频帧、信令）是拖累。【实测：w3c/webtransport explainer.md 对 WebSocket HOLB 的官方表述】

**WebTransport（W3C 现行规范，w3c/webtransport，pushed 2026-09-02）**：官方 explainer 定义——「low-latency, bidirectional, client-server communication… designed for applications that require the performance of QUIC (the transport layer of HTTP/3)… It supports both **reliable streams** and **unreliable datagrams**」。核心机制【实测：index.bs + explainer.md + explainers/subprotocol_negotiation.md】：
- **session = 一条 HTTP/3 over QUIC（UDP）连接**；若网络无 H3-only 路径，**回落到 HTTP/2 over TCP**。客户端用 `wt.reliability` 判断当前是 `"supports-unreliable"`（QUIC/UDP）还是 `"reliable-only"`（TCP/H2 回退）。
- **两种数据语义**：(a) **可靠流**（incoming unidirectional / outgoing unidirectional / bidirectional 三种，流内有序可靠、**流间独立**）；(b) **不可靠数据报**（`WebTransportDatagramsWritable`，unordered + unreliable，走 QUIC Datagram Extension，零重传开销）。
- **消除 HOLB**：多独立流并行 + 数据报无序，大文件传输不饿死小的低延迟控制消息。规范提供 **`sendOrder`（数字优先级）+ `WebTransportSendGroup`（逻辑桶）的分层调度模型**——「critical for preventing large file transfers from starving small, latency-sensitive control messages」。
- **QUIC 原生能力**：连接迁移（Connection ID 使 TCP 五元组变化不破坏会话）、0-RTT 恢复、多路复用——对**弱网移动场景**（Wi-Fi↔蜂窝切换、NAT 换）是实质收益。

**QUIC / HTTP3（RFC 9000/9001/9002/9114）**：WebTransport 的底层。纯 Go 参考实现 quic-go（工业级）已支持 QUIC v2（RFC 9369）+ HTTP/3（RFC 9114）+ `webtransport-go`（draft-ietf-webtrans-http3）+ `masque-go`（CONNECT-UDP）。【实测：github.com/quic-go/quic-go README】

### 1.2 工业界 2025-2026 实际采用

- **IM 主消息面仍是 WebSocket，无头部 IM 把文字消息切到 WebTransport/QUIC**。证据【实测】：Discord 官方 gateway 仍是 `wss://`（discord.py `DEFAULT_GATEWAY = wss://gateway.discord.gg/`、`f'wss://{state.endpoint}/?v=8'`）；Slack Socket Mode 仍是 WS（`packages/socket-mode/src/SlackWebSocket.ts`）；Matrix CSAPI 客户端仍是 WS。
- **WebTransport 实际采用集中在「延迟敏感 + 可丢 + 多路复用」场景**：云游戏（Chrome 原生）、实时协作/音视频信令、高频状态同步、低延迟 CDN 边缘分发。**没被当作「聊天主通道」**。【文档/推断：WebTransport 官方定位 + 各产品公开形态】
- **移动端支持现状（2026）**：Chrome/Edge 桌面与 Android Chrome 已支持 WebTransport（含 H3）；**iOS Safari 对 WebTransport/H3 的启用偏保守、支持不完整**，**React Native 的 WebView 内核与 RN 原生 WebSocket（`ws`/socket.io）不直接暴露 WebTransport API**——这正是合鸣移动端（Expo SDK57 / RN 0.86，走 socket.io + 原生 ws 双链）短期无法受益的现实原因。【文档/推断：本环境无法直查 caniuse，标注为公开常识，未逐源核实】
- **服务端成本**：WebTransport over H3 要求服务端跑 UDP/443 + QUIC 栈（nginx 需 quic 模块，或 Go 用 quic-go 边车）。合鸣当前 nginx 只代理 relay:8888、不代理主服务，**没有 HTTP3 端点地基**——上 WebTransport 要额外加一条 UDP/443 链。

### 1.3 对比小结（IM 场景）

| 维度 | WebSocket（现状） | WebTransport（H3） | 对合鸣的意义 |
|---|---|---|---|
| 连接恢复 | 需自研重连+补拉（seq） | QUIC 连接迁移+0-RTT（弱网强） | 合鸣 seq 补拉已断（P0）；WebTransport **不能替代** seq（它解决传输不解决业务补拉） |
| 多路复用 | 单流 HOLB | 流间独立+数据报 | 合鸣已在应用层多路复用（run/IM/信令/HITL 共用 ws），WS 够用 |
| 弱网 | 弱（TCP 队头阻塞+断连重握） | 强（QUIC 迁移/0-RTT） | 移动端弱网是常态（§5.2），但主消息面要可靠有序，WebTransport「可丢」反而不适合文字 |
| 移动端 | 全支持（ws/socket.io/RN 原生） | 不完整（iOS Safari/RN WebView 无 API） | 合鸣移动端短期无法切 |
| 服务端成本 | 已有（ws/socket.io） | 需加 UDP/443+QUIC 栈 | 合鸣无 H3 地基 |
| 2026 工业采用 | IM 主消息面事实标准 | 延迟敏感可丢场景（游戏/协作/信令） | IM 主面维持 WS |

**结论**：IM 主消息面**维持 WebSocket**（与全部对标系统一致，且 RN 生态只能走 WS）。WebTransport 价值在「延迟敏感且可丢」支路——**移动端实时状态同步（presence/typing）与未来视频信令**——可作 P2 评估项，**不改变 IM 主面选型、不解决 seq 补拉**。

### 1.4 合鸣可借鉴（机制级）

1. **IM 主消息面锁死 WebSocket，不追 WebTransport**——与 Discord/Slack/Matrix 一致，RN 生态只能走 WS。工程预算投到「WS 下把 seq 补拉做对」而非换传输协议。合鸣现状 `/ws`（原生 ws）+ 移动端 socket.io 双通道，**长期收敛为单条 WS 语义**（见 §5），而非引入第三条 WebTransport。
2. **给「可丢、低延迟」支路预留 WebTransport 数据报后门**：未来做「移动端实时在线状态/typing 光标/协作光标」这类**丢了无所谓、要快**的数据，单独开一条 WebTransport（H3）数据报通道，文字消息仍走 WS。前提是 server 加 UDP/443 端点（nginx quic 模块或 Go quic-go 边车）——**P2，当前无地基，先不动**。
3. **借鉴 WebTransport「流间独立 + 优先级调度」改造 WsHub**：合鸣 WsHub 把 run/IM/信令/HITL 挤在一条 ws 里共用 16ms 批量 flush，慢客户端的 4MB 背压会拖慢整条连接所有业务。应用层仿照 `sendOrder`（优先级）+ `SendGroup`（逻辑桶）——**给 HITL 确认、kick 下线、IM 消息分级**，背压降级时优先保高优先级流、丢低优先级流（当前是「背压直接丢 chat.message 且无补拉」，架构 §3.2，P1）。
4. **弱网重连吸收 QUIC「幂等恢复」心智**：即便维持 WS，客户端重连应像 QUIC 0-RTT 那样**尽量不带状态重建**——移动端 socket.io 重连后直接用本地 `maxSeq` 拉增量，而非全量重订阅 run。这与 §3 Discord RESUME、§5 设备 handoff 同一条主线。

---

## 2. 高并发 IM 服务端：百万级 fanout 怎么做

### 2.1 三种消息总线定位（Redis pub/sub vs Kafka vs NATS）

百万级 fanout 的核心不是「选哪个中间件」，而是**把一条消息的三条去向解耦**：在线扇出（实时、可丢到离线兜底）、离线持久化（可靠、批量）、离线推送（厂商/ntfy，异步）。三者用总线解耦后，总线选型才有意义：

- **Kafka**（OpenIM 默认总线）：durable、分区、可重放、消费组，适合「**必须可靠落库/不能丢**」的离线持久化+推送链路。OpenIM 三个 topic（`latestMsgToRedis` / `msgToPush` / `offlineMsgToMongoMysql`，各 8 分区）把「写缓存」「推送」「落库」拆成三条消费链路。【实测：open-im-server `docs/contrib/kafka.md` + `config/kafka.yml`】**缺点**：运维重（broker 集群），对「自用/小团队单实例」的合鸣是过度。
- **NATS**（nats-io/nats-server，20,664 stars，pushed 2026-09-04，活跃）：轻量、subject + queue group 发布/订阅，天然适合「**会话=subject、在线节点=queue group 成员**」的扇出路由；**JetStream** 提供持久化 stream（替代「可靠离线链路」），**KV** 提供带版本/保留策略键值（替代「Redis 缓存 seq/最新消息」）。【实测：gh api nats-io/nats-server 元数据；机制点为 NATS 公开架构】单二进制、可跑 Raspberry Pi——**比 Kafka 轻得多，是合鸣从「进程内队列」升级到「跨实例总线」时最合适的中间档**。
- **Redis pub/sub**：最快最轻，但**原生 pub/sub 是 fire-and-forget（无持久化、订阅者不在线就丢）**。**Redis 7+ Sharded Pub/Sub**（`SPUBLISH`/`SSUBSCRIBE`，slot 感知、cluster 原生）解决跨节点 pub/sub「每节点都收全量」问题——只路由到 channel 哈希所在 slot 的节点。【实测：github.com/redis/redis `src/commands/pubsub-shardchannels.json` + `tests/cluster/tests/25-pubsubshard-slot-migration.tcl`】对「在线扇出」（可丢、要快）最匹配，**但离线持久化不能只靠它**。

**选型结论（对合鸣）**：在线扇出——单进程=内存连接表（不需总线），多实例=Redis Sharded Pub/Sub 或 NATS queue group；离线持久化+推送——需可靠重放，**当前规模进程内队列即可**，跨实例 NATS JetStream（或 Kafka）；seq/最新缓存——Redis（单实例）或 NATS KV。

### 2.2 按用户/群分片 + 消息 seq + 补拉协议（核心机制，OpenIM 完整验证）

OpenIM（openimsdk/open-im-server，16,634 stars，pushed 2026-09-02，Go，Apache-2.0）是「每会话单调 seq + 按 maxSeq 补拉 + 三链路解耦」的完整开源实现，机制级拆解（全部源码实测）：

**服务拓扑**：gateway（`internal/msggateway`，WebSocket 接入，`user_map.go` 内存 map `userID→platformID→[]*Client`）、msg（`internal/rpc/msg`，含 `seq.go`/`sync_msg.go`/`send.go`/`as_read.go`/`revoke.go`）、msgtransfer（`internal/msgtransfer`，Kafka 消费者，分桶批写 Redis+Mongo/MySQL）、push（`internal/push`，消费推送 topic，区分在线/离线 getui/jpush/fcm）、auth/user/group/conversation。

**（a）每会话单调 seq，批量分配 + 批内连续校验**
- seq 是 **per-conversation**（每会话）而非每用户。存 Redis hash：键 `GetMallocSeqKey(conversationID)`，字段 `CURR`（当前 maxSeq）+ `TIME`（该 seq 时间戳）。【实测：`pkg/common/storage/cache/redis/seq_conversation.go`】
- 写路径「**先 Malloc 一段 seq，再逐条填**」：`msgTransferDatabase.BatchInsertChat2Cache` 调 `db.seqConversation.Malloc(ctx, conversationID, len(msgs))` 一次预留一段（群会话 `basicSize=100`），`seq = firstSeq + i`；`BatchInsertBlock` 里若 `msg.Seq != firstSeq + i` 直接报 `seq is invalid`，**强制批内严格连续**。【实测：`controller/msg_transfer.go`、`controller/msg.go`】
- 直接可移植单进程：把 Redis hash 换成 node:sqlite 一行 `(conversation_id, curr_seq)` 或内存计数器，JS 单线程下 `MAX+1` 与 `INSERT` 天然不交错（与架构 §6 判定一致）。

**（b）缺口检测 + 按 seq 补拉 + isEnd 收尾（= 合鸣 P0「message seq + 重传」现成范式）**
- 客户端先 `GetMaxSeq`（读 Redis `CURR`）拿服务端该会话 maxSeq，比对本地最大 seq，若本地 < 服务端，对缺口区间调 `PullMessageBySeqs`（`SeqRanges={conversationID, begin, end}`）或 `GetSeqMessage`（带上下界）。【实测：`internal/rpc/msg/sync_msg.go`、`internal/msggateway/message_handler.go`】
- 响应带 **`isEnd`**：asc 顺序 `isEnd=(maxSeq<=end)`，desc 顺序 `isEnd=(begin<=minSeq)`——客户端据此判断「这段拉完了没有」，实现分页/收尾，避免无限翻页。【实测：`sync_msg.go`】

**（c）maxSeq / hasReadSeq / 每用户窗口 三者分离，已读回执走同一管线**
- 「服务端最新 seq」（maxSeq）与「某用户已读 seq」（hasReadSeq）是**两个独立字段**：hasReadSeq 按 `(conversationID, userID)` 存；已读回执作为「内容类型」（`HasReadReceipt`）流经正常扇出与持久化管线，落库时解析出 `max(tips.Seqs)` 更新 hasReadSeq。【实测：`msg.proto` 的 `Seqs{maxSeq, hasReadSeq, maxSeqTime}`、`online_history_msg_handler.go` 的 `doSetReadSeq`】

**（d）批量 + 按会话哈希分桶落库（摊平写压力 + 同会话保序）**
- msgtransfer 用 `pkg/tools/batcher`：`size=500、worker=50、interval=100ms`，**sharding = `hash(conversationID) % worker`**——「按会话哈希分桶到固定 worker，worker 内同会话保序，达 size 或超 interval 就批量写」，既摊平 DB 写压力，又保证同会话消息落同一 worker、批内保序。【实测：`online_history_msg_handler.go`】

### 2.3 presence 服务分片（OpenIM）

- **在线 = 至少一个端在线**：`getUserOnlineStatus → online.GetOnline(userID)` 返回 platformIDs，`len>0` 判 Online。多端用 **platformID** 维度（gateway `user_map.go`：`userID→platformID→[]*Client`）。【实测：`internal/rpc/user/online.go`、`internal/msggateway/user_map.go`】
- **Redis ZSET + Lua 原子化**：每用户一个 ZSET（`GetOnlineKey(userID)`），成员=platformID；**Lua 脚本**原子 `ZREMRANGEBYSCORE/ZREM/ZADD` 并判断「**从空变非空 或 非空变空**」，只在状态真正翻转时才向 `OnlineChannel`（Redis pub/sub）发布变更——避免每次心跳都广播。【实测：`pkg/common/storage/cache/redis/online.go`】
- **可分片**：全量在线用户 = `SCAN GetOnlineKey* + cursor` 分页；presence 状态走 Redis pub/sub，天然可被任意实例订阅。**这套设计直接把「在线状态」从单进程内存外置到 Redis——正是架构 §5.2 判定「多实例时设备在线状态是单进程内存视图，直接错乱」的解法。**

### 2.4 背压与离线存储设计

- **背压**：合鸣现状「4MB `bufferedAmount` 触发后静默丢 chat.message 且 seq 补拉已断 = 永久丢失」（架构 §3.2，P1）。工业界（Discord/Slack/Matrix 一致）：**背压必须有硬上限 + 分级降级 + 可补拉兜底**。因文字消息有 seq，**背压丢的消息永远可靠补拉找回**——「背压降级」的正确语义是「暂停向慢客户端推、让它落后、靠 seq 追平」，而非「丢」。**前提就是 §2.2 seq 补拉先修好。seq 不修好，背压降级无从谈起。**
- **离线存储**：OpenIM 把「离线消息落 Mongo/MySQL」走 Kafka `offlineMsgToMongoMysql` 异步批量，**在线 WS 写之前不同步阻塞落库**（落库是 msgtransfer 消费端批量做）。合鸣现状「先 `appendRunEvent` 同步落 SQLite 再 `hub.broadcast`」（架构 §3.1），单进程小规模可接受，但应意识到「**落库和扇出应解耦**」——落库走异步批量（借鉴 §2.2d batcher），扇出走内存连接表，两者用队列解耦，避免 LLM 流式 token 突发时同步落库拖垮 WS flush 的 16ms 预算（架构 §5.2）。

### 2.5 合鸣可借鉴（机制级）

1. **每会话单调 seq + Malloc 一段 + 批内连续校验**（OpenIM 范式，照搬到 node:sqlite）：`chat_messages` 加 `(conversation_id, seq)`，seq 存 `(conversation_id, curr_seq)` 一行或 DB 自增，写时「预留一段→逐条填→校验连续」。**这是 §7 P0 第一项**，与被 f4e02cd 打死的 P0「message seq」同源——修 seq 外置同时救补拉、救背压降级、救多实例扩容，三赢地基。
2. **补拉协议 = GetMaxSeq + PullMessageBySeqs + isEnd**：加 `GET /conversations/:id/seq`（返 maxSeq）与 `GET /conversations/:id/messages?begin=&end=`（返消息 + isEnd）。客户端上线/重连/发现 gap 拉增量。**合鸣现有 `afterSeq` 补拉接口已被坏合并打断（架构 §4.1「WS seq 链」🔴），本项是把它修对并扩展成按区间批量拉**。
3. **maxSeq / hasReadSeq 分离 + 已读回执走同一管线**：别把「服务端最新」和「某用户已读」混一个字段；已读作为事件流经现有 WsHub 扇出，落库更新 `(conv,user)→has_read_seq`。一条 SQL + 一次广播即可，无需总线。
4. **写库攒批 + 按会话哈希分桶**（OpenIM batcher 范式）：「每条消息一次 SQLite 往返」改「内存数组攒批（100ms 或满 500 条 flush）+ 事务批量 INSERT」，同会话保序。node:sqlite 单连接天然可行。**直接缓解架构 §5.1「1k 用户时群广播一次 N+2 次独立写、WAL 写锁排队随群规模线性涨」**。
5. **在线/离线/持久化/推送 三链路用「进程内队列」解耦（先不上 Kafka）**：合鸣现在把四件事挤在 WsHub + store 同步做。抽进程内队列（key=会话键），把「持久化」「离线推送」变异步消费者，扇出走内存连接表。**跨实例时把队列换 NATS JetStream（或 Redis Streams）**——§7 P1 核心。借鉴 OpenIM「MQ 接口抽象 + 内存后端」（`tools/mq` 的 `Producer.SendMessage(key,bytes)` + `memamq`），**先内存跑通管线，扩容时换 broker 不改业务代码**。
6. **presence 外置 Redis ZSET + Lua 状态翻转才广播**：多实例/多进程时把 `userSockets`/`wsDevices`（现单进程内存，架构 §3.2）外置成 Redis ZSET（成员=deviceId/platform），Lua 原子翻转 + 只在 OnlineChannel 发变更。**10k 前「设备在线状态可跨实例」的最小实现**。当前单实例可缓，但 schema 上预留（devices 表已有雏形）。

---

## 3. 标杆系统机制级拆解

> 每家提炼机制级可借鉴点。Telegram MTProto 因 core.telegram.org 本环境被反爬拦截（curl exit 000）无法直接取证，第二标杆改选 **Slack Socket Mode（RTM 官方继任）**——同样走 WS，且其 envelope ack + 自动重连机制对合鸣双通道收敛更有直接参考价值。

### 3.1 Discord Gateway（sharding / resume / heartbeat / 4096B）

源码实证来自 **discord.py**（`discord/gateway.py`、`client.py`、`backoff.py`，官方最广泛客户端）与 **discord.js**（`packages/core`、`apps/guide/content/docs/legacy/sharding`）。【实测】

**（a）Opcode 状态机（13 个 op，双向分工明确）**：`0 DISPATCH`（收，事件分发如 READY）、`1 HEARTBEAT`（双向：收=告知间隔，发=探活）、`2 IDENTIFY`（发，新会话）、`3 PRESENCE`（发）、`4 VOICE_STATE`、`5 VOICE_PING`、`6 RESUME`（发，续传）、`7 RECONNECT`（收，换新 gateway）、`8 REQUEST_MEMBERS`、`9 INVALIDATE_SESSION`（收，可选作废 session 重 IDENTIFY）、`10 HELLO`（收，告知 heartbeat_interval）、`11 HEARTBEAT_ACK`（收，确认心跳；**没收到=连接异常**）、`12 GUILD_SYNC`。【实测：`gateway.py` docstring opcode 表 + `OPCode` 枚举（`RESUME=6` 等）】

**（b）心跳预算 + 超时**：服务端 HELLO 下发 `heartbeat_interval`，客户端按周期发心跳；`GatewayRatelimiter` **默认 110 次/分钟**（「give room for at least 10 heartbeats per minute」）；心跳超时服务端断连（客户端 `_max_heartbeat_timeout`，voice 60s）。【实测：`gateway.py` L93-94、L566】

**（c）RESUME 续传（核心）**：客户端维护 `session_id` + `sequence`（seq）。断线后**优先发 `RESUME {seq, session_id}`**，服务端据此**只补发 seq 之后的事件**（不需重新 IDENTIFY/拉全量状态）。仅 RESUME 失败或服务端发 `INVALIDATE_SESSION` 才回退 IDENTIFY。客户端用 `resume_gateway_url`（服务端下发的专用续传 URL）直接重连。【实测：`gateway.py` L506-518 `resume()`、L73-76 `ReconnectWebSocket(resume→RESUME/IDENTIFY)`】

**（d）指数退避重连**：`ExponentialBackoff`——`delay = rand(0, base·2^exp)`，`exp` 从 1 起每次 +1、**封顶 2^10**；距上次重试超 `base·2^11` 秒则重置。带随机抖动（防惊群）。【实测：`backoff.py` 完整实现】

**（e）4096B 硬限 + zlib 压缩 + 分片**：
- **单条 gateway payload ≤ 4096 字节**（Discord 服务端硬限，超过拒绝）——直接对应合鸣「背压/分片」问题：大消息必须应用层分片，不能赌传输层。【文档/推断：Discord 开发者文档已知硬限，本环境 discord.com 被反爬无法直读；周边机制经 discord.py 交叉核实】
- **zlib 压缩**：`compress: True`、`ws_connect(gateway, compress=15)`，接收侧 `_decompressor` 解压——IM 事件流压缩比高（大量重复 JSON）。【实测：`gateway.py` L346、L934】
- **分片（sharding）**：shard 数由 `/gateway/bot` 返回，**`shard_id = (user_id >> 22) % shard_count`**（按用户高位哈希，保证同一用户永远落同一 shard，其连接/状态在一进程内）。discord.js 的 `ShardingManager` + `IShardingStrategy`（`connect/spawn/send/fetchStatus/destroy`）抽象分片管理，支持 `broadcastEval` 跨 shard 求值。【实测：`packages/util/src/functions/calculateShardId.ts`、`packages/ws/src/strategies/sharding/IShardingStrategy.ts`】

**Discord 可借鉴点（机制级）**：
1. **续传优先、重建兜底（RESUME vs IDENTIFY）**：断线先用 `seq+session` 续传（只补增量），失败才全量重建。**正是合鸣「移动端重连后全量重订阅」应改的**——移动端 socket.io 重连带本地 maxSeq 走增量续传。
2. **心跳是预算制（110/min）不是越密越好**：心跳太密会被限流/断连。合鸣 WsHub **无心跳/isAlive 驱逐**（架构 §4.1「无死连接回收」🟠），应加周期心跳 + 超时无响应驱逐半开连接（防 NAT 场景幽灵 socket 累积，§5.2）。
3. **指数退避带抖动、封顶、可重置**：`rand(0, base·2^exp)` 防惊群。合鸣桌面端 /ws 与 relay 链的重连退避策略应统一（当前双通道两套逻辑，架构 §3.5）。
4. **payload 4096B 硬限 → 应用层分片**：合鸣 IM 大消息（长文本/图片元数据）应应用层分片 + 组装，不赌 WS 帧大小（当前 4MB 背压是「缓冲上限」非「单帧上限」，两者语义分清）。
5. **按用户高位哈希分片（`(id>>22)%n`）**：同一用户永远同分片 → 连接/在线/seq 一进程内。合鸣「10k 拆多进程」的分片键设计——**按 conversation/user 哈希分片而非随机**，保证会话内保序 + 状态本地化。
6. **zlib 压缩事件流**：IM 事件 JSON 压缩比高，WS 层开压缩（ws 库原生 permessage-deflate）缓解带宽。低优先级零成本。

### 3.2 Slack Socket Mode（RTM 官方继任）

源码实证来自 **slackapi/node-slack-sdk**（`packages/socket-mode/src/SocketModeClient.ts`，pushed 2026-09-05，活跃）。【实测】

**背景**：Slack 已废弃旧 RTM API（长连接 + 全量 state 推送），改用 **Socket Mode**——本质「Events API over WebSocket」：客户端先 `apps.connections.open`（HTTP）拿一次性 WSS URL，再建 WS；服务端事件以 **envelope（带 `id`）** 下发，客户端必须回 **ack** 确认，未 ack 的事件服务端重发。【实测：`SocketModeClient.ts` 注释】

**（a）envelope + ack（幂等去重 + 可靠投递）**：每个事件有唯一 `id`，客户端处理完回 ack；服务端靠 ack 决定重发，**客户端本地按 envelope id 去重**（重发可能重复）。提供「**at-least-once 投递 + 客户端幂等去重**」的可靠语义。【实测：`SocketModeClient.ts`（ack/`SlackWebSocket`/状态机）】

**（b）自动重连 + 失败计数**：`autoReconnectEnabled`（默认 true）、`numOfConsecutiveReconnectionFailures`（连续失败计数）、`reconnectionTimer`（定时重连）；`disconnect()` sentinel 区分「主动断开」与「被动断线」（主动断开不触发自动重连）。【实测：`SocketModeClient.ts` L39-105】

**Slack 可借鉴点（机制级）**：
1. **envelope id + ack + 客户端去重 = 可靠实时投递最小可靠集**：合鸣 IM 消息带全局唯一 `msg_id`（或 sha256），客户端按 id 去重——同时解决「重连补拉重复消息」和「多设备收到同一消息」，与 §5 Nostr event.id 去重、§2.2 seq 补拉**三条线收敛到同一「幂等消息」模型**（每条消息可寻址 seq + 可去重 id + 可补拉 seq 区间）。
2. **ack 语义区分「已收」与「已处理」**：服务端靠 ack 决定重发，客户端处理完才 ack。合鸣 HITL 确认（`hub.requestConfirm`）与 IM 已送达回执（`markDelivered`）可套「先收后 ack、未 ack 重发」模型，替代「广播即视为送达」。
3. **主动断开 vs 被动断线的 sentinel**：合鸣 WsHub close 处理应区分「用户主动退出」（清订阅、不触发离线推送）与「网络断线」（保留会话状态、触发补拉）——当前双通道逻辑混在一起（架构 §3.5），应引入显式 sentinel。
4. **连接 URL 由服务端一次性下发（`apps.connections.open`）**：合鸣 relay「设备注册拿连接参数」可借鉴——设备向 server 申请**短期、一次性、绑定 deviceId 的 WS 连接 URL/token**，而非共享 `RELAY_AUTH_KEY`（呼应 §5 per-device token）。

### 3.3 Matrix（Synapse 的 scale 问题 + federation + 轻量替代）

> 由子代理独立逐源调研 + 本人交叉核实。Matrix spec 官方仓库 `matrix-org/matrix-spec`（GitHub 可直读），故联邦/同步/状态机制可**直接落到 spec 文件与 Synapse 源码**，非纯推断。

**（a）关键信号：官方三大 homeserver 全部「停更/归档」，继任者分散**（2025-2026 对标选型最重要校准，比单看 stars 靠谱得多）：
- **Synapse**（Python/Twisted，事实标准）：`matrix-org/synapse` 已 **archived=true**，最后 push **2024-04-26**，最新 release **v1.98.0（2023-12-12）**，default_branch=develop，12,107 stars、1,522 open issue。官方维护已停。【实测：gh api matrix-org/synapse】
- **Dendrite**（Go 二代 homeserver）：`matrix-org/dendrite` 已 **archived=true**（pushed 2024-11-25，v0.13.8），**README 明确移交 `element-hq/dendrite` 维护**（后者活跃，pushed 2026-07-27，965 stars）。【实测：gh api + Dendrite README】
- **Conduit → conduwuit → Tuwunel（Rust 轻量系）**：`girlbossceo/conduit` redirect 到 `x86pup/conduwuit`（**archived=true**，pushed 2026-05-29，24 stars），自述「Conduit 的 hard fork」，README 声明**唯一官方继任者 Tuwunel（`matrix-construct/tuwunel`，Rust，pushed 2026-09-04，2,490 stars，活跃）**。`conduitp/conduit`、`conduit-py/conduit` 均 404。【实测：gh api + conduwuit README】
- **含义**：Matrix「官方服务端」2023-2024 组织重组（基金会缩减、Element 接管 Dendrite、社区 Rust 系独立），2025-2026 **无单一活跃官方主线，社区维护为主**。对合鸣：**参考「机制」安全，参考「具体实现」风险高**（随时可能断档）。

**（b）federation 联邦模型：PDU/EDU/Query 三类通信单元 + Transaction 事务 + txnId 幂等**（spec 直接写明）：
- 三类单元：**PDU**（Persistent Data Unit，房间事件，持久化，广播给同房间所有 server）、**EDU**（Ephemeral Data Unit，如 presence/typing，不持久化、无需回复）、**Query**（单请求/响应，如查 profile/presence 快照）。EDU 与 PDU 封装进 **Transaction**，HTTPS PUT 源→目标 server；每个 PDU 由源 server 私钥签名，可经第三方转发仍被验证。【实测：`matrix-spec/content/server-server-api.md`「three main kinds of communication」段】
- **事务幂等（关键可借鉴）**：联邦发送端点 `PUT /_matrix/federation/v1/send/{txnId}`，spec 明确「**发送 server 必须等待并重试，直到收到 200 OK，才能向接收 server 发送带不同 txnId 的事务**」——用 **txnId 做幂等键 + single-flight**，保证重试不产生重复事件。【实测：`matrix-spec/data/api/server-server/transactions.yaml`】

**（c）事件排序 = prev_events DAG（非单条总序号）—— Matrix 最难扩展的根源**：
- 每个 PDU 的 `prev_events` 指向前驱事件，「**在房间内建立事件偏序，链接成有向无环图（DAG）**」。收到远端 PDU 需过 **7 道检查**（格式→签名→hash→auth_events 鉴权→旧状态鉴权→当前状态鉴权→policy 签名），任一失败丢弃/脱敏/拒绝。【实测：`server-server-api.md`「PDUs」小节】
- **教训（inferred，基于 DAG 结构）**：DAG 是为「去中心化、无全局时钟、server 可离线再合并」付的代价——任意两 server 各自产生事件后，最终都要靠 state resolution 把分叉归并出唯一状态。**合鸣单 relay 自托管，天然单一权威时序，完全可用「单条递增 seq + 幂等键」替代 DAG，省掉整类归并成本。**（见下方借鉴点 5，价值最高的「不做什么」。）

**（d）状态解析（state resolution）= 硬骨头，v1/v2 两代算法**：
- Synapse 源码状态解析分两代、分文件：`synapse/state/v1.py` 与 `synapse/state/v2.py`（**v2 用 heapq 做候选状态优先归并**）。存储层有 `state_group` schema（`state_group_seq.py` 等），把「**房间在某一时刻的完整状态**」快照成可复用 **state group**，供 /sync 与联邦复用。【实测：`synapse/state/v1.py`、`v2.py`、`synapse/storage/databases/state/`】
- **教训**：「**state resolution is the hard part**」——多事件并发改同一房间状态时，必须有确定性算法收敛到唯一状态，否则客户端/server 间状态漂移。合鸣若不做去中心化，应从一开始「**单写者串行落库 + 房间状态作为不可变快照（state group 思想）随消息派生**」，把「归并」变「只读快照」，从根上避免 v1/v2 解析器。

**（e）水平扩展 = 共享 Postgres + Redis 复制流 + worker 拆分（不换语言）**：
- `docs/workers.md`：小实例跑单体 monolith；大实例把功能拆成多个独立 Python 进程（workers）。**所有进程共享同一个 Postgres**（worker 模式只支持 PostgreSQL，SQLite 仅 demo）；进程间用 Synapse 自研 **replication 复制协议**（类比 MySQL/PG 复制）传送新写入数据流；启用 Redis 时用 **Redis pub/sub 频道在所有进程间转发复制流**，Redis 兼作共享缓存。main 进程是特殊角色（写者/协调者），worker 多为读者。【实测：`docs/workers.md`】
- `docs/replication.md` 动机：**多进程不能同时随便写一个 DB（唯一 ID 分配、缓存失效都假设单进程）**，所以「**单写者 + 多读者 + 追加日志**」——写者暴露 append-only 更新日志，读者消费它做缓存失效与推送；Synapse 本就为 /sync 存了 append-only 日志，改造成本低。【实测：`docs/replication.md` + `tcp_replication.md`】
- **教训**：单进程 Python/Twisted 撑不住后，官方**没换语言**，而是「共享一个强一致 DB（Postgres）+ 一个 pub/sub（Redis）做进程间复制流 + 按职责拆 worker」。这套「**单写者 DB + 复制流 + 职责分片**」正是合鸣单点 relay 走向多副本时最该抄的骨架（比 DAG 联邦现实得多）。

**（f）客户端同步 = /sync 的 since token + 长轮询**：
- CSAPI `/sync` 参数：**`since`**（填上次返回的 `next_batch` token，增量同步）、**`timeout`**（长轮询等待毫秒，默认 0 立即返回，设 30000 挂起最多 30s）、`full_state`（是否返回全房间状态）、`set_presence`（轮询时标 online/offline/unavailable）、`use_state_after`（Matrix 1.16 新增，状态变化取时间线起点前还是终点前）。客户端首次取初始快照，之后循环调增量 delta。【实测：`matrix-spec/data/api/client-server/sync.yaml`】

**Matrix 可借鉴点（机制级）**：
1. **事务幂等键 + single-flight（`/send/{txnId}`）**：relay 间/客户端间消息投递用「**客户端生成的幂等 key + 同 key 串行、200 前不换 key**」，天然抗重试重复。合鸣 IM 底线（message seq + 幂等键 + 已送达回执，im-gap-analysis P0）可直接对齐的联邦级做法，与 §3.2 Slack envelope ack、§5.1 Nostr event.id 同属「幂等消息」主线。
2. **since-token 增量同步（`next_batch` + `timeout` 长轮询）**：客户端持游标 token，服务端按游标吐增量。**合鸣单 relay 用「全局/会话单调 seq 作 token」即可**——比 Matrix opaque token 更简单，天然支持断线补拉（对 §2.2 seq 补拉、§3.1 Discord RESUME）。
3. **state group 不可变快照思想**：房间状态不「原地改」，每次变更**派生新不可变快照（state group）**，消息携带它、/sync 与补发都引用。合鸣用「会话维度状态快照 + 版本号」实现，规避 state resolution。
4. **单写者 + 追加日志 + pub/sub 复制流（worker/replication 范式）**：合鸣从单点 relay 走向多副本的标准答案——一个权威写者写 SQLite WAL，其余副本消费 append-only 流做缓存失效与推送。**直接对治架构 §5.2「seq 分配假设单进程，两实例共享 SQLite 会算出相同 seq」**。
5. **反面教训「别为去中心化付 DAG 税」（价值最高的『不做什么』）**：合鸣自托管单 relay，**不需要 DAG + state resolution**——用「单一权威时序 + 幂等键」省掉 Matrix 最难、最贵、最易出 bug 的整层。这是架构决策依据，非功能建议。

### 3.4 Elixir Phoenix Channel（进程模型）

> 由子代理独立逐源调研 + 本人交叉核实。Phoenix 未归档、活跃（v1.8.13，2026-09-04 push），进程机制**可落到源码**（`channel/server.ex`、`pubsub.ex`、`tracker/replica.ex`），非纯推断。

**（a）现状：活跃、健康、模块化演进**：`phoenixframework/phoenix` 未归档，pushed **2026-09-04**，最新 release **v1.8.13（2026-08-25）**，23,140 stars。PubSub 已拆独立包 `phoenixframework/phoenix_pubsub`（活跃，771 stars）。【实测：gh api】

**（b）Channel = 一个轻量 BEAM 进程（GenServer）**：
- `lib/phoenix/channel/server.ex` 第 3 行：`use GenServer, restart: :temporary`——**每个 channel 服务器是一个 GenServer 进程**，进程标签 `{Phoenix.Channel, channel, topic}`。官方指南：「**每个客户端、每个 topic 创建一个 channel server 轻量进程**」，进程持有 `%Phoenix.Socket{}`，自有状态存 `socket.assigns`；消息按 topic 路由到对应 channel server。【实测：`channel/server.ex` + `guides/real_time/channels.md`】
- **进程池与分区**：`lib/phoenix/socket/pool_supervisor.ex` 用 `DynamicSupervisor`（strategy `:one_for_one`），按 `:erlang.phash2(key, partitions)` 把连接散列到 **N 个分区** DynamicSupervisor（存 ETS 表）——**连接级隔离 + 可水平分区**。【实测：`pool_supervisor.ex`】
- **机制含义**：**进程即隔离单元**。一个客户端/一个房间的异常（崩溃、内存泄漏、慢消息）只炸它自己那个 BEAM 进程，由监督树重启，不影响其它连接。BEAM 进程极轻量（数百字节起，可达百万级并发进程）——这是「**单进程能扛百万连接**」的根本，非某条优化魔法。

**（c）官方规模宣称 + fastlaning**：
- Channels 指南原文：「**Phoenix Channels 可在单台机器上以可接受的延迟支撑数百万订阅者，每秒转发数十万条消息**；增加集群节点可进一步放大。」机制：本地 PubSub 把消息发给本机订阅者；集群有其它节点时，本地 PubSub 转发到它们的 PubSub，再由各自发给自己订阅者——「**每多一个节点只需多发一条消息**，加节点性能代价可忽略，而每个新节点能多承载大量订阅者」。【实测：`guides/real_time/channels.md`（引用的 2M 连接博客 phoenixframework.org 本环境未直抓，标注）】
- **fastlaning（关键）**：PubSub 允许自定义 dispatcher；Phoenix Channels 用自定义 value 实现 fastlaning——「**向成千上万甚至百万用户广播的消息只编码一次，直接写入 socket，而不是按每个 channel 逐一编码**」。【实测：`phoenix_pubsub/lib/phoenix/pubsub.ex`「Custom dispatching」段】
- **含义**：「避免单个热进程」= (a) 每房间/每连接独立进程天然分片；(b) 广播走 PubSub 分区 shard（`pool_size`）摊「一次广播」到多进程；(c) **fastlaning 把 O(N 用户) 序列化降为 O(1) 编码 + N 次 socket 写**。**直接对治合鸣 WsHub「同 run 共享序列化 + 16ms 批量 flush」在慢客户端下的放大**（架构 §3.2）。

**（d）PubSub：默认 PG2（分布式 Erlang），Redis 是可选后端**：
- `phoenix_pubsub` 两后端：**`Phoenix.PubSub.PG2`（默认，随包）**用 Distributed Elixir（Erlang 分布式）在服务间直接交换通知，支持 **`:pool_size`（默认 1）把 shard 分池**；**`Phoenix.PubSub.Redis`**（需 `phoenix_pubsub_redis` 依赖）用 Redis 交换。**注意：默认 PG2（进程内/分布式 Erlang）而非 Redis**——Redis 是「跨异构节点」时才用的可选 adapter。【实测：`pubsub.ex`「Adapters」段 + `pg2.ex` L63-97（pool_size 默认 1、groups 分片）】
- **机制含义**：单节点内广播走本地（PG2 进程组，零网络）；跨节点走 Erlang 分布式（PG2）或 Redis（可选）。**合鸣单点 relay 阶段只需「Local」等价物（进程内 pub/sub 或 Redis pub/sub）；将来多副本再引入 Redis/分布式 adapter，且用 `pool_size` 分片避免单一大进程成为广播瓶颈。**

**（e）Presence = 每节点副本 + 心跳 + 版本号的集群状态副本（非中心在线表）**：
- `Phoenix.Presence`（`lib/phoenix/presence.ex`）本质「**一个 supervisor + 一个实现 `Phoenix.Tracker` 行为的模块，用 PubSub 广播 presence 变更**」，「**在集群间透明复制**」。`track/3` 在 channel join 后把自己进程登记为该 user 的 presence（带 metadata），实时推 `presence_state`/`presence_diff`（diff 含 `:joins` 与 `:leaves`）；`fetch/2` 回调**「一次性」批量拉取需要补全的数据**（如用户详情），避免 N+1。【实测：`presence.ex` + `guides/real_time/presence.md`】
- **Tracker 底层**（`phoenix_pubsub/lib/phoenix/tracker/*`）：`replica.ex` 每节点维护 **Replica（name + `vsn` 版本号 + `last_heartbeat_at` + status `:up/:down/:permdown`）**；`put_heartbeat/1` 刷新心跳并 bump vsn；`detect_down/3` 按 downtime 判定 temp down / permdown（超 `perm_interval` 才真正删除）。即「**每节点一份带版本号的状态副本 + 周期心跳 + 版本向量**」实现最终一致跨节点 presence。相关：`state.ex`（权威状态节点）、`shard.ex`（分片）、`delta_generation.ex`（diff）、`clock.ex`（逻辑时钟）。【实测：`tracker/replica.ex` + `tracker/` 目录】
- **机制含义**：Presence **不是「问中心服务器某人在线吗」，而是「每个节点都持有一份带版本号的状态副本，靠心跳+版本收敛」**。**合鸣做「在线状态 / 谁在看会话 / AI agent 活跃指示」可借鉴：状态随进程生命周期自动登记（join=上线、进程退=离线，无需显式 ping），用 replica+心跳+版本在副本间收敛，避免中心化在线表成热点与单点**——与 §2.3 OpenIM「Redis ZSET + Lua 翻转才广播」同思路不同实现。

**（f）监督树 = 故障隔离**：整套由 supervisor 串成（`Endpoint.Supervisor`、`Socket.PoolSupervisor`（分区 `DynamicSupervisor`，`:one_for_one`）、Presence supervisor、PubSub supervisor）。channel 进程 `restart: :temporary`，连接断开即静默回收，不触发告警。【实测：`endpoint/supervisor.ex`、`pool_supervisor.ex`、`channel/server.ex`】

**Phoenix 可借鉴点（机制级）**：
1. **每连接/每房间 = 独立轻量进程（GenServer，one channel per client per topic）+ 池分区（phash2 → N 个 DynamicSupervisor）**：合鸣每个「房间消息循环 / 每个活跃长连接 / 每个 AI agent 会话」应是**可独立崩溃、独立重启的隔离单元**。Node 侧对应「每房间/每连接一个受监督的异步流 + 顶层看门狗」，池分区摊平负载。**对治架构 §5.2「半开 socket 常驻、runSubs 堆积」（无死连接回收 🟠）**。
2. **进程即隔离 + 监督树 `:one_for_one` 只重启坏的那个**：故障半径压到最小单元，单房间/单 agent 崩溃不波及全局。合鸣单进程无法「进程隔离」，但可做到「**每个连接的处理是独立可取消任务 + 一个连接序列化抛错跳过该连接而非中断整批**」（架构 §3.2 隐患）。
3. **Presence 用「每节点副本 + 心跳 + 版本号」做分布式在线态，而非中心在线表；配 `fetch/2` 一次性批量补全避免 N+1**：合鸣在线/活跃状态随进程生命周期自动登记、用 replica+心跳收敛（§2.3 OpenIM 同思路）。**10k 前「设备在线状态可跨实例」的另一种实现路径**。
4. **PubSub 分片广播 + fastlaning（编码一次、写 N 次 socket）+ `pool_size` 分片**：群发/广播把「一次序列化」与「N 次 socket 写」解耦，`pool_size` 避免单广播进程成瓶颈。**合鸣 WsHub「同 run 共享序列化 + 16ms 批量 flush」可借鉴 fastlaning——序列化与 socket 写解耦，慢客户端只拖慢自己的 socket 写，不拖慢编码**。单点阶段本地 pub/sub，多副本再上 Redis/分布式 adapter。
5. **铁律「别把共享可变状态塞进一个进程」**：Phoenix 可扩展性来自「**状态分散在百万个无共享进程里，跨进程只靠消息**」，非靠锁或大表。合鸣单进程 hub 里，凡「房间状态 / 在线态 / 未读计数」都应外置为「每会话独立结构 + 快照/副本」，避免一个全局可变大对象成争用与崩溃放大器。**对治架构 §5.4「无界内存态清单（rateLimitStore/dedup/eventWaiters/userSockets/runSubs）」。**

---

## 4. 可对标开源系统 2025-2026 现状

> 全部 stars / 最近推送 / 语言来自 `gh api` 实时元数据（2026-09-05）。**方法论：看 `pushed_at` 而非 stars**（见 §3.3 教训）。

### 4.1 OpenIM（openimsdk/open-im-server）—— 最值得对标的开源 IM

- **16,634 stars，pushed 2026-09-02（活跃），Go，Apache-2.0**。微服务（gateway + msg/msgtransfer/push/auth/user/group/conversation 多个 rpc 服务），支持 Kafka，宣称百万级用户/亿级消息。【实测：gh api】
- 机制级拆解（消息管线 / seq / presence / 群扇出 / 存储）已在 **§2.2–2.4** 完整展开（本调研核心对标）。一句话：**OpenIM 把「每会话 seq + 三链路解耦 + 批量分桶 + presence 外置」做成完整可运行开源实现，是合鸣从单进程走向可扩容时最该逐行读的代码。**
- **协议独立仓**：`openimsdk/protocol`（proto 单独维护，与 server 解耦）——值得合鸣借鉴：**把消息协议（WsEnvelope/device-messages）抽成独立包并严格版本化**，直接对治「relay 五份协议漂移」（架构 §3.5）与「shared 三源」（架构 §1.4）。

### 4.2 其他可对标系统（按可信度 + 相关性排序）

1. **NATS（nats-io/nats-server）**—— 20,664 stars，pushed 2026-09-04，活跃，生产级。定位「实时总线」非 IM，但**是合鸣「进程内队列 → 跨实例总线」升级路径最合适中间档**（比 Kafka 轻、比裸 Redis pub/sub 可靠，JetStream 持久化、KV 版本键值）。【实测元数据；机制点公开架构】
2. **Sharkord（Sharkord/sharkord）**—— 2025 新（created 2025-10-14），1,484 stars，pushed 2026-09-04，TypeScript（Bun），topics `bun/mediasoup/webrtc/messaging/self-hosted/data-ownership`。定位「为小团队的轻量自托管聊天 + 音视频」。**2025 之后「小团队自托管 IM」方向最值得关注的新项目**（与合鸣定位最接近）。机制点：mediasoup（WebRTC SFU）承载音视频 + Bun 实时能力做信令/聊天 + 数据自持。【元数据实测；音视频机制点据 topics 推断】
3. **Edgechat（aozorae/Edgechat）**—— 2026 新（created 2026-04-05），504 stars，pushed 2026-09-05（当日在推），Cloudflare Workers。定位「跑在边缘的团队聊天」。卖点「边缘」——实时消息大概率靠 Workers 的 **Durable Objects（每会话一个 DO 做状态/扇出）+ Hibernation**（低成本长连接）。**与合鸣「自托管单进程」完全相反的取舍（边缘托管 vs 自托管）**，可作「若未来去单点/托管」时的对标，非直接照搬。【元数据实测；DO/Hibernation 推断】
4. **Elixir / Phoenix 侧**—— 无独立持续维护的「elixir-im」产品（该名 404）。可信参考：`dwyl/phoenix-chat-example`（819 stars，pushed 2026-09-03，活跃）、`chrismccord/phoenix_chat_example`（704 stars，**pushed 2022 停更**）。**参考示例非生产 IM**，价值在「另一种并发模型对标」（§3.4），对单进程 Node 直接可借鉴度低于 OpenIM。【元数据实测】
5. **conduit / conduwuit / Tuwunel（Rust 轻量 Matrix）**—— 谱系与现状见 §3.3a（`conduitp/conduit` 404、`girlbossceo/conduit`→`x86pup/conduwuit`→官方继任者 **Tuwunel** 活跃）。Rust 轻量多节点方向，与合鸣「单实例自用」匹配度低于 OpenIM。【元数据实测】

### 4.3 合鸣可借鉴（机制级）

1. **对标优先级：OpenIM（逐行读 seq/三链路）> NATS（扩容换 broker）> Sharkord（定位最接近的 2025 新项目，跟踪取舍）> Phoenix（并发模型参考）**。工程时间押在「读懂 OpenIM `internal/rpc/msg` + `internal/msgtransfer`」，不广撒网。
2. **协议独立仓 + 严格版本化**（借鉴 OpenIM `protocol` 独立仓）：`@ensemble/shared` 的 WsEnvelope / device-messages **抽成只含协议 + zod schema 的独立包、锁版本、禁业务代码混入**——对治「shared 三源」「relay 五份协议漂移」（架构 §1.4/§3.5）的结构性解法，零运行时成本（P1，见 §7）。
3. **看 `pushed_at` 选型**：任何引入的第三方（NATS/mediasoup/ntfy 等）都看最近推送日期，**不引已停更的**（Synapse/Dendrite/chrismccord 示例都是「stars 高但停更」反例）。写进合鸣选型 checklist。
4. **Edgechat Durable Objects「每会话一个有状态对象」是「seq 外置 + 会话本地化」的边缘版**：即使不上边缘，「**每会话一个自包含状态单元（seq + 最新 N 条 + 订阅者）**」的建模对合鸣有用——把「会话」做成自包含单元，seq/未读/在线都挂在会话单元上，而非散落全局表。与 §2.2「按会话哈希分桶」一致。

---

## 5. relay / 中继拓扑：多 relay 一致性 + 设备互联 handoff

### 5.1 多 relay 一致性工业范式：Nostr 的「event.id 去重」

合鸣 relay 单点（内存离线队列，重启丢消息，架构 §3.5）根本问题是「**一致性靠 relay 共享内存态**」。工业界解决「多个不可信/独立节点」一致性的干净范式是 **Nostr**（`nostr-protocol/nips`）：

- **每条事件带全局唯一 `id = sha256(规范化的 [pubkey, created_at, kind, tags, content])`**，签名 `sig` 就是对这个 `id` 的签名。【实测：`nostr-protocol/nips/01.md`】
- **客户端同时连 N 个 relay，发布广播到多个、订阅从多个收，按 `event.id` 去重**——**relay 之间不需要互相同步/对齐**，一致性由「客户端按内容哈希去重」在边缘达成。**relay 是「哑存储 + 转发」，不承担一致性责任。**【实测：NIP-01 + NIP 系列多 relay 模型】

**正是合鸣 relay 应走的方向**：把 relay 从「共享内存态的一致性锚点」降级成「**哑转发 + 短期缓冲**」，一致性上移到「**每条设备事件带全局唯一 id（sha256 规范化内容）+ 客户端按 id 去重 + 按 seq 补拉**」。这样：多 relay 不用 relay 间同步（Nostr 模型）；relay 重启/切换不丢「已确认」消息（客户端已有 id 去重 + seq 补拉兜底，relay 队列只是「加速」非「唯一来源」）；**直接对治架构 §3.5「relay 重启 = 24h 内未达消息全丢」+「桌面端 relay-client 重连后没有补拉 relay 队列的协议」**。

### 5.2 设备互联（手机-桌面）handoff 工业实践

合鸣手机-桌面互联（device-link，架构 §3.5、`device-link-plan`）要做「Handoff 接力」。工业界两条主线：

**（a）「续传式 handoff」（Discord RESUME / Slack ack，§3.1/3.2）**：handoff 不是「状态迁移」，而是「**新设备用 (sessionId + maxSeq) 续传**」。手机把「会话标识 + 本地 maxSeq + handoff token」交给桌面，桌面用这套凭据向 server 续传——**server 不需要在设备间搬移任何状态**，只认 sessionId + seq。最轻量可靠，因为状态永远在 server/DB（seq 外置前提）。**前提是 §2.2 seq 补拉先修好**——没有 seq，handoff 只能搬全量状态（重、易错）。

**（b）「事件流 handoff」（Nostr 模型 + IM seq）**：把「handoff 进度」本身建模成事件流里一条（`device.handoff {fromDevice, toDevice, convId, maxSeq, ts}`），走正常消息管线（seq 分配 + 持久化 + 去重 id）。**handoff 事件可重放、可审计、可多设备并发**（两台设备同时 claim 同一 conv 时按 seq/时间戳裁决）。比「设备间直接握手」健壮，**天然复用合鸣现有消息管线**（不给 relay 加 handoff 专用逻辑）。

**（c）推送门铃（device-link-plan 记忆 L3）**：handoff 触发时（手机锁屏/切后台），server 向桌面发一条**离线推送**（ntfy/Expo，架构 §3.3）唤醒桌面进入「接力待命」。**把 handoff 与合鸣已有 push 通道打通**——push 不只是「通知有新消息」，还是「handoff 唤醒信号」。

### 5.3 relay 鉴权与拓扑加固（1k 设备规模前）

- **per-device token 替代共享密钥**：当前 relay 用 `RELAY_AUTH_KEY`（所有设备同一密钥，架构 §3.5，timingSafeEqual）。**任何一台设备被攻破 = 全设备身份可冒充**。1k 设备前应改 **server 签发的 per-device 短期 token**（Slack `apps.connections.open` 一次性 WSS URL 范式，§3.2）：设备先向 server（已有用户 session 体系）认证，server 签发绑定 `deviceId + 过期时间 + scope` 的短期 token，relay 校验该 token（验 server 签名）而非共享密钥。**把「身份」从 relay 上移到 server，relay 回归哑转发。**【对应架构 §5.3 P1】
- **relay 拓扑：单点 → 可水平扩**：有了「event.id 去重 + seq 补拉 + per-device token」，relay 可**水平扩**（多 relay 实例，客户端按负载/就近连任意一个，一致性由去重+补拉兜底，Nostr 模型）。**当前单点是「缺了去重/补拉/token 三件套」的被动结果，非拓扑本身的错**——补上三件套，单点自然可扩多节点。

### 5.4 合鸣可借鉴（机制级）

1. **relay 降级「哑转发 + 短期缓冲」，一致性上移客户端（id 去重）+ server（seq 补拉）**（Nostr 范式）：`device-messages` 每条设备事件加 `id = sha256(规范化内容)`，客户端（手机/桌面）按 id 去重；relay 队列从「唯一来源」降为「加速缓冲」。**对治「relay 重启丢消息 + 五份协议漂移」根治方案**（P1，见 §7）。
2. **handoff = 续传，不是状态迁移**（Discord RESUME / Slack ack 范式）：handoff 事件带 `{fromDevice, toDevice, convId, maxSeq, handoffToken}`，目标设备用 (sessionId + maxSeq) 向 server 续传。**前提：seq 外置先修好（§7 P0）**。handoff 事件走现有消息管线（seq + id + 持久化），不新增 relay 专用逻辑。
3. **per-device 短期 token 替代 RELAY_AUTH_KEY**（Slack 一次性 WSS URL 范式）：server 签发绑定 deviceId 的短期 token，relay 验签。**1k 设备前 P1 安全项**，与 ntfy 安全整改（架构 §6 P1-6）同批。
4. **push 通道复用为 handoff 唤醒信号**（device-link-plan L3）：handoff 时 server 向目标设备发离线推送（ntfy/Expo）唤醒接力待命。**打通现有 push 与 device-link，零新组件**。
5. **多 relay 是「三件套齐备后的自然结果」，非当前目标**：当前先把「id 去重 + seq 补拉 + per-device token」做对（单 relay 也受益——重启不丢、协议收敛），**多 relay 水平扩是三件套自然延伸，不要反过来先上多 relay 再补一致性**。

---

## 6. 横切观察：五条主线其实是一条

把 §1–§5 的「合鸣可借鉴」摊开，反复收敛到**同一底层模型**：

> **每条消息可寻址（每会话单调 seq）+ 可去重（全局唯一 id）+ 可补拉（按 seq 区间 + isEnd）；状态（在线/已读/handoff 进度）外置到可跨实例存储并「翻转才广播」；扇出/持久化/推送三链路用可插拔队列解耦；连接恢复幂等续传（seq/session）而非全量重建。**

这个模型**不需要 Kafka、不需要多语言、不需要换框架**——可在合鸣现有 Express + node:sqlite + socket.io/ws 上，以「先修地基（seq/补拉）→ 再解耦（三链路+队列）→ 最后外置（Redis/NATS 扩容）」的顺序渐进落地。这也解释 §7 的 P0 全部是「修现有地基」而非「引入新组件」：**地基（seq + 幂等消息）不修好，上面所有并发/扩容/handoff 都是空中楼阁**（与架构文档 §5.4 判定完全一致）。

---

## 7. 合鸣落地优先级建议（P0 / P1 / P2）

> 前提共识（与架构文档 §6 一致）：地基没修好前讨论扩容是空中楼阁。**P0 全部「修现有地基、不引入新组件」**。每项标注解开的 §5 扩展性瓶颈与对应架构债。

### P0（地基修复，1–2 周，不引入新组件）

- **P0-1 每会话单调 seq 外置 + 补拉协议**（§2.2、§7 主线）：`chat_messages` 加 `(conversation_id, seq)`；seq 存 `(conversation_id, curr_seq)` 一行或 DB 自增，写时「Malloc 一段 + 批内连续校验」；加 `GET /conversations/:id/seq`（返 maxSeq）+ `GET /conversations/:id/messages?begin=&end=`（返消息 + isEnd）。客户端上线/重连/gap 按区间补拉。
  - **解开**：架构 §4.1「WS seq 链」🔴（被 f4e02cd 打死）+ §5.2「seq 分配假设单进程」+ §5.1 群广播写放大。**这一项同时是 §5 设备 handoff、§3 连接续传、§2 背压降级的前置闸门**——三赢地基。
  - **注意**：与架构文档 P0-1「恢复 f4e02cd 回退」是**同一件事两面**——恢复 store.ts/sqlite.ts 的 seq 方法 + 把 seq 补拉接口修对，应作为一批。
- **P0-2 幂等消息 id（sha256 规范化内容）**（§3.2 Slack、§5.1 Nostr）：每条 IM/设备消息带 `msg_id`（或 sha256），客户端按 id 去重。**零成本但解决重连重复 + 多设备重复**，是 relay 去重（P1）地基。
- **P0-3 maxSeq / hasReadSeq 分离 + 已读回执走同一管线**（§2.2c）：已读作为事件流经现有 WsHub 扇出，落库更新 `(conv, user) → has_read_seq`。一条 SQL + 一次广播。
  - **三项合起来 = 把「message seq + 幂等键 + 状态字段 + 已送达回执」（im-gap-analysis 定的 P0）真正修对**，全部不引入新组件。

### P1（解耦 + 收敛，2–4 周，进程内组件，不引入外部 broker）

- **P1-1 在线/离线/持久化/推送 三链路用进程内队列解耦**（§2.5、§2.4）：抽「进程内队列（key=会话键）」，把「持久化（攒批+按会话哈希分桶+事务批量 INSERT）」与「离线推送」变异步消费者，扇出走内存连接表。**对治架构 §3.2 WsHub 五职责挤爆 + §5.4「无队列」**。队列接口按 OpenIM「可插拔 broker」设计（`memamq` 形态），为 P2 换 NATS 留缝。
- **P1-2 relay 降级哑转发 + 收敛单通道**（§5.4、架构 §3.5/§6 P2-8）：relay 加 event.id 去重、队列从「唯一来源」降为「加速缓冲」；relay 消息面向 WsEnvelope 收敛；移动端双连接客户端（connection.ts / wslink.ts）二选一。**对治「relay 五份协议漂移」+「双通道双协议面」**。
- **P1-3 relay per-device 短期 token 替代 RELAY_AUTH_KEY**（§5.3）：server 签发绑定 deviceId 的短期 token，relay 验签。**1k 设备前 P1 安全项**，与 ntfy 安全整改（架构 §6 P1-6）同批。
- **P1-4 WsHub 拆域 + 每连接独立生命周期**（§3.4 Phoenix、§3.3e Matrix workers）：按域拆 run-hub / im-hub / signal-hub；每连接加 isAlive 心跳驱逐 + close 时彻底清所有索引（runSubs/wsDevices/userSockets）。**对治架构 §4.1「无死连接回收」🟠 + §5.2 半开 socket 累积 + runSubs 堆积**。
- **P1-5 背压分级降级（依赖 P0-1 seq）**（§2.4、§3.1 Discord）：慢客户端背压时「暂停推、让它落后、靠 seq 追平」而非「丢 chat.message」；按优先级分级（HITL/kick/IM 分级，借鉴 WebTransport sendOrder）。**对治架构 §3.2「背压丢 chat.message 且无补拉 = 永久丢失」P1**——**前提 P0-1 seq 补拉已修好**。

### P2（外置 + 扩容 + 前瞻，按需，引入外部组件）

- **P2-1 seq / 在线状态外置 Redis（或 DB nextval）**（§2.3 OpenIM presence、§3.3e Matrix 多实例）：seq 从单进程内存/单行 → Redis（或 DB `BEGIN IMMEDIATE`/nextval）；在线状态从单进程内存 → Redis ZSET + Lua 翻转才广播。**10k 前「seq 外置 + 在线状态可跨实例」最小实现**（架构 §5.2 判定的 10k 三件事之一）。
- **P2-2 队列升级 NATS JetStream（跨实例）**（§2.1、§4.2）：进程内队列 → NATS（subject=会话、queue group=在线节点、JetStream 持久化、KV 存 seq/最新）。**仅「IM 网关独立成多实例」时引入**（架构 §5.2「10k 正确形态」）。
- **P2-3 IM 网关独立（hub + relay 合并成消息网关，SQLite 只留业务库）**（架构 §5.2）：10k 真正门槛是单进程 WS 非 SQLite。**先 P0/P1 把单进程做到 1k 无瓶颈，再考虑网关独立**——不要提前拆。
- **P2-4 评估 WebTransport 数据报支路（移动端实时状态/视频信令）**（§1）：仅对「延迟敏感且可丢」支路，不动 IM 主面。**需 server 加 UDP/443 端点（nginx quic 模块或 Go quic-go 边车）——当前无地基，纯前瞻**。
- **P2-5 协议独立仓 + 严格版本化**（§4.1 OpenIM protocol、架构 §1.4）：WsEnvelope/device-messages 抽独立包、锁版本、禁业务代码混入。**结构性对治「shared 三源」+「协议漂移」**，可与 P1-2 合并或作为其收尾。
- **P2-6 移动端 Android 16 / ms() 白屏**（架构 §6 P0-3）：**与网络调研无关，但同属 P0 级事故**，列出保持 §7 完整——应由移动端会话处理，不在本报告范围。

**一句话排序**：先 P0（seq + 幂等 id + 已读分离，把地基和 im-gap 的 P0 一起修对）→ 再 P1（三链路解耦 + relay 收敛 + per-device token + WsHub 拆域，全进程内）→ 最后 P2（Redis/NATS 外置 + 网关独立 + WebTransport 前瞻）。**P0 不解开，P1/P2 不启动**——避免「地基未修就讨论扩容」的空中楼阁。

---

## 8. 来源清单

> 说明：本环境 WebSearch/WebFetch/非 GitHub curl 均不可用（WebSearch 返空、WebFetch 域名无法验证、discord.com/core.telegram.org/datatracker 等 curl exit 000）。**全部事实经官方 GitHub 仓库（`raw.githubusercontent.com` 源码 + `gh api` 实时元数据）取证**；`【实测】`= 直接读到源码/配置/元数据，`【文档/推断】`= 公开架构常识或据代码结构推断。被反爬拦截的非官方页面（Discord 开发者文档、Telegram core 文档、NATS/Phoenix 官网、caniuse）均回落官方 GitHub 源交叉核实并标注。

### 传输层（§1）
- W3C WebTransport 规范：https://github.com/w3c/webtransport （`index.bs`、`explainer.md`、`explainers/subprotocol_negotiation.md`；session=HTTP/3 over QUIC 回退 H2/TCP；reliability "supports-unreliable" vs "reliable-only"；streams + datagrams；sendOrder + WebTransportSendGroup 分层调度；对 WebSocket HOLB 的官方表述）【实测】
- quic-go（QUIC/HTTP3/WebTransport 参考实现）：https://github.com/quic-go/quic-go （QUIC v2 RFC 9369、HTTP/3 RFC 9114、webtransport-go、masque-go CONNECT-UDP）【实测】
- WebTransport 移动端/RN 支持现状：【文档/推断】（Chrome 桌面+Android 支持；iOS Safari/RN WebView 不完整——本环境无法直查 caniuse，标注公开常识，未逐源核实）

### 高并发 fanout（§2）
- OpenIM 仓库/元数据：https://github.com/openimsdk/open-im-server （16,634 stars，pushed 2026-09-02，Go，Apache-2.0）【实测】
- OpenIM Kafka 主题：`docs/contrib/kafka.md`（latestMsgToRedis / msgToPush / offlineMsgToMongoMysql，各 8 分区）、`config/kafka.yml`【实测】
- OpenIM seq/补拉/已读：`internal/rpc/msg/seq.go`、`internal/rpc/msg/sync_msg.go`（PullMessageBySeqs / GetSeqMessage / isEnd）、`internal/rpc/msg/send.go`、`pkg/common/storage/cache/redis/seq_conversation.go`（CURR/TIME、Malloc 批量分配）、`pkg/common/storage/controller/msg_transfer.go`（BatchInsertChat2Cache→Malloc）、`controller/msg.go`（BatchInsertBlock seq 校验）【实测】
- OpenIM presence/群扇出/离线推送：`internal/rpc/user/online.go`、`pkg/common/storage/cache/redis/online.go`（ZSET + Lua + OnlineChannel）、`internal/msggateway/user_map.go`、`internal/push/onlinepusher.go`（逐 gateway gRPC 广播）、`internal/push/push_handler.go`（shouldPushOffline / onlineCache）【实测】
- OpenIM 批量分桶 + MQ 抽象：`internal/msgtransfer/online_history_msg_handler.go`（batcher size/worker/interval + hash(conv)%worker + doSetReadSeq）、`openimsdk/tools`（`mq/mq.go` 接口、`mq/memamq/queue.go` 内存后端）【实测】
- OpenIM 协议独立仓：https://github.com/openimsdk/protocol （`msg.proto` Seqs/maxSeq/hasReadSeq/MarkConversationAsRead、`push.proto`）【实测】
- NATS：https://github.com/nats-io/nats-server （20,664 stars，pushed 2026-09-04；subject + queue group、JetStream、KV）【实测元数据；机制点公开架构】
- Redis Sharded Pub/Sub：https://github.com/redis/redis （`src/commands/pubsub-shardchannels.json`、`tests/cluster/tests/25-pubsubshard-slot-migration.tcl`、`tests/cluster/tests/09-pubsub.tcl`）【实测】

### 标杆系统（§3）
- Discord（discord.py 源码）：https://github.com/Rapptz/discord.py （`discord/gateway.py` 13 个 opcode、`heartbeat_interval`、GatewayRatelimiter 110/min、`compress=15`、`resume_gateway_url`、`RESUME{seq,session_id}`、DEFAULT_GATEWAY wss://；`discord/client.py` ExponentialBackoff；`discord/backoff.py` `rand(0, base·2^exp)` 封顶 2^10 重置 2^11）【实测】
- Discord（discord.js 分片）：https://github.com/discordjs/discord.js （`packages/util/src/functions/calculateShardId.ts`、`packages/ws/src/strategies/sharding/IShardingStrategy.ts`、`apps/guide/content/docs/legacy/sharding/`）【实测】
- Discord 4096B 单帧硬限：【文档】（Discord 开发者文档已知硬限，本环境 discord.com 被反爬拦截无法直读；周边机制经 discord.py 交叉核实，此值标注文档事实）
- Slack Socket Mode：https://github.com/slackapi/node-slack-sdk （`packages/socket-mode/src/SocketModeClient.ts`：envelope + ack、autoReconnectEnabled、numOfConsecutiveReconnectionFailures、reconnectionTimer、disconnect sentinel、`apps.connections.open`）【实测，pushed 2026-09-05】
- **Matrix 现状（官方三大全部停更/归档）**：
  - https://github.com/matrix-org/synapse （**archived=true**，pushed 2024-04-26，latest v1.98.0，develop，12,107 stars）【实测】
  - https://github.com/matrix-org/dendrite （**archived=true**，pushed 2024-11-25，v0.13.8，移交 Element）【实测】
  - https://github.com/element-hq/dendrite （Dendrite 现维护地，活跃，pushed 2026-07-27，965 stars）【实测】
  - https://github.com/girlbossceo/conduit （redirect → `x86pup/conduwuit`，archived，pushed 2026-05-29，24 stars；`conduitp/conduit`、`conduit-py/conduit` 404）【实测】
  - https://github.com/matrix-construct/tuwunel （conduwuit 唯一官方继任者，Rust，pushed 2026-09-04，2,490 stars，活跃）【实测】
  - https://matrix.org/blog/2023/11/06/future-of-synapse-dendrite/ （官方停更背景，未直抓）
- **Matrix 联邦/同步/状态机制（spec + Synapse 源码，可直读 GitHub）**：
  - https://github.com/matrix-org/matrix-spec/blob/main/content/server-server-api.md （PDU/EDU/Query 三类通信单元、Transaction、prev_events DAG、7 道检查、federation v1 端点清单）【实测】
  - https://github.com/matrix-org/matrix-spec/blob/main/data/api/server-server/transactions.yaml （`PUT /send/{txnId}`、txnId 幂等 single-flight）【实测】
  - https://github.com/matrix-org/matrix-spec/blob/main/data/api/client-server/sync.yaml （/sync 的 since/timeout/full_state/set_presence/use_state_after）【实测】
  - https://github.com/matrix-org/matrix-spec/blob/main/content/rooms/v9.md （v9 事件 ID / v2 state resolution / Canonical JSON）【实测】
  - https://github.com/matrix-org/synapse/blob/develop/synapse/state/v2.py （状态解析 v2，heapq 归并）；`/synapse/state/v1.py`（v1）；`/synapse/storage/databases/state/`（state_group 存储层）【实测】
  - https://github.com/matrix-org/synapse/blob/develop/docs/workers.md （worker 拆分、共享 Postgres、Redis 复制流/缓存）；`/docs/replication.md`（单写者+追加日志动机）；`/docs/tcp_replication.md`（复制协议细节）【实测】
  - https://matrix.org/blog/2020/11/03/how-we-fixed-synapses-scalability （官方扩展概述，未直抓）
- **Elixir Phoenix（未归档、活跃 v1.8.13 / 2026-09-04）**：
  - https://github.com/phoenixframework/phoenix ；https://github.com/phoenixframework/phoenix_pubsub （独立 PubSub 包，活跃）【实测元数据】
  - https://github.com/phoenixframework/phoenix/blob/main/lib/phoenix/channel/server.ex （`use GenServer, restart: :temporary`，进程标签）【实测】
  - https://github.com/phoenixframework/phoenix/blob/main/guides/real_time/channels.md （每客户端每 topic 一进程、PubSub 转发、百万连接宣称）【实测】
  - https://github.com/phoenixframework/phoenix/blob/main/lib/phoenix/socket/pool_supervisor.ex （DynamicSupervisor 分区、phash2、:one_for_one）【实测】
  - https://github.com/phoenixframework/phoenix/blob/main/lib/phoenix/presence.ex （Presence 行为、track/fetch、diff）+ `/guides/real_time/presence.md`（跨集群透明复制）【实测】
  - https://github.com/phoenixframework/phoenix_pubsub/blob/main/lib/phoenix/pubsub.ex （PG2 默认 / Redis 可选、dispatcher、fastlaning、pool_size 迁移）；`/lib/phoenix/pubsub/pg2.ex`（pool_size 默认 1、groups 分片）【实测】
  - https://github.com/phoenixframework/phoenix_pubsub/blob/main/lib/phoenix/tracker/replica.ex （Replica 心跳 + vsn + detect_down）+ `/lib/phoenix/tracker/`（state/shard/delta_generation/clock）【实测】
  - https://github.com/phoenixframework/phoenix/blob/main/lib/phoenix/endpoint/supervisor.ex （Endpoint 监督树）【实测】
  - https://phoenixframework.org/blog/the-road-to-2-million-websocket-connections （官方 2M 连接博客，指南内引用，未直抓）
  - Phoenix 参考示例：https://github.com/dwyl/phoenix-chat-example （819 stars，pushed 2026-09-03 活跃）、https://github.com/chrismccord/phoenix_chat_example （704 stars，**pushed 2022 停更**）【实测元数据】

### 开源对标 2025-2026（§4）
- OpenIM：https://github.com/openimsdk/open-im-server （见 §2）【实测】
- NATS：https://github.com/nats-io/nats-server （20,664 stars，pushed 2026-09-04）【实测】
- Sharkord：https://github.com/Sharkord/sharkord （2025-10-14 created，1,484 stars，pushed 2026-09-04，TypeScript/Bun，topics: bun/mediasoup/webrtc/self-hosted）【实测元数据；音视频机制点推断】
- Edgechat：https://github.com/aozorae/Edgechat （2026-04-05 created，504 stars，pushed 2026-09-05，Cloudflare Workers）【实测元数据；Durable Objects/Hibernation 推断】
- Phoenix 示例 + conduit/conduwuit/Tuwunel（见 §3/§4.2）【实测】

### relay / handoff（§5）
- Nostr NIP-01（event.id = sha256(规范化事件) + sig 对 id 签名 + 多 relay 按 id 去重）：https://github.com/nostr-protocol/nips （`01.md`）【实测】
- Nostr 多 relay 一致性模型（relay 哑存储、客户端边缘去重、relay 间不同步）：【文档/推断，NIP 系列公开模型】
- Slack `apps.connections.open` 一次性 WSS URL / per-device token 范式：https://github.com/slackapi/node-slack-sdk （`SocketModeClient.ts`）【实测】
- Discord RESUME 续传式 handoff：https://github.com/Rapptz/discord.py （`gateway.py`）【实测】
- Telegram MTProto 多 DC 架构：【未能核验】（core.telegram.org 本环境被反爬拦截，curl exit 000；无法直接取证其多数据中心拓扑，不计入已确认事实，仅列此标注待核验）

### 方法学备注
- 子代理独立调研底稿（OpenIM 逐行源码拆解、Matrix+Elixir 进程模型）已并入本报告 §2/§3/§4，其来源清单与本节一致（全部官方 GitHub 源）。
- 本报告所有「实测」均可由 `gh api repos/<owner>/<repo>` 与 `raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>` 复现；`【文档/推断】` 项已明确标注未逐源核实，不做臆断。

---

*附：本报告为纯调研，未修改任何源码。所有「合鸣可借鉴」均为机制级建议，落地前应与架构文档 `docs/analysis-architecture-2026-09-05.md` §6 行动建议对齐（尤其 P0-1 恢复 f4e02cd 回退是 seq 外置的前置闸门）。*
