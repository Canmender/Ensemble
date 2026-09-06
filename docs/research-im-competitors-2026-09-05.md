# IM 竞品调研报告（2026-09-05）

> 面向合鸣 Ensemble（自部署云优先 IM + 多 Agent 编排 + 插件系统 + E2EE；桌面 Electron + Web + RN 移动端；Node/TS + SQLite；目标中小团队自部署）的竞品架构调研。
>
> **方法说明**：WebSearch 工具当日返回空结果、WebFetch 域名校验被网络策略拦截，故全部改用 `gh api`（GitHub 官方 API，已认证）+ `curl`/`requests` 直抓一手来源：GitHub releases/commits/code search、官方 changelog 源文件（`.md` 后缀可直接抓取正文，飞书文档用此法拿到）、官方 docs 站点。所有版本号与发布日期均取自一手来源，抓取时点 2026-09-05（UTC+8）。
>
> **无法直接抓到的域名**（网络策略拦截/超时）：matrix.org、signal.org、rocket.chat、docs.discord.com、discord.com、raw.githubusercontent.com（requests 通道 SSL 失败，已改用 gh api）、open.larksuite.com SPA 正文（改用 .md 后缀绕过）。这些竞品的信息均通过 GitHub 镜像源（element-hq/synapse、signalapp/*、RocketChat/Rocket.Chat、discord/discord-api-docs）补齐，信息完整性不受影响。

---

## 0. 执行摘要（TL;DR）

1. **"消息可靠性三件套"（seq + 幂等 + 多端同步）在头部竞品里已是标配，且机制高度趋同**：OpenIM 的 `maxSeq`/`hasReadSeq` 双游标、Discord Gateway 的 `s` 序号 + resumption、Matrix 的 token 分页 + sliding sync、飞书"用 message_id 而非 event_id 去重"的官方口径——都指向同一个设计：**每会话一个单调递增序号 + 客户端持久化游标 + 重连时按游标补拉**。合鸣的 P0 差距（message seq + 幂等键 + 状态字段 + 已送达回执）方向完全正确，可直接对标这套机制。
2. **E2EE 的主战场已从"消息加密"转向"推送通知加密"和"历史密钥共享"**：Zulip 11.0→12.0 完成了"移动端推送通知 E2EE"的服务器端→客户端 GA 全程（12.1 起可选完全跳过明文推送）；Element 2026-05 上线"加密历史无缝共享"（新成员加入加密房间可安全获得历史密钥，走 to-device 私有消息，密钥不出客户端）。合鸣若做 E2EE 推送，Zulip 的"双轨 + `require_e2ee_push_notifications` 开关 + 按客户端版本决定是否脱敏"是可直接照抄的落地路径。
3. **AI/Agent 集成已出现"原生 MCP 服务端"形态**：Rocket.Chat 8.8.0（2026-09-03）内置 **alpha 版原生 MCP server**（AI Center 开启、minimal/extended 两档工具集、需 AI add-on license + `access-mcp` 权限）——这是"IM 平台自身作为 MCP host 暴露给外部 agent"的第一例，与合鸣"多 Agent 编排"定位直接相关。Mattermost 走的是反向路径（agents 插件作为 MCP/LLM 消费者，把 LLM 能力注入 IM）。两条路径合鸣都应覆盖：既让外部 agent 通过 MCP/A2A 驱动合鸣（Rocket 模式），也让合鸣内置 agent 消费外部 LLM（Mattermost 模式）。
4. **Zulip 悄悄做了"面向 LLM agent 的服务端发现端点"（`/llms.txt`，12.0）**——让 LLM 驱动的 agent 能发现服务器上的 web-public channels。这是"IM 即 agent 编排载体"叙事下被合鸣应该抄的一个极低成本高信号动作。
5. **Matrix 生态 2026 的重大变化是"同步协议代际更替"**：MSC4186（Simplified Sliding Sync）2026-06-29 合入 spec，Synapse 1.156-1.160 持续完善（profile 更新、sticky events、连接锁优化）；Room v11 成为 Synapse 默认版本，v12 房间（不编码 server name 的 room ID）已在测试。Dendrite 实质停更（最后提交 2024-11），conduit 血统分裂为 **tuwunel（matrix-construct，活跃，v1.9.0，2026-08）** 与 timokoesters/conduit 两个分叉。合鸣若考虑 federation 互操作，对接点是 Synapse 1.16x + tuwunel，不是 Dendrite。
6. **自部署许可模式出现"功能模块化收费"新趋势**：Rocket.Chat 9.0.0 起 LDAP/SAML 需 `ldap-enterprise`/`saml-enterprise` license 模块（8.x 仍免费可用但已打 deprecation 警告）；Mattermost 走"开源核心 + 企业版 license 文件"双轨。合鸣"单组织自部署"定位下应警惕：把 SSO（LDAP/SAML/OIDC）划进付费模块会直接伤害中小团队自部署心智，建议保持开源。
7. **存储层正在"去重依赖"简化**：OpenIM 3.8.3 移除 Zookeeper、发现后端可配置（etcd/K8s/Consul）、存储可插拔（MongoDB/MySQL/Postgres/PolarDB）；Signal 服务端在 FoundationDB 上叠加 Redis/Dynamo 队列并加"两存储流一致性度量"。合鸣 Node/TS + SQLite 单体的轻资产定位，应对标 OpenIM 的"可插拔但默认最简"，而不是上 Kafka+etcd 全家桶。

---

## 1. Element / Matrix

### 1.1 核心架构
- **存储**：Synapse（element-hq/synapse，AGPLv3，2023-11 由 Element 从 matrix-org 分叉接手，matrix.org 基金会版本已归档）默认 PostgreSQL（也支持 SQLite 单用户场景），事件溯源（event-sourcing）模型：每个事件是不可变记录，房间状态由事件链推导。2026 年正在**渐进式 Rust 化**：1.156-1.160 期间"客户端事件序列化的同步核心已移植到 Rust"（#19837/#19922）、Rust 代码可直接通过 Python 连接池访问数据库（#19878）、Tokio 运行时/线程池分离（#19868）。
- **推送/同步模型**：传统 `/sync` 长轮询（token 分页）+ **Sliding Sync（MSC4186，2026-06-29 合入 spec）**。Sliding Sync 是移动端同步的代际更替：客户端维护"房间列表窗口"，按关注度滑动拉取，避免全量房间同步；1.160 新增 MSC4262（Sliding Sync 下的 profile 更新，默认关闭）、MSC4354 Sticky Events 经 Sliding Sync 暴露、修复连接懒加载死锁（#19826）、为旧 sliding sync 连接删除加索引（#19912/#19923）。
- **federation 模式**：去中心化服务器互联（server-to-server），`federation_domain_whitelist` 可限制互联域；2026 年瑞典公共部门上线 Matrix federation（Element 博客 2026-05-26）、德国 Deutschland-Stack 采用 Matrix-based ZaPuK（2026-06-30）。

### 1.2 消息可靠性
- 事件不可变 + 每个房间独立 event graph；客户端用 `token`（不透明游标）分页，重连从上次 token 续拉。
- 1.160rc1 修复"stream position（presence/to-device 等）在房间删除后停止下发"、"用户更新 profile 但不属于任何房间时 sync 流不唤醒"（#20003 相关）。
- 幂等：Matrix 用 `txn_id`（per-device 事务 ID）做客户端幂等发送（spec 长期特性，本次未变）。

### 1.3 E2EE 状态
- **MLS（Message Layer Security）spec PR（MSC4186 族 MLS 提案）仍 open 未合入**，Synapse 1.156-1.160 changelog 中 **0 处 MLS 提及**——MLS 服务端尚未生产可用，仍处试点。
- **已落地的是"加密历史无缝共享"**（Element 2026-05-13 博客）：加密房间管理员开启"Members (full history)"后，新成员加入时通过 **to-device 私有加密消息** 接收历史密钥包（key bundles），密钥不经过 homeserver 明文暴露，聊天头显示"是否共享历史"。这解决了 E2EE 房间"新成员白屏"的长期痛点。
- Dehydrated device（MSC3814，脱水设备）支持持续完善（1.155 修"最后设备登出导致脱水设备被误删、离线推送中断"）。

### 1.4 AI/Agent 集成
- 无原生 agent 编排；生态位靠 open standard（任何 agent 可经 Matrix client API 收发消息）。合鸣的"多 Agent 编排"是 Matrix 生态里没有的一等能力。

### 1.5 自部署友好度
- Synapse 1.160.0（2026-09-02）：成熟、文档全、AGPLv3（注意合鸣闭源分发时的 AGPL 传染性风险，若仅自部署不分发则无碍）。
- **Dendrite：实质停更**（最后提交 2024-11-25，release 停在 helm 0.14.x/v0.13.8，2024-09）。
- **conduit 血统**：`matrix-construct/tuwunel`（2490 star，v1.9.0，2026-08-18，Rust 单二进制，QR 登录 MSC4108、URL preview 代理、一次启动迁移）为活跃正统；`timokoesters/conduit`（590 star，2026-08-26 仍有 push）为另一分叉。
- Element Server Suite Pro（ESS Pro，商业）被 Meedio 等用于欧洲主权通信（2026-03）。

### 1.6 2025-2026 动向
- Simplified Sliding Sync 合入 spec（2026-06-29）→ 移动端同步体验代际升级。
- Room v11 成默认（MSC4239，Matrix v1.14），v12 房间（room ID 不编码 server name）实验。
- Rust 化持续推进（序列化核心已 Rust）。
- 主权/政府市场扩张（瑞典 federation、德国 ZaPuK、CGM 医疗）。
- Spaces 登陆 Element X（2026-03-30）：用 Spaces 替代长房间列表做组织化。

### 1.7 合鸣可借鉴（机制级）
- **Sliding Sync 的"房间窗口"概念**：合鸣移动端若房间数增长，可借鉴"按关注度窗口化拉取房间列表 + 房间内消息分页"的两级结构，避免全量 `/sync`。
- **加密历史共享的 to-device key bundle**：合鸣 E2EE 房间若允许新成员看历史，直接抄"经私有 to-device 通道发密钥包 + 房间级开关 + 聊天头标识"三件套。
- **`txn_id` 幂等发送**：合鸣消息发送应带 per-device 幂等键，服务端去重。
- **脱水设备（dehydrated device）**：移动端离线推送不依赖常开连接，可借鉴"服务器侧保留一个轻量设备用于收 to-device/推送"。
- **tuwunel 单二进制自部署**形态 = 合鸣"云优先单组织"的服务器端轻量参照（若未来考虑 federation 互操作，对接 Synapse 1.16x + tuwunel）。

---

## 2. Signal Server

### 2.1 核心架构
- **存储**：主存储 **FoundationDB**（分布式事务数据库），叠加 **Redis / DynamoDB** 作消息队列；近期 commit（2026-09-03）新增"度量 Redis/Dynamo 与 FoundationDB 两存储流是否一致"的 metrics，并"用内容哈希比较消息信封"、"FoundationDB 插入失败不再回退 v4 UUID"（保证 ID 确定性/幂等）。
- **服务拆分**：signalapp org 下可见明确微服务化——`Signal-Server`（主）、`Signal-Calling-Service`（N→N 群组通话媒体转发）、`storage-service`/`storage-manager`（CDN 媒体）、`registration-service`（号码注册）、`key-transparency-server` + `key-transparency-auditor`（密钥透明审计）、`SimpleSignal` 等。
- **协议栈**：仍为 **libsignal（Double Ratchet + X3DH）**；**MLS 未进入生产**（Signal-Server 代码搜 `MlsGroup` 0 结果；libsignal 近 10 条 commit 无 MLS）。后量子方向有独立研究仓库 `SparsePostQuantumRatchet`（SPQR，可与 DH ratchet 并行的分块后量子棘轮，2026-07 仍活跃）。

### 2.2 消息可靠性
- **幂等注册**：2026-09-02 "禁止在已有 MFA key 时幂等重试 numberless 注册"——Signal 把幂等键用于防重复注册/恢复。
- **消息队列**：per-ACI/clear-account 队列，近期"在悲观 ACI 锁下复用 ACI/clear account 队列"（2026-08-27）、队列总量降到 3MB（2026-08-21）——控制单账号内存占用。
- **缺信计量**：2026-09-03 给 "missing messages" 计数器加 `ephemeral` 标签——区分瞬时缺失与持久缺失。
- 群组管理：群消息仍走 per-member 双棘轮（Signal 不采用 group ratchet 共享密钥，牺牲扩展性换前向安全/后向安全上限）。

### 2.3 E2EE 状态
- **全量 E2EE**（消息、通话、群）是 Signal 的立身之本；**密钥透明 + 审计**（key-transparency-server/auditor）是其差异化——用密码学证明"服务器没换我的密钥"。
- MLS 未落地（见上）；Sesame（去号码化身份）仍在早期，未见生产 commit。
- 后量子：SPQR 研究推进中，未进主协议。

### 2.4 AI/Agent 集成
- 无。Signal 定位隐私 messenger，不做 agent 编排。

### 2.5 自部署友好度
- **极不友好**：依赖 FoundationDB + Redis/Dynamo + 多微服务 + 号码注册体系，无官方"一键自部署"，面向 C 端隐私而非团队自部署。

### 2.6 2025-2026 动向
- 工程重心在**可靠性与可观测性**（两存储流一致性度量、缺信计数、队列调优）与**认证加固**（TOTP/MFA 泛化、numberless 账号、TOTP 确认延迟、登录购买 playOptionId）。
- 呼叫链路：libsignal v0.101.0+ call link credentials（2026-08-27）。
- 无 E2EE 协议代际变化（MLS/Sesame 均未生产）。

### 2.7 合鸣可借鉴（机制级）
- **幂等键防重复注册/恢复**：合鸣账号注册/恢复流程应带幂等键 + 状态机，防并发重复。
- **双存储流一致性度量**：合鸣若未来从 SQLite 演进到"本地 + 云端"双写，Signal 的"两存储流 agreement metrics"是可直接抄的可观测性手段。
- **缺信分级（ephemeral vs persistent）**：合鸣消息可靠性监控应区分"瞬时网络缺失"与"持久丢失"，分别告警。
- **密钥透明/审计思路**：合鸣 E2EE 若要建立信任，可借鉴"可审计的密钥变更证明"（但成本高于 Signal 场景，列为远期）。

---

## 3. Rocket.Chat

### 3.1 核心架构
- **存储**：MongoDB 8.0（8.8.0 引擎版本），Meteor 框架。
- **实时**：传统 **DDP（Dynamic Data Protocol）** 长连接，**正在向 REST 迁移**——8.8.0 把 2FA、audit、custom OAuth、thread-read、message-send、push-test 等原 DDP-only 流程补齐为 REST 端点；被替换的 realtime 方法"保留到 9.0.0 但打 deprecation 日志"。
- **微服务/扩展**：**Apps-Engine**（插件引擎）默认运行时 **从 Deno 切到 Node.js**（8.8.0，除非 `APPS_ENGINE_RUNTIME_BACKEND=deno`）；Node 22.22.3 / Deno 2.3.1。
- **授权模式变化**：2025 年"工作区限制风波"（8.0 起单实例多 workspace 需 license）后，2026 转向**功能模块化收费**：8.8.0 起 LDAP/SAML 对无 Premium 工作区打 deprecation 警告，**9.0.0 起需 `ldap-enterprise`/`saml-enterprise` license 模块**（8.x 仍可用）。审计端点（`/v1/audit.*`）EE-only 需 `auditing` license。

### 3.2 消息可靠性
- **`chat.syncMessages` 新增 `fromTs` 参数**（8.8.0，随 `lastUpdate` 发送）——**界定同步窗口**，客户端可按时间戳补拉，这是"重连补拉"的显式服务端支持。
- 修复"线程回复在所有人已读后仍显示单勾（sent）而非双勾（viewed），直到新消息才翻转"（#41707）——已读回执状态机。
- 修复"全宽上下文栏（小屏 thread 视图）隐藏消息列表时，后台静默加载整房间历史并下载附件"（#41454）——按需分页而非全量。
- 线程面板改为**滚动分页加载**（8.8.0）。
- 限流：`sendForgotPasswordEmail` 加 per-client 限流（对齐 REST `users.forgotPassword`）。

### 3.3 E2EE 状态
- **新增"强制私有房间 E2EE"开关**（8.8.0，Administration > Workspace > End-to-end encryption）：加密每个新私有房间并在建房间/建团队对话框锁定开关；公共房间不受影响，**federated 房间豁免**。
- 用户可**对特定人隐藏 presence 和状态**（被隐藏者看到 offline，隐藏状态不进检索/搜索）。
- ABAC 管理的房间可显示**分类横幅**（US 政府式分类标记，JSON 配置：级别/特殊访问项目/可发布性/颜色）。

### 3.4 AI/Agent 集成
- **原生 MCP server（alpha，8.8.0）**：AI Center 管理区开启端点，选 **minimal 或 extended 工具集**（两者默认关），访问需 **AI add-on license + 新 `access-mcp` 权限**。这是"IM 平台作为 MCP host 暴露给外部 agent"的标志性动作。
- Apps-Engine app action 按钮新增接受 role `name`（除 `_id`）并支持 room-scoped roles（owner/moderator/leader/自定义）。

### 3.5 自部署友好度
- 高（MongoDB 单实例可跑），但 Meteor 技术栈较重；9.0.0 起 SSO 模块化收费对中小团队自部署是负向信号。
- 语音：屏幕共享 GA、可无麦克风加入内部通话、SIP 转发记录为 transfer 并保留主叫名。

### 3.6 2025-2026 动向
- 8.8.0（2026-09-03）为大版本：E2EE 强制私有房间、MCP server alpha、DDP→REST 迁移、Apps-Engine 转 Node、ABAC 分类横幅、presence 定向隐藏。
- 7.10.x LTS 与 8.x 并行维护，8.x 多版本（8.1.8~8.7.1）密集打安全 hotfix（2026-08）。
- Federation（跨服务器对话）在 8.8.0 修复"首次接触/历史/缩略图/分页/邀请"。

### 3.7 合鸣可借鉴（机制级）
- **`syncMessages(fromTs)` 显式同步窗口**：合鸣重连补拉 API 应支持"按时间戳/seq 界定窗口"参数，避免客户端无限补拉。
- **原生 MCP server + 工具集分级（minimal/extended）+ 权限门控（`access-mcp`）**：合鸣"多 Agent 编排"应把"平台自身作为 MCP host"做成一等能力，工具集分档 + 细粒度权限是可直接抄的安全模型。
- **已读回执双状态（sent 单勾 / viewed 双勾）状态机**：合鸣消息状态字段应显式区分"已送达/已读"，且修复"状态翻转需等新消息"这类 bug。
- **SSO 功能模块化收费是反面教材**：合鸣"单组织自部署"应保持 SSO 开源免费。
- **presence 定向隐藏**：合鸣 presence 可支持"对特定用户隐藏在线状态"。

---

## 4. Mattermost

### 4.1 核心架构
- **存储**：PostgreSQL（HA 支持；agents 插件语义搜索需 `pgvector` 扩展）。
- **实时**：WebSocket + 事件广播；多节点 HA（集群 + LB）。
- **扩展**：Go 插件体系（plugin API）+ **Agents 插件**（mattermost-plugin-agents，248 star，2026-09-05 仍 push）。
- **许可**：开源核心（Apache 2.0 服务端）+ 企业版 license 文件双轨；多版本并行支持（10.x/11.x/11.7 extended support 轨道）。

### 4.2 消息可靠性
- 消息带 `create_at` 时间戳 + `post_id`，客户端按时间戳分页补拉；`getPostsSince` 类 API 支持增量。
- 本次抓取未见 11.10/11.11 引入新的 seq/幂等机制变更（release body 仅一句话摘要，细节在 docs 站点，被 403 拦截）。

### 4.3 E2EE 状态
- Mattermost 无消息级 E2EE（企业 IM 定位，服务端可审计）；**11.10.0 引入 Federation（Matrix Protocol Interoperability）**——与 Matrix 互通，是"用互操作而非自研 E2EE"的路线。

### 4.4 AI/Agent 集成
- **Mattermost Agents 插件**（248 star，2026-09-05 活跃）：
  - **多 LLM 支持**：本地（Ollama、vLLM 等）/ 云（OpenAI、Anthropic、Azure）/ 任意 OpenAI 兼容 API——"数据与部署你控制"。
  - **多 AI assistant**（不同人格/能力）、线程/频道摘要、行动项提取、会议转写、**语义搜索**（pgvector）、智能 reaction 建议、专属频道直聊 AI。
  - **LLM Bridge API + Go Bridge Client**：其他插件/服务端可复用该插件的 LLM 能力——"AI 能力中台"模式。
  - 系统要求：Mattermost Server v11.9.0+、PostgreSQL + pgvector。
- **11.10.0（2026-08-04）**：Team ABAC Membership、Native User Attributes in ABAC、Dataminr 插件增强、嵌入式 MS Teams 应用 GCC High 支持、**Federation（Matrix 互操作）**。
- 11.11.0-rc2（2026-08-25）为当前 RC（body 仅摘要）。

### 4.5 自部署友好度
- 高（Docker/K8s，单二进制 server + PG）；Playbooks/Boards 等企业功能部分在 EE。

### 4.6 2025-2026 动向
- **Matrix 互操作（Federation）** 是 11.10.0 最大动作——Mattermost 选择"对接 Matrix 标准"而非自研联邦。
- Agents 插件持续迭代（多 LLM、语义搜索、Bridge API）。
- 多轨道支持策略（10.x/11.x/11.7 extended）降低升级风险。

### 4.7 合鸣可借鉴（机制级）
- **Agents 插件的"LLM Bridge API + Go client"中台模式**：合鸣"多 Agent 编排"应把 LLM 调用抽象为内部 Bridge，供各插件/agent 复用，而非每个插件各自接 LLM。
- **多 LLM provider 抽象（本地/云/OpenAI 兼容）**：合鸣 agent 应支持 Ollama/vLLM/云 API 统一接口。
- **pgvector 语义搜索**：合鸣若做跨消息语义搜索，Postgres+pgvector 是成熟路径（但合鸣是 SQLite，可用 sqlite-vec 对标）。
- **Matrix 互操作路线**：合鸣若做联邦/互联，"对接开放标准（Matrix/MCP/A2A）"比自研协议性价比高（与 agent 调研中"押协议不押框架"结论一致）。
- **ABAC（基于属性的访问控制）+ 原生用户属性**：合鸣"团队权限体系"（org-permission-design）可借鉴 ABAC 的"用户属性 + 角色"双维度，而非纯 RBAC。

---

## 5. Zulip

### 5.1 核心架构
- **存储**：PostgreSQL（12.1 修复 PG18 在 Linux >= 6.14 的 io_uring 启动问题）+ 文件上传后端（可配，12.1 加后端配置校验）。
- **实时**：**event queue 子系统**——12.0 重大改进"支持长生命周期客户端队列：空闲一段时间后标记 offline 并触发缺信通知，**但队列本身保留**，移动端可恢复而无需全量重拉"。这是对"移动端断连重连"的关键优化。
- **限流**：12.0 把 Tornado 限流迁到**共享 Redis GCRA（Generic Cell Rate Algorithm）后端**，消除"跨进程分散请求绕过限流"的漏洞并修 partial-update bug。
- **部署**：Docker 容器重构（ghcr.io/zulip/zulip-server），加 Compose/Helm 测试与文档。

### 5.2 消息可靠性
- **message_id + 事件队列游标**：客户端按 `last_message_id` 增量拉取，event queue 长保留。
- 12.0 加"web 应用在弱网下改进 reload 可靠性：延迟拉取状态数据并在失败时重试"。
- 12.0 加 `mentions:` 搜索操作符、`is:followed` 话题过滤、`channels:archived` 过滤器。
- 12.2（2026-08-10）修 5 个 GHSA（guest 越权收消息/读 profile、OIDC `email_verified` 未校验、render 端点无长度限制）——访问控制加固。

### 5.3 E2EE 状态
- **移动端推送通知 E2EE**：11.0（2025-08-13）服务器端支持；**12.0（2026-04-27）客户端 GA**（"服务器和客户端都新时启用"）；**12.1（2026-06-26）`require_e2ee_push_notifications` 开启后，legacy 推送完全跳过（而非发脱敏内容）**。
- 11.0 加"组织设置：阻止向不使用 E2EE 协议的旧移动客户端推送消息内容"（按客户端版本脱敏）。
- 无消息级 E2EE（Zulip 服务端可搜索/可审计，定位企业协作）。

### 5.4 AI/Agent 集成
- **`/llms.txt` 发现端点（12.0）**：让 LLM 驱动的 agent 发现服务器上的 web-public channels——"IM 即 agent 可发现资源"。
- **Topic summarization 改用 OpenAI Python SDK**（12.1，弃 litellm），`TOPIC_SUMMARIZATION_MODEL` 改纯模型名 + 新 `TOPIC_SUMMARIZATION_API_BASE` 配 OpenAI 兼容 provider。
- 12.0 加 Jitsi/Nextcloud Talk/Constructor Groups/Webex 视频通话 provider、Discord 登录、SCIM 自定义 profile 字段同步。

### 5.5 自部署友好度
- 高（PostgreSQL + 单 server，Docker/Helm 重构后体验好）；self-host 是 Zulip 核心定位。
- 12.0 加"demo organizations"（不共享邮箱即可测试）、"Report message"（可配置私有审核频道）。

### 5.6 2025-2026 动向
- 12.0（2026-04-27）为大版本：E2EE push GA、Recent Conversations 重设计、`/llms.txt`、大量 webhook 集成增删（加 Redmine/dbt Cloud/n8n，删已关服服务）、Markdown 增强。
- 12.1/12.2：安全加固 + E2EE push 完善。
- 13.0-dev 已在开发（changelog 占位）。

### 5.7 合鸣可借鉴（机制级）
- **`/llms.txt` 发现端点**：合鸣应低成本实现，让外部 agent 发现可协作的公共频道（与"IM 即编排载体"叙事强相关）。
- **E2EE 推送三阶段落地**（服务器端支持→客户端 GA→`require_` 开关完全跳过明文）：合鸣 E2EE 推送照此三阶段，且"按客户端版本决定是否脱敏"是平滑过渡关键。
- **长生命周期 event queue（空闲标记 offline 但保留队列）**：合鸣移动端断连重连应"保留服务端队列 + 标记 offline 触发缺信通知"，避免全量重拉。
- **共享 Redis GCRA 限流**：合鸣若多进程，限流应集中式（Redis），避免"跨进程分散绕过"。
- **按客户端版本脱敏推送**：合鸣升级期新旧客户端并存时，推送内容应按客户端能力分级。

---

## 6. OpenIM（国产开源）

### 6.1 核心架构
- **语言/框架**：Go + gRPC 微服务（`internal/rpc/*`：msg/user/group/auth 等）。
- **存储可插拔**：消息主存储 MongoDB（也可 MySQL/Postgres/PolarDB），Redis 缓存，MinIO/S3 文件。
- **发现后端可配置**（2026-07-22 "select discovery backend from configured type"）：etcd/K8s/Consul；**3.8.3 移除 Zookeeper**（v3.8.3-patch.16，2026-03-19）。
- **Kafka** 用于消息管道（3.8.3-patch.11 修 Kafka/etcd 镜像 namespace）。
- **SDK 覆盖**：iOS/Android/Flutter/RN/HarmonyOS/uni-app/Electron/纯 JS/WASM——"为开发者而非终端 App"定位。
- **Platform API（REST）**：按 users/groups/messages 组织，admin token 鉴权。

### 6.2 消息可靠性（核心，机制级）
- **双游标 seq 模型**：
  - `maxSeq`（会话内消息最大序号，`internal/rpc/msg/seq.go`、`pkg/rpcli/msg.go`）——每会话单调递增，客户端按 seq 补拉。
  - `hasReadSeq`/read seq（已读序号）——3.8.3-patch.7 修"按会话+用户聚合 read seq 后再更新 DB"、patch.16 修"我发的消息未在 MongoDB 设置 read seq"。
  - **缺口补拉**：3.8.3-patch.9 修"为 gap message 填充最近 sendTime 防止…"（`fill in the most recent sendTime for a gap message`）——**显式处理 seq 缺口**。
- **幂等**：注册/登录幂等（`Forbid idempotent ... retries` 类逻辑）；消息以 conversationID + seq 唯一定位。
- **多端同步**：per-platform 连接（platformID），`UserConnContext` 重构（patch.15）；消息经 Kafka 扇出到各端连接。
- **Webhook/回调**：patch.16 加"online status webhook"、移除 Zookeeper 配置；main 分支 2026-08-31 修"被邀请成员的 after-join webhook 未触发"（#3796）。
- **缓存**：patch.15 修"cache eviction 死锁 + 改进 GetBatch"；Redis `aof-use-rdb-preamble`（patch.9）。

### 6.3 E2EE 状态
- 无内置消息级 E2EE（定位是 IM SDK/框架，加密留给上层）；存储层 SQLCipher（客户端本地存储加密，node-sqlcipher 相关仓库活跃）。

### 6.4 AI/Agent 集成
- 无原生；但"为开发者"定位 + 全平台 SDK 使其成为"自研 IM 底座"的常见选择（合鸣的参照系）。

### 6.5 自部署友好度
- 中高（Docker Compose/K8s），但依赖栈重（MongoDB+Redis+MinIO+Kafka+etcd）；3.8.3 起逐步简化（去 Zookeeper、发现后端可配）。
- 版本：v3.8.3 为当前稳定（3.8.3-patch.16，2026-03-19），main 活跃（2026-08-31），pre-release-v3.8.4 分支存在（**4.x 未发布**，任务假设的"3.x/4.x"中 4.x 尚不存在）。

### 6.6 2025-2026 动向
- 3.8.3-patch 系列密集修可靠性 bug（read seq、cache 死锁、gap message、webhook、conversationID 生成）。
- 架构简化（去 Zookeeper、发现后端可配、ClientConn 接口化取代 LongConn）。
- 多端覆盖扩到 HarmonyOS/uni-app。

### 6.7 合鸣可借鉴（机制级）
- **`maxSeq` + `hasReadSeq` 双游标**：合鸣 P0 差距"message seq + 已送达回执"的直接参照——每会话 maxSeq（消息序号）+ 每用户 hasReadSeq（已读序号）两个独立游标，重连按双游标补拉。
- **seq 缺口（gap message）显式处理**：合鸣补拉时若遇 seq 空洞，应"填充最近 sendTime + 标记 gap"而非卡死（OpenIM patch.9 正是修这个）。
- **read seq 聚合后再落库**（patch.7）：合鸣已读更新应"按会话+用户聚合后批量写"，避免高频单条写。
- **去 Zookeeper/发现后端可配**：合鸣保持轻量单体，但若未来分布式，"发现后端可插拔（默认最简）"是正确姿势。
- **online status webhook + after-join webhook**：合鸣插件系统的"消息管线/定时"挂载面可对齐 OpenIM 的 webhook 事件集（在线状态、入群、收信）。
- **反面参照**：OpenIM 依赖栈（MongoDB+Redis+MinIO+Kafka+etcd）对中小团队自部署偏重——合鸣 Node/TS+SQLite 单体是差异化优势，不应盲目堆组件。

---

## 7. 飞书 / Feishu（Lark）

> 飞书开放平台文档为 SPA，但 **`.md` 后缀可直接抓取正文**（本报告用此法拿到一手 API 文档）。

### 7.1 核心架构
- **开放平台（Open Platform）**：应用制（Custom App / Store App），**机器人能力**为 IM 集成入口（需发布版本生效）。
- **消息协议**：REST API `POST /open-apis/im/v1/messages`，`receive_id_type` 支持 **open_id / union_id / user_id / email / chat_id** 五种接收者标识（open_id 应用内唯一、union_id 开发商内唯一、user_id 租户内唯一、email、chat_id 群）。
- **鉴权**：`tenant_access_token`（应用身份）/ `user_access_token`（用户身份）双 token 模型；`receive_id_type=user_id` 时敏感字段需额外 `contact:user.employee_id:readonly` 权限。
- **细粒度权限（scope）**：`im:message`（收发明细）、`im:message:send_as_bot`（应用身份发）、`im:message.p2p_msg`（单聊）、`im:message.group_at_msg`（群@机器人）、`im:message.group_msg`（群全部，敏感）、`im:message.group_msg.include_bot:read`（含其他机器人）等——**按"单聊/群@/群全量/是否含机器人"细分权限粒度**。

### 7.2 消息可靠性
- **限频**：同一用户 **5 QPS**、同一群组内机器人共享 **5 QPS**；接口级 **1000 次/分钟、50 次/秒**。
- **幂等官方口径**（接收消息事件文档原话）："**特殊情况下可能会收到重复的推送，如有幂等需求请使用 `message_id` 去重，不要依赖 `event_id`**"——这是飞书对"webhook 推送可能重复"的明确契约。
- **事件推送（webhook）**：事件类型 `im.message.receive_v1`，事件头含 `event_id`/`event_type`/`create_time`；`sender_type` 区分 user/bot。
- 接收者标识五元组 + 字段级权限 = "最小授权 + 字段级可见性控制"。

### 7.3 E2EE 状态
- 飞书为云端 SaaS，**无客户端可选 E2EE**（企业合规可审计）；传输层 TLS + 服务端加密。
- 与合鸣 E2EE 定位相反（合鸣要 E2EE，飞书要可审计），但"字段级权限 + 敏感字段需额外 scope"的细粒度授权对合鸣"团队权限体系"有借鉴价值。

### 7.4 AI/Agent 集成
- 开放平台以 **事件订阅（webhook）+ 消息卡片（interactive card）+ 机器人** 为核心集成面；AI 集成主要靠"应用订阅消息事件 → 外部 AI 处理 → 机器人回消息/更新卡片"的 webhook 闭环。
- 权限体系（含 `im:message.group_msg.include_bot:read` 这类"收其他机器人消息"权限）天然支持"多机器人/多 agent 在同一群协作"场景。

### 7.5 自部署友好度
- **不可自部署**（SaaS）；但开放平台架构是"IM + 开放生态"的成熟参照。

### 7.6 2025-2026 动向
- 持续细化权限 scope（含 `:include_bot`、`:readonly` 变体）与字段级可见性。
- 消息卡片（interactive card）作为 AI/交互载体持续演进。
- （注：飞书 AI 智能体平台的具体 2026 新特性因 SPA 正文抓取受限，本节聚焦已核实的一手 API/权限/可靠性机制。）

### 7.7 合鸣可借鉴（机制级）
- **`message_id` 去重（不依赖 `event_id`）的幂等契约**：合鸣 webhook/回调推送应明确"可能重复，消费者按 message_id 去重"，并把此写进 API 契约（与 OpenIM 幂等、Rocket syncMessages 呼应，三家一致）。
- **接收者标识多类型 + 字段级权限**：合鸣"团队权限体系"可借鉴"敏感字段需额外 scope + 按消息类型（单聊/群@/群全量/含 bot）细分权限"。
- **`sender_type` 区分 user/bot**：合鸣多 agent 场景下，消息应显式标记发送者类型（人类/agent），支撑"含 bot 消息"类权限与 UI 区分。
- **限频分维度（per-user 5QPS + per-group 机器人共享 5QPS + 接口级 1000/min）**：合鸣 agent 发消息应有多维限频，防 agent 风暴。
- **消息卡片（interactive card）作为 agent 交互载体**：合鸣"插件 UI 呈现"（plugin-ui-plan）的"声明式卡片 80%"路线与飞书卡片同构。

---

## 8. Discord

> Discord 为闭源 SaaS，架构信息取自官方开发者文档（discord-api-docs，可抓 `.md`/`.mdx` 源）与 API changelog。

### 8.1 核心架构
- **Gateway API（WebSocket）**：客户端开持久 WebSocket 收实时事件。**事件载荷 `{op, d, s, t}`**：`op` 操作码、`d` 数据、**`s` 序号（事件相对顺序）**、`t` 事件名。
- **Intents（位掩码）**：客户端 Identify 时用位或（`|`）声明订阅哪些事件组——**按需订阅，服务端只发被订阅事件**。
- **Sharding**：大型 bot 分片，多 WebSocket 连接分担。
- **编码/压缩**：支持 ETEXTBINARY/ETFLATE 等压缩编码。
- **发送限制**：事件载荷 ≤ 4096 字节（超限关连接 code 4002）。

### 8.2 消息可靠性
- **序号 `s` + Resumption（断线重连）**：客户端需缓存最近非空 `s`，重连时带 `s` 走 **Resume** 而非全量重拉——服务端从 `s` 之后续发。这是 Discord 的"重连补拉"核心机制（与 Matrix token、OpenIM maxSeq、Zulip last_message_id 同构）。
- **Heartbeat**：周期性心跳保活，心跳带最后 `s`。
- **消息 ID**：雪花 ID（Snowflake，时间戳编码），天然有序。
- **Rate limiting**：HTTP API 与 Gateway 分离限流，响应头带 `X-RateLimit-*`。

### 8.3 E2EE 状态
- **无**（Discord 2025 年曾探索 E2EE 后搁置，维持可审计 + 内容审核路线）；传输层 TLS。
- 2026-08-13 加"private channel obfuscation"（私有频道混淆）文档——隐私靠"不公开"而非加密。

### 8.4 AI/Agent 集成
- **应用目录（App Directory）+ 交互（Interactions/Slash Commands）+ 组件（Components）**：bot/应用生态核心。
- 2026 动向（API changelog 核实）：
  - **2026-09-03 默认文件上传限制 10MiB→20MiB**（用户/bot/webhook/交互响应）。
  - **2026-09-02 Game Profiles**（新游戏资料片 + mention tag 语法）。
  - **2026-08-26 Game Stats Widgets**（claimed 游戏可在用户资料展示 rank/playtime/wins，走 Application Identity Profile API）。
  - **2026-08-26 Account Linking on Web**（标准 OAuth2 web 流，解除 partner 限制）。
  - **2026-08-27 `PRUNE_REQUIRES_ADMIN` guild feature**（prune 端点需 ADMIN 权限）。
  - **Social SDK 1.10.x**：voice settings RPC（只读 mute/deafen/音量/voice mode/PPT 键）、Game Stats、Account Linking。
- **Activities（游戏状态/活动）**：用户资料展示"正在玩什么"，Game Stats Widget 是其 2026 扩展。

### 8.5 自部署友好度
- **不可自部署**（闭源 SaaS）；但 Gateway/Intents/Sharding 模型是"大规模实时 IM 客户端协议"的工业级参照。

### 8.6 2025-2026 动向
- 重心在 **Social Layer / Game 生态**（Game Profiles、Game Stats Widgets、Application Identity Profile、Account Linking on Web）——Discord 从"游戏语音"向"游戏社交身份平台"扩展。
- 基础设施：上传限制提升、权限精细化（PRUNE_REQUIRES_ADMIN）、Social SDK 迭代。
- 无 E2EE、无新消息系统代际变化（Gateway 模型稳定）。

### 8.7 合鸣可借鉴（机制级）
- **Intents 位掩码订阅**：合鸣客户端（尤其移动端/agent）应支持"声明式订阅事件组"，服务端只下发被订阅事件，降低带宽与客户端处理负担（对多 agent 场景尤其重要——agent 只订阅它关心的事件）。
- **序号 `s` + Resume**：合鸣重连补拉直接对标"缓存最后 seq + 带 seq resume"（与 OpenIM maxSeq/Zulip last_message_id 一致，四家殊途同归）。
- **Snowflake 时间戳编码 ID**：合鸣消息 ID 可用"时间戳 + 序列"编码（如 Snowflake），天然有序、可反解时间、全局唯一。
- **载荷大小上限（4096B 关连接）**：合鸣 WebSocket 事件应有明确大小上限与超限处理。
- **文件上传限制提升（10→20MiB）**：合鸣附件默认上限可对标主流（Discord 20MiB 默认）。
- **Social Layer 启示**：Discord 把"身份/资料/游戏状态"做成平台级能力——合鸣"设备互联"（device-link-plan）的"设备状态展示"可借鉴"用户资料展示实时状态"的模式。

---

## 9. 对比总表

| 维度 | Element/Matrix | Signal | Rocket.Chat | Mattermost | Zulip | OpenIM | 飞书 | Discord |
|---|---|---|---|---|---|---|---|---|
| **存储** | PostgreSQL（事件溯源，Rust 化中） | FoundationDB + Redis/Dynamo | MongoDB 8 | PostgreSQL(+pgvector) | PostgreSQL(+Redis GCRA 限流) | MongoDB/MySQL/PG + Redis + MinIO + Kafka | 闭源 SaaS | 闭源 SaaS |
| **实时/同步模型** | `/sync` token + **Sliding Sync(MSC4186)** | libsignal 队列(per-ACI) | DDP→**REST 迁移** + `syncMessages(fromTs)` | WebSocket + 事件广播 | **长生命周期 event queue** | gRPC + Kafka 扇出 + 双游标 seq | webhook 事件推送 | **Gateway WS + intents + sharding** |
| **seq/游标** | event token（不透明） | 队列游标 | `lastUpdate`/`fromTs` 时间戳 | `create_at` 时间戳 | `last_message_id` | **`maxSeq`+`hasReadSeq` 双游标 + gap 处理** | `message_id` 去重 | **`s` 序号 + Resume** |
| **幂等机制** | `txn_id`（per-device） | 幂等注册键 + 内容哈希信封 | —（syncMessages 窗口） | `post_id` | message_id | message_id + 注册幂等 | **官方契约:message_id 去重** | Snowflake ID |
| **多端同步** | sliding sync 窗口 + 脱水设备 | per-member 双棘轮 | 跨端 DDP/REST | 多节点 HA + 时间戳分页 | event queue 保留 + offline 标记 | per-platform 连接 + Kafka 扇出 | 多端 SaaS | sharding + resume |
| **E2EE** | MLS 未生产；**加密历史共享(to-device key bundle)**；dehydrated device | **全量 E2EE + 密钥透明审计**；MLS/Sesame 未落地 | **强制私有房间 E2EE 开关**（联邦豁免） | 无（**Matrix 互操作**路线） | **E2EE 移动端推送(12.0 GA)**；无消息级 | 无内置（客户端 SQLCipher） | 无（可审计 SaaS） | 无（隐私靠不公开） |
| **AI/Agent 集成** | 无原生（open standard） | 无 | **原生 MCP server(alpha, 工具分档+access-mcp 权限)** | **Agents 插件(多LLM+pgvector+Bridge API)** | **`/llms.txt` 端点** + topic summarization | 无原生（SDK 底座） | webhook+卡片+细粒度权限 | **应用目录+Interactions+Social Layer** |
| **自部署友好度** | 高（Synapse AGPL；Dendrite 停更；tuwunel 活跃） | **极低**（多微服务+号码体系） | 高（MongoDB；9.0 SSO 模块化收费） | 高（PG+插件） | 高（Docker/Helm 重构） | 中高（依赖栈重） | 不可（SaaS） | 不可（SaaS） |
| **2025-2026 关键动向** | Sliding Sync 合入 spec；Room v11 默认；Rust 化 | 可靠性/可观测性；后量子 SPQR 研究 | MCP server alpha；DDP→REST；E2EE 私有房间 | Matrix 互操作；Agents 插件 | E2EE push GA；`/llms.txt`；长队列 | 去 Zookeeper；双游标 seq 修 bug | 权限 scope 细化；卡片 | 上传 20MiB；Game/Social 生态 |
| **对合鸣定位契合度** | 中高（federation/同步参照） | 低（C 端隐私） | 高（MCP host/SSO 反面教材） | 高（agent 中台/ABAC） | 高（E2EE push/llms.txt） | 高（seq/幂等/SDK） | 中（权限/卡片/限频） | 中（Gateway/intents/resume） |

---

## 10. 合鸣差距映射（对照记忆中的审计/差距清单）

> 对照 `im-gap-analysis`（合鸣 P0=message seq + 幂等键 + 状态字段 + 已送达回执）、`im-tech-research`（E2EE 协议 P0）、`device-link-plan`、`plugin-ui-plan`、`org-permission-design`。

### 10.1 P0：消息可靠性三件套（seq + 幂等 + 多端同步）
- **机制级对标（四家殊途同归，可定稿合鸣方案）**：
  1. **每会话单调 `maxSeq`**（OpenIM `maxSeq`/`internal/rpc/msg/seq.go`）——消息入库即分配会话内递增 seq。
  2. **每用户 `hasReadSeq` 双游标**（OpenIM read seq）——已读/送达独立于消息 seq，聚合后落库（OpenIM patch.7"按会话+用户聚合再写"）。
  3. **重连补拉带游标**：OpenIM 按 maxSeq、Discord 按 `s`+Resume、Zulip 按 last_message_id、Rocket 按 `fromTs`——**合鸣统一为"带 seq 的增量拉取接口"**（对标 Discord Resume 语义：带最后 seq 续拉，而非全量）。
  4. **幂等键 = `message_id`**（飞书官方契约"用 message_id 去重，不依赖 event_id"；OpenIM/Signal 同）——**合鸣 API 契约应明确"推送/补拉可能重复，消费者按 message_id 去重"**。
  5. **seq 缺口（gap message）显式处理**（OpenIM patch.9）——补拉遇空洞时填充 + 标记，不卡死。
  6. **状态字段**：sent 单勾 / delivered / viewed 双勾（Rocket #41707 修复的状态机）——合鸣消息状态字段显式区分。
- **结论**：合鸣 P0 方向正确，上述 6 点可直接写进 schema/接口设计，无歧义。

### 10.2 P0：E2EE
- **消息级 E2EE**：Signal（全量 + 密钥透明）是上限参照但成本高；Matrix MLS 未生产（勿等 MLS）；**建议合鸣短期用 libsignal（Double Ratchet + X3DH）做 1:1，群组用 MLS 试点或先做"群密钥管理"**。
- **E2EE 推送通知**（更近、更高价值）：**照抄 Zulip 三阶段**——① 服务器端支持加密推送；② 客户端 GA（新旧共存，按客户端版本脱敏）；③ `require_e2ee_push_notifications` 开关完全跳过明文。**合鸣 ntfy 推送集成（见 git log）应叠加此加密层**。
- **加密历史共享**（Element 2026-05）：合鸣 E2EE 房间新成员看历史，用 **to-device 私有通道发 key bundle + 房间级开关 + 聊天头标识**。
- **脱水设备**（Matrix MSC3814）：移动端离线推送不依赖常开连接。

### 10.3 多 Agent 编排（合鸣差异化核心）
- **平台作为 MCP host**（Rocket 8.8.0 模式）：合鸣应内置 **MCP server**，工具集分档（minimal/extended）+ 细粒度权限门控（对标 `access-mcp`）——让外部 agent 驱动合鸣。
- **平台消费 LLM**（Mattermost Agents 模式）：**LLM Bridge 中台**（多 provider：Ollama/vLLM/云/OpenAI 兼容）+ Go/TS Bridge client 供插件/agent 复用，避免各插件各自接 LLM。
- **`/llms.txt` 发现端点**（Zulip 12.0）：低成本高信号，让外部 agent 发现合鸣公共频道——**强烈建议做**。
- **`sender_type` 区分 user/bot/agent**（飞书）：消息显式标记发送者类型，支撑"含 agent 消息"权限与 UI。
- **Intents 位掩码订阅**（Discord）：agent/移动端声明式订阅事件组，服务端只发被订阅事件——**对多 agent 降噪关键**。
- **与 agent 调研结论对齐**：押协议（MCP/A2A）不押框架；"IM 消息流 = agent 事件流"是合鸣独有叙事（竞品仅 AgentScope/Letta 把 IM 做一等公民）。

### 10.4 插件系统（plugin-system-plan / plugin-ui-plan）
- **消息卡片（interactive card）作为 agent/插件 UI 载体**（飞书卡片）——合鸣"声明式卡片 80%"路线与飞书同构，可对标其卡片 schema 粒度。
- **webhook 事件集**（OpenIM：在线状态/入群/收信；飞书：im.message.receive_v1）——合鸣插件"消息管线/定时"挂载面对齐这套事件集。
- **LLM Bridge 作为插件能力中台**（Mattermost）——插件声明式接入 AI 能力。

### 10.5 团队权限体系（org-permission-design：Zulip 五级角色 + Mattermost 作用域裁剪）
- **ABAC（基于属性）+ 原生用户属性**（Mattermost 11.10 Team ABAC Membership / Native User Attributes）——合鸣权限从纯 RBAC 升级为"用户属性 + 角色"双维度。
- **字段级权限 + 敏感字段额外 scope**（飞书）——"敏感字段需额外权限 + 按消息类型（单聊/群@/群全量/含 bot）细分"。
- **SSO 保持开源**（Rocket 9.0 模块化收费是反面教材）——合鸣"单组织自部署"心智下，LDAP/SAML/OIDC 应免费。

### 10.6 设备互联（device-link-plan）
- **Social Layer"资料展示实时状态"**（Discord Game Stats/voice settings）——合鸣"设备状态展示"可借鉴"用户/设备资料展示实时状态"模式。
- **Presence 定向隐藏**（Rocket 8.8）——presence 支持"对特定用户隐藏在线"。

### 10.7 自部署/运维
- **保持轻量单体**（合鸣 Node/TS+SQLite 是差异化优势）——**勿盲目堆 OpenIM 全家桶（MongoDB+Redis+MinIO+Kafka+etcd）**；若未来分布式，"发现后端可插拔、默认最简"（OpenIM 去 Zookeeper 方向）。
- **集中式限流**（Zulip Redis GCRA）——多进程时限流集中，防"跨进程分散绕过"。
- **可观测性**（Signal 双存储流一致性度量、缺信分级 ephemeral/persistent）——合鸣"本地+云端"双写时加"两存储流 agreement metrics"。
- **长生命周期 event queue**（Zulip 12.0）——移动端断连重连"保留队列 + 标记 offline 触发缺信通知"，不全量重拉。

### 10.8 优先级建议（映射到合鸣修复批次）
1. **立即（P0）**：消息可靠性三件套（§10.1 六点）+ 幂等契约写进 API 文档 + `message_id` 去重。
2. **近期（P0/P1）**：E2EE 推送通知三阶段（§10.2，叠加 ntfy）+ `/llms.txt` 端点 + `sender_type` 标记。
3. **中期（P1）**：MCP host（工具分档+权限门控）+ LLM Bridge 中台 + Intents 订阅。
4. **持续（P2）**：ABAC 权限升级 + 卡片 schema 对齐飞书 + 设备状态展示 + 集中式限流 + 双存储可观测性。

---

## Sources

一手来源（2026-09-05 抓取）：

**Matrix / Element**
- Synapse 1.160 releases & CHANGES.md — https://github.com/element-hq/synapse/releases ；https://github.com/element-hq/synapse/blob/release-v1.160/CHANGES.md
- Dendrite（停更，最后提交 2024-11）— https://github.com/matrix-org/dendrite
- Tuwunel（conduit 后继）v1.9.0 — https://github.com/matrix-construct/tuwunel/releases
- MSC4186 Simplified Sliding Sync（2026-06-29 合入）— https://github.com/matrix-org/matrix-spec-proposals/pull/4186
- Element Blog（Sliding Sync/主权/加密历史共享/Spaces）— https://element.io/blog/
- Element 加密历史共享（2026-05-13）— https://element.io/blog/seamless-encrypted-history-sharing-arrives-in-element/

**Signal**
- Signal-Server releases/tags & commits — https://github.com/signalapp/Signal-Server ；commits 2026-08/09
- signalapp org 仓库（key-transparency-server/auditor、SparsePostQuantumRatchet、storage-service、registration-service）— https://github.com/signalapp

**Rocket.Chat**
- Rocket.Chat 8.8.0 release notes（2026-09-03，MCP server alpha/E2EE 私有房间/DDP→REST/syncMessages fromTs）— https://github.com/RocketChat/Rocket.Chat/releases/tag/8.8.0

**Mattermost**
- Mattermost releases（11.10.0/11.11.0-rc）— https://github.com/mattermost/mattermost/releases
- Mattermost Agents 插件（多 LLM/pgvector/Bridge API）— https://github.com/mattermost/mattermost-plugin-agents

**Zulip**
- Zulip changelog（11.0/12.0/12.1/12.2/13.0-dev）— https://zulip.readthedocs.io/en/latest/overview/changelog.html
- Zulip releases — https://github.com/zulip/zulip/releases

**OpenIM**
- OpenIM releases（v3.8.3-patch.16 等）— https://github.com/openimsdk/open-im-server/releases
- OpenIM README / 代码（`internal/rpc/msg/seq.go`、`pkg/rpcli/msg.go`、maxSeq/read seq）— https://github.com/openimsdk/open-im-server
- OpenIM 文档站（SDK 覆盖/Platform API）— https://docs.openim.io/

**飞书 / Lark**
- 飞书发送消息 API（receive_id_type/权限/限频）— https://open.feishu.cn/document/server-docs/im-v1/message/create （`.md` 后缀抓取）
- 飞书接收消息事件（im.message.receive_v1/message_id 去重契约）— https://open.feishu.cn/document/server-docs/im-v1/message/events/receive （`.md` 后缀抓取）

**Discord**
- Discord Gateway 文档（op/d/s/t、intents、resumption、sharding、4096B）— https://discord.com/developers/docs/topics/gateway （源：https://github.com/discord/discord-api-docs/blob/main/developers/events/gateway.mdx）
- Discord API Change Log（2026-08/09：上传 20MiB/Game Profiles/Game Stats/Account Linking/PRUNE_REQUIRES_ADMIN）— https://discord.com/changelog （源：https://github.com/discord/discord-api-docs/blob/main/developers/change-log.mdx）

> 注：matrix.org / signal.org / rocket.chat / docs.discord.com / discord.com / open.larksuite.com(SPA) 因网络策略无法直接抓取，相关事实均经 GitHub 官方 API/源文件交叉核实。所有版本号、日期、机制描述均可在上述来源复现。
