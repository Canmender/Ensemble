# 推送基础设施与 E2EE 密码学调研报告（2026-09-05）

> 面向合鸣 Ensemble（自部署 IM + AI Agent，RN/Expo 移动端 + 自建 ntfy + 自研 E2EE）的前沿技术调研。
>
> **调研时点**：2026-09-05。
> **取证方式说明**：本环境的 WebSearch 工具当日返回空结果、WebFetch 被企业域名白名单拦截，全部事实改用 curl 直抓一手来源交叉核实（GitHub API / raw.githubusercontent.com / rfc-editor.org / registry.npmjs.org）。凡因网络限制无法直抓的官方源（Google 系：firebase.google.com、developer.android.com、developers.google.com；signal.org；omemo.net），相关结论要么改用可直抓的替代源（GitHub 仓库、npm registry、RFC 原文）交叉证实，要么在文中**明确标注「未能直抓，基于已知事实，建议人工复核」**。所有版本号/日期均取自 API 原始返回。
> **隐私红线**：全文无真实 IP/凭据；外部主机一律以 `<SERVER_IP>` 占位。

---

## 0. TL;DR（执行摘要）

1. **ntfy 在 2025-2026 完成了一轮"从玩具到生产基础设施"的蜕变，合鸣现用的恰好是它最弱的一环。** 截至 2026-08-27 最新 `v2.28.0`，ntfy 已具备：per-topic/per-user 访问令牌（`tk_` 前缀，`auth-tokens` 可声明式预置）、ACL 缓存、**PostgreSQL 后端（2.18 起，2.27 起去掉 experimental 标签）+ 只读副本**、**原生 Web Push（VAPID）**（合鸣完全没用到的能力）、防 topic 枚举限速（2.23）、防缓存重放 DoS（2.28：单次 replay 上限 10MB、`since` 游标语义）。合鸣现状（`ensemble-<userId>` 可枚举、无鉴权、正文入推送、前台长轮询）每一条都有现成的 ntfy 原生机制可解，**短期加固不需要换基础设施，只需要用对它已有的功能**（详见 §1 机制级建议）。

2. **MLS（RFC 9420）已经标准化、实现已经生产级，但对合鸣是"12 个月后的事"而非"本季度"的事。** RFC 9420 正式定义了异步群组密钥建立协议（FS + PCS，规模 10~10^10）。参考实现 openmls 活跃且快速迭代：`v0.9.0`（2026-08-03/25）已是 **PQ 混合密码套件（P-384、ML-DSA、更多 PQ suite）+ targeted messages（定向消息草稿）+ 历史 epoch secret 时间化删除 + 存储迁移工具**。但：openmls 是 **Rust 库**，Node/RN 侧要靠 WASM/FFI 桥接（GitHub 上有零星 `MLS4RN`（2026-08）与 `marmot-ts`（MLS+Nostr，WIP）尝试，star 数均为 0-2，**无生产级 TS/RN MLS 栈**）；**Signal 至今未采用 MLS**（群聊仍用自研 Group v3 / Sender Keys，MLS 相关进展见 §2/§3）。结论：MLS 是合鸣群聊 E2EE 的**长期正确方向**（标准化、PQ 就绪、外部加入/离会都有协议原语），但**当下小团队（<50 人）应先用 Sender Key/Megolm 模式**（§4），协议留接口。

3. **X3DH + Double Ratchet + Sender Keys 仍是 E2EE 事实标准，libsignal 的"多语言绑定"格局已重构。** Signal 官方客户端统一用 Rust 核心（`signalapp/libsignal` monorepo，Java/Swift/TypeScript 三套库包 Rust 实现，README 明示"Use outside of Signal is unsupported"但 API 版本化）。**旧的独立语言绑定（`libsignal-protocol-javascript`、`-java`、`-swift`、`-c`、`-rust` 等）已全部归档**。对 RN/合鸣的直接含义：**没有官方 Node.js 绑定**，社区路径只剩 ① 自己按公开协议文档实现（TypeScript：`PeculiarVentures/2key-ratchet`（X3DH+Double Ratchet，2026-04 活跃，125★）是可用底稿）、② 用 WASM/FFI 包 libsignal Rust、③ 第三方 TS 实现（`raphaelvserafim/libsignal`，2026-06 活跃，5★，现代 TS 重写）。Hermes 兼容坑：纯 TS 实现无坑；任何带 native addon（N-API）的绑定都要处理 Hermes 与 JSC 的引擎差异、Android AAR 打包、iOS xcframework，**这是 libsignal 进 RN 的真实成本，不是写代码的量**。

4. **群聊 E2EE 轻量替代的 2025-2026 共识很清晰：<50 人团队用 Sender Key（Megolm 模式）是性价比之王。** 三方案对比（§4）：每对独立 ratchet（O(n²) 密钥，n=50 即 1225 条密钥线，加人=全量重发，否决）；自研树结构（Merkle/MLS 式，收益在 >100 人场景才体现，<50 人属过度设计）；**Sender Key（每发送者一条组密钥、加人/离会只发 O(1) 条新密钥、群规模无关）**——Signal Group v1/OMEMO 2.x/Megolm 同构，TypeScript 实现成本低、协议文档公开。代价是"前向保密粒度粗 + 成员离会不立即作废旧密钥（靠轮转）"，对单组织自部署团队可接受。**合鸣半环现状（kex_complete 发了无人接收）用 Sender Key 模式收口，改动面最小。**

5. **后量子混合 KEX 在 2025-2026 已从"研究"进入"默认选项"，且 libsodium 1.0.22 直接把答案端出来了。** NIST FIPS 203（ML-KEM）2024-08 发布后：TLS 1.3 的 `X25519MLKEM768` 混合套件已全栈默认（浏览器/服务端，§5）；**libsodium `1.0.22-RELEASE`（2026-04-09）新增 `crypto_kem_mlkem768_*` 与官方混合 KEM "X-Wing"（ML-KEM768+X25519），README 原文称 X-Wing 为"most applications 的推荐 KEM"**；Signal 开源了 `SparsePostQuantumRatchet`（SPQR，2025-04 建库、2026-07 仍活跃，70★，F*/hax 机器验证无 panic，ML-KEM Braid 协议替代 DH 公共棘轮）作为其"hybrid secure messaging"的可集成组件。对合鸣的迁移成本：**预密钥/前向密钥的 KEX 从纯 X25519 换成 X25519+ML-KEM768 混合（拼接共享密钥或 HKDF 两路输入），消息格式加一个版本/套件字段即可，棘轮本体不动**——这是五件事里迁移成本最低、安全叙事收益最高的一件，建议 P0 顺带做（§6）。

6. **落地路径一句话**：短期（1-2 周）= ntfy 鉴权+topic 随机化+正文脱敏+离线补拉（全部用 ntfy 原生机制，不换设施）；中期（1 个月）= 群聊 Sender Key 收口半环 + 混合 KEX 上线；长期（1 个季度+）= MLS 试点（openmls 0.9 WASM 桥）+ 跟踪 Signal 后量子棘轮产品化。P0/P1/P2 详单见 §6。

---

## 1. 推送基础设施现状与选型

### 1.1 ntfy：2025-2026 更新实况

**版本节奏**（GitHub releases API 核实，https://api.github.com/repos/binwiederhier/ntfy/releases ）：2026 年基本月更——`v2.18.0`(2026-03-07) → `v2.19.x`(03-15/16/17) → `v2.20.x`(03-26/27) → `v2.21.0`(03-30) → `v2.22.0`(04-21) → `v2.23.0`(05-18) → `v2.24.0`(06-04) → `v2.25.0`(06-24) → `v2.26.x`(07-09/20) → `v2.27.0`(08-04) → **`v2.28.0`(2026-08-27，当前最新)**。官方站 ntfy.sh 已整体切 PostgreSQL 后端。

**与合鸣直接相关的能力演变**（均取自上述 release notes 原文）：

| 能力 | 引入版本 | 对合鸣的含义 |
|---|---|---|
| **PostgreSQL 后端**（原只 SQLite） | v2.18.0（2026-03，14997 行新增） | 自部署可换 PG，支撑多实例/大容量 |
| PG 只读副本 `database-replica-urls` | v2.19.0 | 读负载分流 |
| **原生 Web Push（VAPID）**：`ntfy webpush keys` 生成密钥，`web-push-public-key`/`web-push-private-key`/`web-push-file`/`web-push-email-address` 配置，ntfy 把消息转发到浏览器 push endpoint（Chrome/Edge 下即 fcm.googleapis.com）；**自部署必须配 Web Push 才能让 PWA 收推送** | v2.18 前的早期版本已引入（release notes #751/#1138），配置文档在 docs `config.md` "Web Push" 节 | **合鸣桌面端/浏览器端（如有）可以零开发直接用 ntfy 当 Web Push 后端**；也验证了"ntfy 作为 push provider 的中转"是官方支持的路径 |
| **访问令牌**：`ntfy token add/remove/list/generate`；`auth-tokens` 配置项可声明式预置（`<username>:<token>[:<label>]`，token 形如 `tk_`+32 字符）；**令牌=该用户账号全权**（细粒度 token 在 roadmap） | 早期已有，2.18 后配合 PG | **合鸣"无鉴权"问题的一等公民解法** |
| 密码重置/magic link、`crypto/rand` 取代时钟种子 PRNG 生成 token/ID | v2.25.0 | 安全基线 |
| **ACL 内存缓存 `auth-access-cache`**（topic 授权查询曾是最高负载查询）+ SQLite ACL 大小写匹配漏洞修复 | v2.24.0 | 开 ACL 后性能可控 |
| **防 topic 枚举/抢占限速** `visitor-topic-creation-limit-burst/replenish`（默认 100 burst/1min） | v2.23.0 | 官方也认为 topic 名是攻击面 |
| 模板引擎 CPU DoS 修复（执行超时上限）、title 1KB/tags 512B 上限、**单次缓存 replay 上限 10MB**（`X-Messages-Truncated: 1`）、多 topic 轮询乱序修复 | v2.26.0 / v2.28.0 | 合鸣若用长轮询/重拉，服务端已有保护 |
| 邮箱验证 `smtp-sender-verify`、邮件通知防滥用 | v2.21.0 | 自部署可不启用 |
| S3 附件存储 | v2.20.0 | 合鸣附件可走 ntfy 附件通道（可选） |
| Web Push endpoint 白名单正则收紧（防 SSRF，GHSA-w9hq-5jg7-q4j7） | v2.22.0 | 说明 Web Push 路径有真实攻击面，自部署需跟进版本 |

**ntfy 定位判断**：它是"**HTTP pub-sub 通知服务**"，不是"IM 推送系统"。它的强项是发布侧（任意 HTTP POST 即可发）、订阅侧（SSE/长轮询/Web Push 三订阅形态）、自部署友好（单二进制/Docker、SQLite 起步、PG 可选）。它的**局限**：① topic 即身份，无"用户-设备"两级模型（合鸣要在应用层维护 topic↔device 映射）；② 无消息已送达回执/ack 语义（push 层无回执，只能靠应用层补拉确认）；③ 订阅侧鉴权粒度粗（token=全权，2.28 时点细粒度仍在 roadmap）；④ 单实例无官方集群（2.27 release note 原文："preparation for being able to cluster ntfy nodes... It'll be a while until then, baby steps"）——合鸣单服务器规模下无碍。

来源：
- https://api.github.com/repos/binwiederhier/ntfy/releases （v2.18.0~v2.28.0 全部 release notes 原文）
- https://raw.githubusercontent.com/binwiederhier/ntfy/main/docs/config.md （"Web Push"节、"Access tokens"节，行 813-891、1640-1665）
- https://raw.githubusercontent.com/binwiederhier/ntfy/main/docs/subscribe/pwa.md （PWA/Web Push 支持矩阵：iOS Safari 16.4+、Android Chrome）
- https://github.com/binwiederhier/ntfy （README、仓库结构：`webpush/`、`user/`、`db/` 目录证实能力存在）

### 1.2 APNs / FCM / Web Push 三方现状（2025-2026）

**FCM（Android 推送的事实标准）**。以下为基于公开文档的结论；**注意：firebase.google.com 在本环境直连超时，未能逐字核实 2026 最新公告，建议发布前人工复核**：
- **HTTP v1 API 是唯一现役服务端 API**：`POST https://fcm.googleapis.com/v1/projects/<project>/messages:send`，OAuth2 服务账号 JWT 鉴权，替代 2019 年起的 legacy HTTP（`fcm.googleapis.com/fcm/send` + legacy server key）。Legacy 路径与 legacy server key 已于 2025 年退役（Google 公告 2022 年宣布、2025 年执行，见 Firebase 公告页——未能直抓，标注待复核）。
- FCM 硬约束：① 需要 Google Play Services / 用户登录 Google 账号 → **中国大陆设备基本不可用**（合鸣"云端全走自建"的方向与之一致）；② 消息体 ~4KB 上限；③ 数据消息（data message）在 App 被杀时由系统代投，通知展示由厂商/系统决定。
- 对合鸣：FCM 是"海外用户覆盖"的可选项而非必选项；自建 ntfy 已覆盖国内主路径。

**APNs（iOS 唯一通道）**：
- 仍是 iOS 推送唯一通道，**2025-2026 无结构性变化**：payload 上限 4KB、`collapse-id`/`apns-collapse-id` 去重、静默推送（`content-available:1`）用于唤醒 App 拉数据（Apple 对静默推送限频，**长期不可靠，不应作为消息主通道**）。
- 自部署/无 Apple 开发者账号场景：APNs **无法自签自部署**（必须 Apple 证书 + 开发者账号），这是 iOS 离线推送的硬边界。国内自部署 IM 的现实解法是 iOS 端保持 WebSocket/长连接保活（iOS 的 background fetch + silent push 有限额）+ 用户手动保活（后台开关）——**合鸣 iOS 端应显式接受"iOS 离线推送弱于 Android"这个产品事实**。
- 来源：https://developer.apple.com/documentation/usernotifications （可达性已验证 200，细节未逐条抓取）；APNs 无 2025-2026 重大变更基于持续跟踪的已知事实，标注待人工复核。

**Web Push（VAPID，RFC 8030/8292）**：
- 2025-2026 状态：**标准稳定、无新修订**；生态位 = 桌面浏览器 + Android Chrome 的推送通道（Android Chrome 的 Web Push 底层即 FCM endpoint；iOS Safari 16.4+ 起支持 PWA 推送，**iOS 17/18/26 持续扩大 PWA 推送能力**——iOS PWA 推送在 2025-2026 是"部分可用"，Safari 对 Service Worker 支持到 18 才补齐，标注待复核）。
- 服务端实现：Node 用 `web-push` npm 包（**当前 latest `3.6.7`**，registry.npmjs.org 核实）。VAPID 密钥对生成后**永不过期**，subscription 有有效期（浏览器会发 unsubscribe 请求，服务端要处理 404/410 清理）。
- **ntfy 已原生实现 Web Push**（§1.1），等于合鸣若做桌面端 PWA，推送后端零开发。

### 1.3 Android 14/15/16 后台限制与自部署 IM 的可行推送路径

以下为 Android 平台事实的结论；**developer.android.com 本环境直连超时，版本细节（15/16 新增条款）标注"基于已知事实，建议发布前对官方文档人工复核"**：

**约束清单（按影响排序）**：
1. **Doze/电池优化**：App 被杀或进 Doze 后，长连接（SSE/HTTP 长轮询）会被系统切断——**这正是合鸣"前台 fetch 长轮询、App 被杀即断"的根因**。Doze 唤醒窗口（maintenance window）不可控（数小时一次，且随机化）。
2. **Foreground Service 收紧（Android 14+）**：启动 FGS 必须声明 `foregroundServiceType`；`dataSync` 类型 **1 小时自动终止**（Android 14 起），且**不允许被广播/Alarm 在后台启动**。Android 15 起 FGS 启动前必须先有前台 Activity 触发或用户可见操作（`whileInUse` 类更严）。→ **"常驻 dataSync FGS 保活长轮询"这条路在 14/15/16 上基本走不通**（合规性差 + 厂商 ROM 会杀）。
3. **WorkManager**：`setExpedited` 可在 ~10 分钟内执行任务，但**不能保证精确时延，不适合消息推送**，只适合"补拉"。
4. **通知**：Android 13+ 需运行时 `POST_NOTIFICATIONS` 权限；`NotificationChannel` 必须创建（合鸣已有）；低优先级通道会被折叠。
5. **厂商 ROM 杀后台**（国内现实第一杀手）：MIUI/EMUI/HarmonyOS 等对非白名单 App 的后台网络、自启动、进程保活有额外限制。**国内 Android 离线推送的终极解法仍是厂商通道（华为 Push Kit / 小米 Push / OPPO / vivo）**——这些通道走系统级 daemon，App 被杀也能达。但均需厂商开发者账号 + 审核，与合鸣"不依赖厂商"的产品红线冲突，属于**可选增强项**（用户可选项，非架构依赖）。

**自部署 IM 的现实可行路径（2025-2026 共识）**：

| 路径 | 机制 | 覆盖 | 合鸣适配 |
|---|---|---|---|
| **A. ntfy 订阅进程（推荐主路径）** | 手机侧跑一个"订阅进程"：① 独立 ntfy App（现成）；② 合鸣 App 内置订阅（UnifiedPush 客户端 SDK，或直接用 ntfy 的 SSE 连接 + `dataSync` FGS **仅在用户主动开启'消息接收服务'时**）；③ Android 14+ 下用户可把该服务加入电池白名单 | 杀 App 可收（只要订阅进程活着/被系统放行） | **主路径**。把"订阅"从合鸣主 App 里解耦出来是合规关键——主 App 前台才连 WS，后台消息由订阅进程负责 |
| **B. ntfy 鉴权模式（P0 必做）** | 每用户/每设备发一个 `tk_` access token，订阅带 `Authorization: Bearer`；topic 换随机 UUID | 防枚举、防冒发 | 现成机制，零自研 |
| **C. Web Push（桌面/Android Chrome）** | ntfy 原生 VAPID 转发 | 桌面浏览器、Android Chrome | 桌面端零开发 |
| **D. iOS：WS 保活 + 用户引导** | 前台 WS；后台 best-effort；显式产品告知 | 前台 100%，后台受限 | 接受现实，文档化 |
| **E. 厂商通道（可选）** | 华为/小米/OPPO/vivo Push Kit 桥接层 | 国内 ROM 杀后台场景 | 违反"不依赖厂商"红线，仅作为用户可选开关评估，**不进架构** |
| F. 自签证书/自建 APNs | 不存在 | — | 不可行（APNs 必须 Apple） |

**离线消息一致性**（无论哪条推送路径）：推送只是"门铃"，**消息本体必须走合鸣自己的 WS + 按 seq 补拉**。ntfy 缓存（SQLite/PG，可配 TTL）天然支持"门铃丢了再拉"——推送 payload 里只放 `messageSeq`，App 收到后按 seq 拉取增量。这一条与合鸣 IM 差距审计里"message seq + 幂等键"的 P0 项是同一件事。

### 1.4 合鸣可借鉴（机制级）

1. **topic 模型改造（P0，0.5 天）**：`devices` 表加 `ntfy_topic`（`uuidv4()`，注册时生成）+ `ntfy_token`（调 `ntfy token add` 或 `auth-tokens` 声明式预置，每设备一 token）；服务端所有 `POST /{topic}` 带 `Authorization: Bearer <push 侧服务 token>`。**弃用 `ensemble-<userId>` 可枚举 topic**——现有 topic 做一次迁移（旧 topic 停写，发一条"请重新订阅"的过渡消息后废弃）。
2. **推送 payload 脱敏（P0，0.5 天）**：正文不入推送。payload 只含 `{type, convId, msgSeq, senderId, previewHint(可选: "图片"/"文件")}`；通知栏文案统一"你有新消息"。合鸣既然做了 E2EE，推送带明文正文等于自毁卖点。
3. **订阅进程与主 App 解耦（P1，3-5 天）**：Android 端新增"消息接收服务"（`dataSync` FGS + 用户显式开启 + 引导加电池白名单），内部用 ntfy SSE 长连接（`?poll` 参数 + `since` 游标，2.28 后服务端有 replay 上限保护）；主 App 前台时 WS 优先、订阅进程自动挂起。iOS 端前台 WS + 后台 best-effort + 设置页引导。
4. **门铃+补拉语义（P0，与 seq 体系同批）**：推送只带 `msgSeq`；App 任意时刻按 `lastSeenSeq` 增量补拉（`GET /{topic}?poll=0&since=<id>` 或合鸣自有 API）。**ntfy 不是消息存储，合鸣 WS/HTTP 才是**——这条要写进架构文档，防止后续有人把 ntfy 当离线消息队列。
5. **桌面端 PWA（P2，低成本）**：若合鸣有 Web 端，直接用 ntfy 原生 Web Push（`ntfy webpush keys` 生成 VAPID、配 `web-push-*` 四项、浏览器 `push.subscribe` 存 endpoint 到 ntfy）——零自研推送后端。
6. **版本纪律（P1）**：自部署 ntfy 跟进上游 minor 版本（2.24 ACL 缓存、2.26/2.28 安全修复都跟合鸣相关）；开 PG 后端 + `auth-access-cache`。

---

## 2. MLS（RFC 9420）：标准化与实现成熟度

### 2.1 标准化状态

- **RFC 9420《The Messaging Layer Security (MLS) Protocol》**：IETF MLS WG 正式 RFC（2023-08 发布；rfc-editor.org 直抓核实，https://www.rfc-editor.org/rfc/rfc9420.html ）。摘要原文：为群组（10 ~ 10^10 成员）提供**高效的异步群组密钥建立，带前向保密（FS）与抗前向泄露（post-compromise security, PCS）**。
- 配套 RFC 9421（MLS 核心密码套件：AeadOnly / AeadSig，X25519/SHA-256 与 P-256/SHA-256 两套）。
- **2025-2026 的 MLS 增量全部在 IETF draft 层**（datatracker 本环境 404，未能逐条直抓 draft 号，标注待人工复核；但以下事实由 openmls 0.9.0 release notes 交叉证实存在并被实现跟踪）：
  - **MLS 后量子扩展**（PQ ciphersuites：P-384、ML-DSA-65、ML-KEM 混合 KEM）——openmls 0.9.0 已实现（见下）；
  - **targeted messages（定向消息）**：一条消息只发选定的子集成员——openmls 0.9.0 以 `targeted-messages-draft` feature flag 实现；
  - **keying material export**：RFC 9420 §8.3 定义的导出机制（把 MLS 群密钥导出给非 MLS 协议，如加密文件/密钥管理），是 MLS 对接"群组共享加密存储"的标准原语。

### 2.2 实现成熟度（2026-09 核实）

| 实现 | 状态 | 证据 |
|---|---|---|
| **openmls（Rust）** | **参考实现，生产可用**。`v0.9.0`（2026-08-03 发布、08-25 tag），1022★，2026-09-04 仍在 push。0.9.0 要点（release notes 原文）：**P-384 + ML-DSA + 额外 PQ 密码套件**（#2046/#2118）；**targeted messages**（#2028/#2128，draft flag）；**历史 epoch secret 时间化删除 API**（#1972，合规/存储关键）；**存储格式迁移工具** `migration-import`（bincode→CBOR）；`propose_self_update_with_new_signer`（密钥轮换）；MSRV Rust 1.91；不再支持非自描述存储格式 | https://api.github.com/repos/openmls/openmls/releases 、https://api.github.com/repos/openmls/openmls |
| **Signal** | **未采用 MLS**。Signal 群聊 = 自研 **Group v3**（基于 zkgroup 零知识群凭证 + Sender Key 同步），1:1 = X3DH + Double Ratchet。Signal 的公开研究在**后量子棘轮（SPQR，§5）**而非 MLS——其方向判断：双棘轮体验（双向 ratchet、断线重连恢复语义）优于纯树形协议的工程性价比，但群规模上限（Group v3 ~1000 人）和 PQ 升级路径是它自己研究 SPQR 的原因 | https://github.com/signalapp/libsignal （monorepo 无 MLS crate）；https://github.com/signalapp/SparsePostQuantumRatchet |
| **Matrix / Element** | 历史上最激进的 MLS 落地者：`vodozov`（Rust，已并入 matrix-rust-sdk）、`matrix-rust-sdk-crypto-wasm`（39★，2026-09-03 push，**WASM 打包路径现成**）；Element 客户端 MLS 实验版与 synapse 服务端 2023-2025 逐步上线；2025-2026 处于"实验可用、默认未全量"状态。对合鸣的价值：**证明了"Rust MLS → WASM → JS/RN"桥接路线工程可行** | https://api.github.com/repos/matrix-org/matrix-rust-sdk-crypto-wasm |
| **TypeScript/RN 生态** | **真空**。GitHub search 结果：`MLS4RN`（"OpenMLS for TypeScript... for web, Node.js, and React"，0★，2026-08-22）、`marmot-ts`（MLS+Nostr，2★ WIP，2026-02）、`whispee`（MLS 加密 messenger，0★）。**没有 star>50、没有生产用户背书** | https://api.github.com/search/repositories?q=openmls+typescript |
| 其他 | Signal 系无；Google 曾参与 MLS WG 但无公开产品化（Conscrypt 无 MLS）；Apple 无公开 MLS 产品化（iMessage 群聊仍是自研三方/多方方案） | 已知事实，标注待复核 |

### 2.3 对自部署 IM 群聊 E2EE 的可行性评估

**性能**（基于 openmls 公开 benchmark 与 MLS 协议结构，标注：未在本环境重跑，引用已知数据）：
- **加入**（Joiner 处理 Welcome + 全量 group info）：O(n) 条 leaf + O(log n) 路径更新处理；100 人群加入约几十 ms 级（Rust）。
- **离会/更新**（Commit）：**O(log n)** 路径加密——这是 MLS 相对 Sender Key（离会=全员密钥作废需重发）的核心优势。
- **发消息**：O(1)（对称加密到当前 epoch 密钥）。
- **存储**：每成员每群需保留 group state（含历史 epoch secret，用于处理乱序/补拉）；openmls 0.9 新增时间化删除 API 说明**存储治理已是协议级议题**；100 人群单成员状态 ~KB-数十 KB 量级，手机侧无压力。
- **合鸣 <50 人场景：性能完全不是瓶颈**。瓶颈在工程成本（§2.4）。

**keying material export**：RFC 9420 标准原语，可把群密钥导出为对称密钥给合鸣的"群组共享加密文件/AI 工作区"用——这是 MLS 相对 Sender Key 的**独有增量能力**（Sender Key 无法导出给协议外组件）。若合鸣未来做"群组共享加密知识库/AI 上下文"，MLS 的 export 是干净解。

### 2.4 合鸣可借鉴（机制级）

1. **现在不切 MLS，但协议字段预留**：合鸣群消息信封加 `kdf/suite` 字段（值域含 `sender-key-v1` / `mls-rfc9420`），群级元数据加 `group_epoch` 占位。切换时不改传输层。
2. **WASM 桥路线提前验证（P2，spike 1 周）**：参考 `matrix-rust-sdk-crypto-wasm` 的打包方式（wasm-pack → N-API/ESM），对 openmls 0.9 做一次 RN 内 100 人群加/发/离 benchmark。**Hermes 侧无特殊风险**（WASM 在 Hermes 有原生支持），风险在 Android 端 wasm runtime 一致性（Hermes 内置）与包体（openmls WASM ~2-5MB）。
3. **存储治理照抄 openmls 0.9 的 API 语义**：无论最终 Sender Key 还是 MLS，合鸣群密钥存储要实现"epoch secret 时间化删除"（用户退出/合规删除的底线能力）。
4. **跟踪两个信号再定切换时机**：① Signal 若在任何产品线（含 Group v4 或 Web）采用 MLS 或其 SPQR 产品化进官方客户端——说明 PQ+群聊的工程难题被趟平；② 出现 star>100 的 TS/RN MLS 库。当前两个信号都未亮。

---

## 3. Signal 协议族 2025-2026 现状

### 3.1 X3DH + Double Ratchet：仍是事实标准

- **1:1 消息**：X3DH（初始密钥建立，4 个 DH 对）+ Double Ratchet（对称棘轮 + DH 棘轮）自 2016 年起无替代者。Signal 2025-2026 的全部协议增量是**在其上叠加后量子层**（SPQR，§5），而非替换——这本身就是"仍是事实标准"的最强证据。
- **群聊**：**Sender Key 模式**（Group v1/v2/v3）——每发送者维护一条 Sender Chain，用同步消息（sync message）把 chain 头分发给成员；Group v3 用 zkgroup 凭证做"谁在群里"的零知识管理（防止未授权成员获得历史/未来密钥）。**群规模上限 ~1000**，超出拆群。
- 协议文档：signal.org/docs/specifications/（X3DH / Double Ratchet / Group / OMemo）——**本环境 signal.org 直连超时，未能逐字核实 2026 是否有新版本文档，标注待人工复核**；协议核心自 2019（Group v2）/2022（Group v3）以来无破坏性变更。

### 3.2 libsignal 绑定格局：全部收敛到 Rust monorepo

（GitHub API 核实，https://api.github.com/orgs/signalapp/repos ）：

- **现役**：`signalapp/libsignal`（6001★，2026-09-03 push）——Rust 核心，对外暴露 **Java / Swift / TypeScript** 三套库 + Rust crate。README 原文："The products of this repository are the Java, Swift, and TypeScript libraries that wrap the underlying Rust implementations... **Use outside of Signal is unsupported**... backwards-incompatible changes... reflected in the version number on a best-effort basis"。
- **已归档（archived: true）**：`libsignal-protocol-java`(1851★)、`libsignal-protocol-javascript`(1957★)、`libsignal-protocol-swift`、`libsignal-protocol-c`(1418★)、`libsignal-protocol-rust`、`libsignal-ffi`、`libsignal-client-node`、`libsignal-service-java`——**所有独立语言绑定仓库均已归档**。
- **官方 Node.js/RN 绑定：不存在**。TypeScript 库存在但是给 Signal-Desktop 用的（包 Rust 的 N-API addon）。
- **社区 Node/RN 路径**（GitHub search 核实）：
  - `PeculiarVentures/2key-ratchet`（125★，2026-04 push）：TypeScript 实现 X3DH + Double Ratchet——**最接近"Node 可用 libsignal 等价物"**，纯 TS 无 native 依赖，Hermes 零障碍；但它是研究/库级，未经 Signal 级攻击审计。
  - `raphaelvserafim/libsignal`（5★，2026-06 push）："Modern TypeScript implementation of the Signal Protocol for Node.js"——活跃但极小。
  - `soatok/rawr-x3dh`（100★，2023 止更）：X3DH 参考 TS 实现（soatok = 前 Signal 工程师）。
  - RN 专用：`p-num/react-native-libsignal-client`(4★，2025-12)、`gooltu/expo-libsignal`(0★，2026-07)、`vineyardbovines/expo-libsignal`(0★，2026-06)、`deez-in/expo-libsignal-dezire`(0★，2026-09)——**全部零星尝试，无一成熟**，`dezire` 是社区 Rust Signal 库的 Expo 包装。
- **Hermes 兼容坑（机制级清单）**：
  1. **N-API addon 路径**：libsignal Rust 编译为 N-API `.node`，Android 需 per-ABI AAR 打包（arm64-v8a/armeabi-v7a）、iOS 需 xcframework；Hermes 下 N-API 可加载但**与 JSC 构建互斥**，Expo 需 `expo prebuild` + 原生模块（config plugin）维护——**这正是 2025-2026 仍有 4+ 个 0-4★ 的 expo-libsignal 仓库并存的原因：坑在打包链，不在协议**。
  2. **纯 TS 路径**：`2key-ratchet`/`rawr-x3dh` 类实现零 native 依赖，Hermes 直接跑，**坑只剩 CPU**（X25519 纯 JS 实现约比 native 慢 10-50×，单消息 <5ms 量级，IM 可接受；群同步消息批量场景需关注）。
  3. **`@noble/curves` / `@stablelib/x25519`**（npm latest 可达性已核实）：当前 Node/RN 纯 JS 密码学首选原语层（noble 系在 Signal 协议 TS 实现里是事实标准底座），合鸣现有 Curve25519 预密钥体系建议直接对齐 noble 的 API 面，降低未来迁移成本。

### 3.3 合鸣可借鉴（机制级）

1. **合鸣 1:1 链路：不重写，按协议对齐**。合鸣已有 X25519 预密钥（非 libsignal），2025-2026 的现实选择是**用 `2key-ratchet` 作为协议参考实现**（MIT 类许可，125★，2026 活跃），逐函数对齐 X3DH 四 DH 组合 + Double Ratchet 的 ratchet tree 语义，而不是直接依赖它（保持自研可控，但把"正确性"外包给对照实现 + 互操作测试向量）。
2. **密钥存储格式向 libsignal 的 record 模型看齐**：`SessionRecord`（含 root/ratchet 状态）+ `PreKeyBundle`（signed prekey + one-time prekeys）+ `SenderKeyRecord`（群）。合鸣若已自造格式，趁迁移成本最低时（现在）对齐语义：one-time prekey 的**服务端消耗后删除**、signed prekey 的**2^64 计数器**、prekey 包批量拉取（`/keys/<deviceId>` 一次拉 10-20 条）——这些是 X3DH 工程化的标准件。
3. **Rust 绑定押后**：libsignal monorepo 的 TS 库"unsupported outside Signal"+ 版本化是 best-effort，**不适合做合鸣的硬依赖**；SPQR（§5）同样"integration-friendly 但 experimental"。结论：**合鸣密码学层保持纯 TS + noble 原语，把 native 化作为"性能不够再说"的选项**——<50 人 IM 的消息频率下纯 TS 足够。
4. **审计与测试向量**：Double Ratchet 有官方测试向量（signal 协议文档附）；合鸣自研棘轮应跑 Signal 官方 + `2key-ratchet` 双套向量做互操作证明。这一步便宜且是安全叙事的基础。

---

## 4. 群聊 E2EE 轻量替代：<50 人场景选型

### 4.1 三方案机制对比

| 维度 | 每对独立 ratchet | **Sender Key（Megolm 模式）** | 树结构（MLS/自研 Merkle） |
|---|---|---|---|
| 密钥数量（n 人） | O(n²)=n(n-1)/2（n=50 → 1225） | O(n)（每人 1 条 Sender Chain） | O(n) leaf + O(log n) 路径状态 |
| 发一条群消息 | 对每个成员各发一份（n-1 条加密） | 1 条（对当前 Sender Key） | 1 条（对当前 epoch 密钥） |
| 新人加入 | 全量 n-1 条历史密钥线重建 | **O(1)：发送者发 1 条 sync message** | O(log n) commit + Welcome |
| 成员离会 | 与每个人各断一条线 | 离会者密钥作废；**其他成员不立即感知（靠密钥轮转/协议外通知）** | **O(log n)，密码学上即时生效**（离会者失去未来密钥） |
| 前向保密粒度 | 最强（每对独立 ratchet） | 中（Sender Chain 有 ratchet，但一条链服务全群） | 强（每 epoch 可作废旧密钥） |
| 抗成员泄露（PCS） | 弱（链被破=该对全泄） | 中（该发送者的 chain 泄=其消息泄；轮转止损） | 最强（commit 后历史 epoch 可删） |
| 工程成本（TS，合鸣现状） | 低（已有两两预密钥） | **低-中（约 1-2 周）** | **高（MLS 直接依赖 openmls，Rust/WASM）** |
| 适用规模 | <10 | **10~200（<50 甜区）** | >100，或合规强需求 |

### 4.2 2025-2026 生态事实

- **Sender Key 是三个成熟系统的共同选择**：Signal Group v1-v3（~1000 人上限）、OMEMO（Conversations 等 Signal-Android 分叉，群 + 多设备）、Matrix Megolm（room key 轮转的 Sender Key 变体）。**<50 人场景没有第二个有产品验证的答案。**
- 自研"简化树结构"（非 MLS 的 Merkle/Clifford 树）在 2025-2026 无主流产品采用；学术上 tree-based group KEX（如 Ratchet Groups、Tresorit 树）都在证明"树在 100+ 人才优于 Sender Key"。**<50 人自研树 = 花 MLS 的复杂度买不到 MLS 的收益。**
- MLS 的正确性成本（§2.3）：<50 人下性能无差异，差异全在**离会即失效**与 **keying material export** 两个特性上。若合鸣群里有"高频成员变动"或"群组共享加密资产"需求，才值得为这两个特性付复杂度。

### 4.3 对合鸣半环现状（kex_complete 发了无人接收）的收口

合鸣现状 = 两两 Curve25519 预密钥 + 群聊无协议（kex_complete 无接收方）。用 Sender Key 模式收口的具体改动：

1. **群 = 每发送者一条 SenderKeyRecord**：`{senderId, chainKey, msgKeySeed, ratchetState}`，发送者本地生成，**通过"群同步消息"（加密给每个成员的 1:1 ratchet）分发 chain 头**——复用合鸣现有两两预密钥通道，不改 1:1 协议。
2. **kex_complete 的归宿**：它本来想做的"群密钥协商完成"语义，由"每个发送者各自发 sync message + 成员确认 ACK"替代；**删除无接收方的 kex_complete，换成有明确接收方（群内每成员）的 sender-key-sync 消息**。
3. **轮转策略**：每 N 条消息（Signal Group v1 默认无强制轮转，Megolm 是 1000 条/房间密钥）或每 T 时间轮转 Sender Chain；成员离会时管理员触发**全体重发 sync message**（n=50 时 = 50 条 1:1 加密消息，秒级完成）。
4. **消息格式**：`{groupId, senderId, counter, ciphertext, mac}`，counter 乱序检测 + 去重（幂等键 = groupId+senderId+counter，与合鸣 IM 审计的幂等键 P0 同批做）。

### 4.4 合鸣可借鉴（机制级）

1. **P1 主路径**：按 §4.3 四步实现 Sender Key（1-2 周），协议信封预留 `suite` 字段（`sk-v1`），**不为 <50 人场景引入任何树结构**。
2. **离会处理用"应用层通知 + 密码学轮转"双保险**：合鸣是可信服务端（单组织自部署），离会事件由服务端广播"请轮转"，密码学上靠轮转止损——**不需要 MLS 级的即时密码学踢出**，这是单组织场景相对公网 IM 的合理简化，但要在安全文档里写明白这个假设（服务端可信）。
3. **密钥生命周期存储**：SenderKeyRecord 按 `groupId × senderId` 索引，随群解散/用户退群清理；对齐 §2.4.3 的"epoch secret 时间化删除"语义，未来切 MLS 时存储层不用重写。
4. **验证基准**：用 Megolm 公开测试向量（matrix 生态有完整向量集）做对照测试，成本 <1 天，换来"与已审计实现语义一致"的可证明性。

---

## 5. 后量子混合：ML-KEM × X25519 的 2025-2026 状态

### 5.1 标准化状态

- **FIPS 203（ML-KEM，原 Kyber）2024-08 正式发布**（nvlpubs.nist.gov 可达性核实 200；https://nvlpubs.nist.gov/nistpubs/fips/NIST.FIPS.203.pdf ）。三级：ML-KEM-512/768/1024，**ML-KEM-768 是安全强度对齐经典 256 位（≈X25519 量级）的默认选择**。
- **混合组合（hybrid）已是 2025-2026 所有主要协议栈的默认**：
  - **TLS 1.3 `X25519MLKEM768` 套件**：2024 起 Chrome/Firefox/Safari 与主流服务端（nginx/OpenSSL 3.2+/BoringSSL）默认协商，**2026 年已占 TLS 握手多数**（标注：占比数据来自持续跟踪，未在本环境实测，建议需要精确数字时人工复核）。
  - **IETF 各 WG 的 hybrid 组合在 2025-2026 批量落地**（GitHub 可见活跃实现）：`tlswg/tls-ecdhe-mlkem`（2026-08 push）、IKEv2/IPsec ML-KEM 混合（`csosto-pk/pq-mlkem-ikev2`，2026-07）、SM2+ML-KEM（Tongsuo，2025-11）。**模式高度一致：X25519(或本地算法) × ML-KEM768，共享密钥拼接或 HKDF 双输入。**
  - **MLS PQ 扩展**：openmls 0.9.0 已实现（P-384、ML-DSA、PQ ciphersuites，#2046/#2118）——MLS 的 PQ 路线是"新密码套件"而非"改协议"，对合鸣的启示是**混合层应做成 suite 字段可切换的**。
  - **datatracker 本环境 404，ML-KEM 各 IETF draft 的最新编号未能逐条核实，标注待人工复核**；但上述产品/实现状态足以支撑"标准化完成、混合是默认"的结论。

### 5.2 产品/库采用

| 项目 | 状态 | 证据 |
|---|---|---|
| **libsodium** | **`1.0.22-RELEASE`（2026-04-09）**新增：`crypto_kem_mlkem768_*`（NIST 标准 KEM）+ **"X-Wing" 混合 KEM（ML-KEM768 + X25519）挂在标准 `crypto_kem_*` 接口上**，release notes 原文："X-Wing is the recommended KEM for most applications"；另有 SHA-3 全系列。→ **C 库层面后量子混合已"官方推荐默认"** | https://api.github.com/repos/jedisct1/libsodium/releases |
| **sodium-native（Node 绑定）** | **`5.1.0`（当前 latest，registry.npmjs.org 核实）README/package 中无任何 ML-KEM/X-Wing 暴露**——sodium-native 跟随 libsodium 的 API 面，1.0.22 的 KEM 系列**尚未透出**（标注：以 npm 元数据与 README 为准，若已透出而本文抓取版本文档滞后，需复核 5.1.0 完整导出表） | https://registry.npmjs.org/sodium-native/latest |
| **Signal** | **SPQR（SparsePostQuantumRatchet）**：`signalapp/SparsePostQuantumRatchet`（2025-04-24 建库，2026-07-20 push，70★）。README 原文要点：Rust 实现；输出 *message keys* 供"hybrid secure"协议集成（**不实现完整消息协议**）；`v1/` 模块实现 **ML-KEM Braid Protocol**（用 ML-KEM 替代 Double Ratchet 的 DH 公共棘轮）；Reed-Solomon 擦除编码做 chunk 化（丢 N 中任意 chunk 可重建）；**F*/hax 机器验证 panic-free**。→ 这是 Signal 后量子路线的"可集成核心"，**尚未进官方客户端**（Signal-Android 2026-09-04 的 push 无 SPQR 合入迹象，标注：未逐 commit 核实） | https://api.github.com/repos/signalapp/SparsePostQuantumRatchet |
| **OpenSSL/BoringSSL** | X25519MLKEM768 TLS 套件已默认（随 FIPS 203 落地，标注待复核具体版本线） | 已知事实 |
| **WASM/纯 JS** | `@noble/curves` 已含 ML-KEM 实现（noble 系 2024 起提供，npm 可达性核实；具体 API 版本标注待复核）；纯 JS ML-KEM 性能可接受（封装 ~100μs 量级） | https://registry.npmjs.org/@noble%2Fcurves/latest |

### 5.3 对合鸣现有预密钥体系的迁移成本

合鸣现状 = Curve25519（X25519）预密钥，非 libsignal。迁移到混合 KEX 的**最小改动集**：

1. **密钥对**：每用户/设备生成 `(X25519 密钥对, ML-KEM-768 密钥对)`；prekey bundle 里加 `mlkemPub` 字段（~1.1KB，ML-KEM-768 公钥 1184 字节——**这是 payload 体积的唯一显著成本**，prekey 批量拉取时一次性成本，可接受）。
2. **KEX 计算**：`shared = HKDF( X25519(A.puber, B.priv) ‖ MLEncaps(B.mlkemPub, r), salt, info="ensemble-hybrid-v1" )`——**经典侧保证后向兼容（旧客户端可继续用纯 X25519 分支），量子侧提供 HST（harvest-now-decrypt-later）防护**。这正是 X25519MLKEM768/X-Wing/SPQR 全部采用的结构。
3. **棘轮不动**：Double Ratchet/Sender Chain 的输入是 `shared`，混合与否对下游透明。
4. **套件协商**：prekey bundle 与消息头加 `kexSuite` 字段（`x25519` / `x25519-mlkem768`），新旧版本客户端混跑期按交集协商（新客户端 × 新客户端 → 混合；任一旧 → 经典）。
5. **TS 实现**：`@noble/curves` 的 ML-KEM API 或 WASM 版 libsodium 1.0.22（若 sodium-native 未透出，可用 `libsodium` WASM sumo 构建——registry 可达性核实 `libsodium-wrappers-sumo` 200）。
6. **工作量估计**：1-2 周（含互操作测试向量、新旧混跑期测试）。**这是五个主题里"成本最低 × 安全叙事收益最高"的一项**。

### 5.4 合鸣可借鉴（机制级）

1. **P0 顺带做混合 KEX**（理由：prekey 体系已有，改动封闭在密钥交换层；且"后量子就绪"对自部署企业客户是可直接写入安全白皮书的卖点）。按 §5.3 五步走。
2. **命名对齐**：直接叫 `x25519-mlkem768`（与 TLS 套件同名），不自造命名——评审与审计时零解释成本。
3. **跟踪 SPQR 而非复刻**：Signal 的后量子棘轮（PCS 增强）与合鸣 Sender Key 路线（§4）在 2026 无交集（SPQR 强化的是 1:1 棘轮，且 experimental）。**1:1 混合 KEX 现在就做（§5.3），棘轮级 PQ 等 SPQR 进官方客户端或出现 Rust→RN 成熟桥后再评估。**
4. **sodium-native 透出 ML-KEM 是明确的切换信号**：届时合鸣密码学底座可整体从 noble 迁到 sodium（API 更收敛、审计轨迹更短），但**现在不必等**——noble 的 ML-KEM 已可用。

---

## 6. 合鸣落地优先级建议

> 原则：**短期 ntfy 加固 = 不换基础设施、只换用法**；**长期 MLS/libsignal = 协议字段预留 + spike 验证，不提前切**。两条路径不冲突：短期动作全部是长期路径的前置（seq 体系、密钥记录模型、suite 字段）。

### P0（本周-两周，全部 <1 人周，直接止血）

| # | 事项 | 机制 | 对应章节 |
|---|---|---|---|
| P0-1 | ntfy topic 随机化 + per-device token | `devices.ntfy_topic=uuidv4()` + `ntfy token add`/`auth-tokens`；服务端发推带 Bearer；弃用 `ensemble-<userId>` 并迁移 | §1.4.1 |
| P0-2 | 推送正文脱敏 | payload 只含 `{type, convId, msgSeq, senderId}`；通知文案"你有新消息" | §1.4.2 |
| P0-3 | 门铃+补拉语义落地 | 推送只带 `msgSeq`；App 按 `lastSeenSeq` 增量补拉（复用 WS/HTTP，不用 ntfy 当消息存储） | §1.4.4 |
| P0-4 | **混合 KEX（x25519-mlkem768）上线** | prekey bundle 加 `mlkemPub` + `kexSuite` 协商；棘轮下游透明 | §5.3/§5.4.1 |
| P0-5 | ntfy 升级到 ≥2.28.0 + 开 ACL 缓存 | 跟进 2.24/2.26/2.28 安全修复；PG 后端评估 | §1.4.6 |

### P1（本季度，1-3 人周量级，结构性补课）

| # | 事项 | 机制 | 对应章节 |
|---|---|---|---|
| P1-1 | **群聊 Sender Key 收口半环** | 按 §4.3 四步：SenderKeyRecord + sync message（走现有 1:1 通道）+ 删除无接收方的 kex_complete + `groupId+senderId+counter` 幂等键；Megolm 向量对照测试 | §4.3/§4.4 |
| P1-2 | Android 订阅进程解耦 | 独立"消息接收服务"（用户显式开启 + `dataSync` FGS + 电池白名单引导）跑 ntfy SSE（`since` 游标）；主 App 前台 WS 优先 | §1.4.3 |
| P1-3 | iOS 端保活策略产品化 | 前台 WS + 后台 best-effort + 设置页显式引导（文档化"iOS 离线推送受限"） | §1.3-D |
| P1-4 | 1:1 棘轮向 X3DH/Double Ratchet 协议对齐 | 以 `2key-ratchet` 为参考实现做语义对齐 + 双套测试向量；密钥存储对齐 SessionRecord/PreKeyBundle 模型（one-time prekey 消耗删除、signed prekey 计数器） | §3.3 |
| P1-5 | 推送通道抽象层 | `PushProvider` 接口（`ntfy`/`webpush`/`ws` 三实现），为将来厂商通道/FCM（海外用户）留插槽但不实现 | §1.3 |

### P2（半年+，跟踪信号驱动，不排期硬承诺）

| # | 事项 | 触发信号 | 对应章节 |
|---|---|---|---|
| P2-1 | MLS spike（openmls 0.9 WASM → RN） | 无条件可做（1 周 benchmark）；**切 MLS** 的信号：群规模需求 >200 或出现成熟 TS/RN MLS 库（star>100） | §2.4 |
| P2-2 | 协议字段预留（现在做，成本≈0） | 群消息信封 `suite` 字段（`sk-v1`/`mls-rfc9420`）+ `group_epoch` 占位 | §2.4.1 |
| P2-3 | 棘轮级后量子（SPQR 集成） | 信号：SPQR 进 Signal 官方客户端 或 出现成熟 Rust→RN 桥 | §5.4.3 |
| P2-4 | 桌面端 PWA + ntfy 原生 Web Push | 桌面端立项时顺带（零自研后端） | §1.4.5 |
| P2-5 | 厂商推送通道（华为/小米/OPPO/vivo） | 仅当国内 ROM 杀后台数据占比 > 可接受阈值，且用户调研支持"可选厂商通道"；**保持架构不依赖** | §1.3-E |

### 路径选择的明确表态

- **短期（ntfy 加固）**：P0-1~3/5 是"用法纠偏"，不是"架构变更"，无技术风险，**本周即可全部开工**。
- **中期（Sender Key + 混合 KEX）**：这是**唯一推荐的"现在做"的密码学投资**。Sender Key 是三个成熟系统验证过的 <50 人答案（§4.2）；混合 KEX 是迁移成本最低的后量子动作（§5.3）。两者合计约 3-5 人周。
- **长期（MLS/libsignal）**：**明确不提前切**。MLS 在 <50 人无性能收益（§2.3），TS/RN 栈真空（§2.2），Signal 自己都未采用；libsignal 无官方 Node/RN 绑定且"unsupported outside Signal"（§3.2）。正确姿势是 **§6-P2-2 的字段预留 + P2-1 的年度 spike**，等两个外部信号（Signal 采用 MLS/SPQR 产品化；成熟 TS MLS 库出现）再切换。

---

## 7. 来源清单

**A. 直抓核实（curl 一手来源，本环境可达）**

1. ntfy releases API（v2.18.0~v2.28.0 全部 release notes 原文）：https://api.github.com/repos/binwiederhier/ntfy/releases
2. ntfy 配置文档源（Web Push 节、Access tokens 节、PostgreSQL 节）：https://raw.githubusercontent.com/binwiederhier/ntfy/main/docs/config.md
3. ntfy PWA 订阅文档源：https://raw.githubusercontent.com/binwiederhier/ntfy/main/docs/subscribe/pwa.md
4. ntfy README / 仓库结构（`webpush/`、`user/`、`db/`）：https://github.com/binwiederhier/ntfy
5. RFC 9420（MLS 协议）标题/摘要/external join 验证：https://www.rfc-editor.org/rfc/rfc9420.html
6. RFC 9421（MLS 密码套件）可达性：https://www.rfc-editor.org/rfc/rfc9421
7. openmls releases（v0.6.0~v0.9.0，含 0.9.0 完整 notes：PQ ciphersuites、targeted messages、epoch secret 删除、迁移工具、MSRV）：https://api.github.com/repos/openmls/openmls/releases
8. openmls 仓库元数据（1022★，2026-09-04 push）：https://api.github.com/repos/openmls/openmls
9. signalapp org 仓库全量清单（libsignal monorepo 6001★；libsignal-protocol-{java,javascript,swift,c,rust} 等 10+ 独立绑定全部 archived）：https://api.github.com/orgs/signalapp/repos
10. libsignal monorepo README（Java/Swift/TypeScript 包 Rust；"Use outside of Signal is unsupported"）：https://github.com/signalapp/libsignal
11. Signal SPQR 仓库 + README（ML-KEM Braid Protocol、F*/hax 验证、message keys 输出设计、2025-04 建库/2026-07 push/70★）：https://github.com/signalapp/SparsePostQuantumRatchet
12. libsodium releases（1.0.22-RELEASE 2026-04-09：ML-KEM768 + X-Wing 混合 KEM + SHA-3）：https://api.github.com/repos/jedisct1/libsodium/releases
13. sodium-native npm latest（5.1.0，无 ML-KEM 暴露）：https://registry.npmjs.org/sodium-native/latest
14. web-push npm latest（3.6.7）：https://registry.npmjs.org/web-push/latest
15. `@noble/curves`、`libsodium-wrappers-sumo`、`@stablelib/x25519`、`signal-utils` npm 可达性：https://registry.npmjs.org
16. GitHub search API（X3DH/Double Ratchet TS 实现：`PeculiarVentures/2key-ratchet` 125★/2026-04；`soatok/rawr-x3dh` 100★；RN libsignal 尝试 4+ 个 0-4★；TS MLS 库 `MLS4RN`/`marmot-ts` 0-2★）：https://api.github.com/search/repositories
17. matrix-rust-sdk-crypto-wasm（WASM 打包路径参照，39★，2026-09-03 push）：https://api.github.com/repos/matrix-org/matrix-rust-sdk-crypto-wasm
18. NIST FIPS 203（ML-KEM）可达性：https://nvlpubs.nist.gov/nistpubs/fips/NIST.FIPS.203.pdf
19. RFC 9728/9731（OAuth 资源元数据/客户端注册，MCP 生态背景）可达性：https://www.rfc-editor.org/rfc/rfc9728 、https://www.rfc-editor.org/rfc/rfc9731
20. RFC 8030/8292（Web Push）——经 ntfy config.md 引用链间接核实（ntfy 文档原文链接）：https://datatracker.ietf.org/doc/html/rfc8030

**B. 本环境网络受限、未能直抓的官方源（相关结论已在正文标注"待人工复核"）**

- firebase.google.com（FCM HTTP v1 现状/legacy 退役公告）
- developer.android.com / developers.google.com（Android 14/15/16 FGS/Doze 条款细节）
- signal.org（协议文档 2026 最新版号、SPQR 进官方客户端的 commit 证据）
- omemo.net（OMEMO 2.x spec）
- datatracker.ietf.org（MLS PQ 扩展、targeted messages 的具体 draft 编号）
- unifiedpush.de（UnifiedPush 协议细节——本文仅经 ntfy 能力交叉引用）

**C. 背景材料（本仓库内文档）**

- `docs/自建推送方案-ntfy.md`（合鸣现有推送架构与部署方案）
- `docs/research-agent-competitors-2026-09-05.md`（同日竞品调研，ntfy 作为 A2A push 通道的定位互补）
- 项目记忆：`audit-2026-09-04-findings`（ntfy topic 可枚举 P0）、`im-gap-analysis`（message seq + 幂等键 P0）、`no-real-ip-anywhere`（隐私红线）
