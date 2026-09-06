# 合鸣 E2EE 与设备配对域 — 密码学/安全深度审计（2026-09-05）

范围：移动端 E2EE 实现、服务端 `/api/e2e/*` 密钥目录、X3DH 密钥交换闭环、`/api/pairs` 设备配对、密钥存储与销毁。只读审查，未修改任何代码。
基线：分支 `claude/clever-bose-949a87`（HEAD 400b6ed）。外部主机一律 `<SERVER_IP>`，密钥一律 `<SECRET>`。
前置报告：`docs/audit-backend-2026-09-04.md`（后端挂载/表缺失）、`docs/audit-cross-cutting-2026-09-05.md`、`docs/feature-fill-2026-09-05.md`（E2EE「半环」）。本报告的定位是「深化 + 核实 + 扩展」：已知条目逐条复核并更新行号，新发现标 `NEW`。

---

## 0. TL;DR

**「E2EE」当前在三个端上都无法真正闭环，且原因分三层、相互独立、逐层递进：**

1. **服务端密钥目录整体未挂载**（复核确认，`[P0]`）。`e2eRouter` 只在 `e2e.test.ts` 里被 `app.use`，生产 `app.ts` 的挂载清单（138–156 行）里**没有** `/api/e2e`。已部署服务器对 `/api/e2e/register|bundle|opks|capability` 一律 404。且即使挂载也会崩：`Store` 缺 `upsertE2eIdentity/getE2eBundle/...` 五个方法、`sqlite.ts` 缺 `e2e_identities / e2e_one_time_prekeys` 两张表（都是 2026-08-27 的 `fc308dc` 一次「v0.8.1~v0.8.42」大合并把 app.ts/sqlite.ts/store.ts 回退导致的）。

2. **移动端有一处独立的、致命的密码学 ArrayBuffer 池别名 bug**（`[P0] NEW`，此前审计未发现）。`e2eService.ts:69-71` 与 `store.ts:23-25` 的 `b64ToAb` 返回 `Buffer.from(b64,'base64').buffer` —— 这是 `buffer` 包的 **8KB 内存池**（实测 `byteLength=8192`、`byteOffset=128`），而非 32 字节的密钥本体。libsignal 的 `validatePrivKey`/`validatePubKeyFormat` 对 `byteLength != 32/33` 直接抛 `Invalid private key / Invalid public key`。后果：**移动端既无法从服务端 bundle 建会话（`processPreKey` 里 ECDHE 拿 8192 字节公钥→抛错），也无法加载任何已存私钥（二次启动/重启后全崩）**。我已在 `buffer` 包上实证复现。讽刺的是同文件 `utf8ToAb`（e2eService.ts:39）专门写了注释修掉「明文」的池问题，却漏掉了「密钥」的池问题——是未被捕获的真 bug。

3. **设备配对 API 同样整体未挂载**（复核确认 + 扩展，`[P0]`）。`pairsRouter` 只在 `pairs.test.ts` 挂载；生产 `app.ts` 无 `/api/pairs`；`sqlite.ts` 无 `pair_codes / device_pairs / device_link_events` 三张表；`ctx.deviceLinkLog` 在 `context.ts` 中不存在。`/api/pairs/code|confirm` 404，`/:pairId/events` 即便路由在也会因缺 `deviceLinkLog` 崩溃。

叠加结论：即便把第 1、3 点修好（挂载 + 补表 + 补方法），移动端因第 2 点仍然一条密文都发不出、收不下——三层里任意一层没修，「E2EE」都是坏的。当前对外「端到端加密」的宣传，在威胁模型意义上**等价于明文**（且比明文多一层「以为在加密实则全走明文回退」的虚假安全感）。

关于任务里提到的 **`kex_complete` 半环**：全仓 `kex` / `kex_complete` / `key_exchange` 搜索，**代码文件中零命中**，唯一出现处是 `docs/feature-fill-2026-09-05.md:206,261` 这句文档描述本身。也就是说「kex_complete 无人接收」是**文档对一个不存在事件的指代**——代码里根本没有 `kex_complete` 这个 wire 事件。真正的密钥交换是 libsignal 内部的 X3DH（type-3 PreKeySignalMessage），它本身是完整的双向 ratchet 建链，不存在「半环待补」。feature-fill 的「半环」表述**不成立**，应更正为「密钥目录未挂载 + 移动端 ArrayBuffer bug 导致 X3DH 建链从未真正跑通」。这条纠正很重要，避免后续按错误前提去「补一个 kex_complete 接收端」。

---

## 1. 实际协议还原

**协议选型（设计层）**：标准 Signal X3DH + Double Ratchet，统一用 `@privacyresearch/libsignal-protocol-typescript@0.0.16`（GPL-3.0-only），DH=X25519、签名=XEd25519、消息体=AES-256-CBC + HMAC-SHA256（libsignal 自带）、KDF=HKDF-SHA256。规范见 `desktop/docs/E2E-PROTOCOL.md`。这一层选型本身是对的、且两端线格式一致（都是 libsignal 标准 PreKeySignalMessage/SignalMessage，`type:3`=建会话首条，`type:1`=常规消息）。

**密钥流（设计意图）**：

```
A 登录懒注册:  IK_A + SPK_A(=IK签名) + 100×OPK_A  ──PUT /api/e2e/register──▶  服务端(只存公钥)
                                                              ┌─────────────────────┐
A 首条消息给 B:  GET /api/e2e/bundle/B ──▶ {IK_B, SPK_B, OPK_B(取走即删)}  ─┘
   → SessionBuilder.processPreKey(bundle)
   → X3DH: DH1=EK_A·IK_B, DH2=EK_A·SPK_B, DH3=IK_A·IK_B, DH4=EK_A·OPK_B
   → HKDF 派生 ratchet key → 建 SessionRecord → 首条以 type-3 密文发出
B 收到 type-3:  用 SPK_B/OPK_B 私钥 decryptPreKeyWhisperMessage → 建反向会话 → ratchet 双向收敛
   → 每条消息 Double Ratchet 推进（消息号 + 跳号缓存）
```

**实际落地（代码层）——三层断裂**：

- 服务端 `e2e.ts` 路由逻辑本身写得完整（register/bundle「取走即删」/opks/capability，校验 isB64+isPreKeyId），但它调用的 `ctx.store.upsertE2eIdentity/getE2eBundle/addE2eOpks/countE2eOpks/hasE2eIdentity` 在 `orchestration/store.ts` 里**不存在**（全文件 51 个方法，无一含 `e2e`/`E2e`），`sqlite.ts` 里 `e2e_identities / e2e_one_time_prekeys` 两张表**不存在**。→ 路由是「悬空指针」。
- 移动端 `e2eService.ts` / `store.ts` 是完整实现了 `StorageType` 的 libsignal 适配，但 `b64ToAb`（见 TL;DR 第 2 点）在**每次读 key、每次处理对端 bundle** 时都会喂 8192 字节给 libsignal 校验 → 抛错 → 被 `encryptFor` 的 try/catch（ChatRoomPage.tsx:640）吞掉 → **静默回退明文**。
- 桌面 Web `lib/e2e.ts` 的 `b64ToBuf` 是**手动拷贝**（`new Uint8Array(bin.length)` 逐字节，e2e.ts:50-55），**没有**池别名 bug——所以桌面端密钥处理是对的；但它把私钥明文写 `localStorage`（见第 3 节 F-8）。

**结论**：设计是标准 X3DH+DR，实现里「服务端目录」和「移动端 key 处理」两处各自致命地坏掉，导致密钥流从未真正跑通过一次。移动端实际发出的永远是明文（`encryptFor` 返回 null 或抛错 → `wireContent` 保持 `text`，ChatRoomPage.tsx:639）。

---

## 2. 威胁模型矩阵

| 威胁 | 当前「宣称」防护 | 实际防护 | 差距 |
|---|---|---|---|
| 中间人（服务器/网络给假 bundle） | E2EE 应防 | **完全不防**：TOFU 首次身份无条件信任（store.ts:129、web e2e.ts:91），无安全号码/指纹比对，无身份变更告警 | 协议 §6 自认「需 v1.1 安全号码」，当前 = 0 |
| 服务器窥探明文 | E2EE 应防 | **实际未防**：服务端目录未挂载 → capability 永远 404/抛错 → 双端 `canEncryptWith`/`isPeerEnrolled` 返回 false → 全部走明文；即便挂载，移动端 ArrayBuffer bug 也回退明文 | 实际暴露面 = 100% 明文消息（+ 服务端还明文存了 `last_message`） |
| 设备丢失（手机/电脑被破） | 私钥不出设备，丢失=该设备历史不可解 | 移动端：SecureStore（Keystore/Keychain），**这部分设计是对的**；桌面 Web：私钥明文 `localStorage`，任何 XSS/共享浏览器直接全量读取身份密钥+全部会话密钥 → **全量历史+未来可解** | Web 端把 E2EE 的根信任彻底架空 |
| OPK 耗尽/被 DoS 抽干 | — | bundle「取走即删」+ 补充阈值 20；但 bundle 端点无所有权校验，任意登录用户可反复拉某人的 bundle 抽干其 OPK（可用性 DoS，非保密性） | 越权 DoS 面（见 F-5） |
| 服务端 DB 泄露 | 「服务器凭据泄露不致历史泄露」 | 服务器只存公钥（设计对），但 **Web 端私钥在客户端 localStorage**，DB 泄露本身不致命，真正致命面在端侧 | 不变量对服务端成立、对 Web 端不成立 |
| 多账号/登出后身份串用 | — | **不防**：E2E 身份是设备全局的、非账号作用域（e2eService.ts:122-126 见已有身份直接 return，永不按新账号重注册）；登出/换号不清 e2e.* 密钥 | 换号后旧身份密钥可能被注册到新 userId 下 |
| 消息被篡改/伪造（密文层） | libsignal HMAC 校验 | libsignal 自带 HMAC-SHA256 完整性，这部分**设计对**；但解密失败静默占位、无回传，篡改者无法被发送方察觉 | 完整性有、机密性实际缺失（因走明文） |

一句话量化：对外宣称「X3DH + Double Ratchet 端到端加密」，**当前实际提供 0 层端到端机密性**（全走明文回退）+ 0 层 MITM 防护 + Web 端 0 层设备丢失防护。唯一「真实存在」的密码学是 libsignal 密文层的 HMAC 完整性——但因为根本发不出密文，连这层也从未被激活。

---

## 3. 各维度发现

### 维度一：协议正确性 / 密钥交换闭环

**[P0] F-1 服务端 E2EE 密钥目录未挂载，`/api/e2e/*` 全部 404**（复核确认，行号更新）
`desktop/packages/server/src/app.ts:138-156` 的生产挂载清单无 `/api/e2e`；`e2eRouter` 仅在 `e2e.test.ts:33` `app.use("/api/e2e", e2eRouter(...))`。Git 考古：`df18651`(08-22) 曾在 app.ts:162 挂载 → `3bcbb54`(R3 插件化) 改成 `routerRegistry.register("/api/e2e", e2eRouter(ctx))` → `fc308dc`(08-27,「v0.8.1~v0.8.42」大合并) 把 app.ts 回退成**不含 routerRegistry 的旧版**，e2e 挂载连同 9 个孤儿路由一起被丢弃。失败场景：移动端/桌面端登录后懒注册 `PUT /api/e2e/register` → 404；`GET /api/e2e/capability/:peer` → 404 → 双端 `isPeerEnrolled` catch 返回 false（e2eService.ts:111-114）→ **永久明文**。修复方向（接口级）：把 `e2eRouter`/`pairsRouter` 等 9 个孤儿路由重新挂回（走 `RouterRegistry` 或直挂），并先修 F-2 的 store/表缺失，否则挂载即 500。

**[P0] F-2 `Store` 缺 5 个 e2e 方法 + `sqlite.ts` 缺 2 张 e2e 表**（复核确认）
`orchestration/store.ts` 全文件无 `upsertE2eIdentity/getE2eBundle/addE2eOpks/countE2eOpks/hasE2eIdentity`；`db/sqlite.ts` 无 `e2e_identities / e2e_one_time_prekeys`（`git show 3bcbb54:...sqlite.ts` 有 `e2e_identities`，HEAD 已无——同样被 `fc308dc` 回退）。失败场景：即便修 F-1 挂载，`/register` 调 `ctx.store.upsertE2eIdentity` → `TypeError: ... is not a function`（TS 侧 TS2339，运行时 undefined 调用）；`/bundle` 查 `e2e_identities` → SQLite `no such table`。修复方向：按 `E2E-PROTOCOL.md` §3 补建两表 + 实现五方法（OPK 取走即删用 `DELETE` 返回被删行），纳入迁移台账（`sqlite.ts:190+` 的 ALTER 模式）。

**[P0] F-3 移动端 `b64ToAb` 返回 8KB 内存池，摧毁所有 key 读取与 bundle 处理**（NEW，实证）
`mobile/src/services/e2e/e2eService.ts:69-71` 与 `store.ts:23-25`：`return Buffer.from(b64, "base64").buffer as ArrayBuffer;`。用 `buffer` 包实测：32 字节密钥的 `b64ToAb` 结果 `byteLength=8192, byteOffset=128`。libsignal `internal/curve.js` 的 `validatePrivKey`（`privKey.byteLength != 32` → throw）与 `validatePubKeyFormat`（`byteLength != 33 && != 32` → throw）都会在 `createKeyPair`/`ECDHE` 入口抛错。失败路径：
- 首发：`encryptFor` → 无会话 → `builder.processPreKey(bundleToDevice(bundle))`（e2eService.ts:185-190）→ `bundleToDevice` 用 `b64ToAb(identityKey/signedPreKey)`（:89-98）得 8192 字节 → `startSessionAsInitiator` → `ECDHE` → `validatePubKeyFormat` 抛 `Invalid public key` → `encryptFor` 无 try 包裹此段会向上抛 → ChatRoomPage.tsx:640 catch → **回退明文**。
- 重启后：`store.ensureLoaded` → `kpFromStore` → `b64ToAb(privKey)`（store.ts:45）→ 8192 字节 → 任何 decrypt 触发 `createKeyPair` → 抛 `Invalid private key` → decryptFrom catch（:227）→ 返回占位符。
对照铁证：同文件 `utf8ToAb`（e2eService.ts:39-42）专门 `.slice(byteOffset, ...)` 修「明文」池问题并注明「实测导致密文膨胀 400 倍且对端无法解密」，却漏了 `b64ToAb`。修复方向：`b64ToAb` 改成 `const b = Buffer.from(b64,'base64'); return b.buffer.slice(b.byteOffset, b.byteOffset+b.byteLength);`（与 `utf8ToAb` 对齐）；`store.ts` 同修。加单测断言 `b64ToAb(b64ToAb往返).byteLength === 原始长度`。

**[P1] F-4 桌面 Web 无此 bug，但依赖「服务端目录已挂载」——与移动端共用同一条已断链**（NEW，澄清）
`desktop/packages/web/src/lib/e2e.ts:50-55` 的 `b64ToBuf` 手动逐字节拷贝，无池别名问题；`decryptMessage` 传 `"binary"` 编码、`encryptMessage` 用 `TextEncoder`，线格式正确。但它的 `ensureEnrolled/peerEnrolled/buildSessionAsInitiator` 同样打 `/api/e2e/*`（e2e.ts:176,197,294），命中 F-1 的 404。→ 桌面端 E2EE 也从未真正跑通（被 F-1 一票否决），只是它自身代码是干净的。

**[P2] F-5 「kex_complete 半环」是文档幻觉，代码无此事件**（NEW，纠正）
全仓 `kex/kex_complete/key_exchange` 代码零命中，唯一出处 `docs/feature-fill-2026-09-05.md:206,261`。真实密钥交换 = libsignal X3DH（type-3），是完整双向 ratchet，无「半环」。**建议**：feature-fill 该条更正为「E2EE 密钥目录未挂载 + 移动端 ArrayBuffer bug，X3DH 建链从未跑通」，避免后续按错误前提去实现一个不存在的 `kex_complete` 接收端。

### 维度二：密钥管理

**[P1] F-6 桌面 Web 私钥明文存 localStorage**（NEW）
`desktop/packages/web/src/lib/e2e.ts:36`（`jsonSet`→`localStorage.setItem`）、`:184-186`（`identity-key-pair`/`registration-id`/`spk-id`）、`:131-132`（`storeSession` 全量会话密钥）。私钥（身份密钥 + 每个对端的 ratchet 会话密钥）全部明文落 `ensemble.e2e.*`。攻击场景：任一 XSS（合鸣 Web 侧攻击面不小：插件/卡片/富文本）或共享机器浏览器 profile → 读 `localStorage` → 拿到身份私钥 + 全部历史会话密钥 → **解密该账号全部 E2EE 历史与未来消息**。协议 §6 把「设备丢失=该设备不可解」当特性，但对 Web 端这个特性不成立。移动端用 SecureStore（store.ts 注释：Keystore/Keychain）是对的，Web 端是整套 E2EE 的根信任薄弱点。修复方向：Web 端私钥下沉 Electron `safeStorage`（DPAPI/Keychain），经 IPC 存取，`localStorage` 只放非敏感元数据（协议 §2 已列此路线，未落地）。

**[P0] F-7 登出/换账号不清理 E2E 密钥 + 身份是设备全局而非账号作用域**（NEW）
- 清理缺失：`mobile/src/pages/SettingsPage.tsx:50-55` 的 `handleLogout` 只 `api.logout()` + 清 `me`，**不碰** `e2e.*` SecureStore 条目（`E2EStore` 根本没有 `clearAll/destroy` 方法，store.ts 只有 `del` 私有、未导出批量清理）。Web 端 `localStorage ensemble.e2e.*` 也永不清理。→ 登出后换账号/换人用同机，旧账号的身份密钥+会话密钥仍在。
- 作用域错误：`e2eService.ts:122-126` `ensureEnrolled` 见 `store.getIdentityKeyPair()` 已有身份就 `enrolled=true; return`，**永不按当前登录账号重注册**。后果：用户 A 登出、用户 B 登入同一台设备 → B 的「已注册」判定直接复用 A 生成的身份密钥包，并把 A 的公钥注册到 B 的 userId 下（若触发注册）；或 B 直接继承 A 的对端会话密钥 → **跨账号身份/会话串用**。
修复方向（接口级）：把 E2E 身份按 `userId` 命名空间化（SecureStore key 前缀加 userId，如 `e2e.<userId>.identity`）；`ensureEnrolled(userId)` 以账号为键；登出/注销时按 userId 批量 `SecureStore.deleteItemAsync` 前缀 + 清对应 server 端 identity（需新增 `DELETE /api/e2e/identity` 或复用 register 覆盖）。

**[P1] F-8 移动端身份密钥生成后 `registrationId` 不一致 + 服务端不存 regId**（NEW，中低）
`e2eService.ts:128` 本地 `generateRegistrationId()` 存了，但 `bundleToDevice` 给对端时硬编码 `registrationId: 0`（:90），服务端 `e2e.ts` 也不存/不传 regId（`register` 收的 body 无 regId 字段）。X3DH 里 regId 用于「对端是否支持预密钥」的握手标志，置 0 属可接受降级但两端不一致（本地真值、线上假值），属实现漂移。修复方向：统一——要么服务端存并下发 regId，要么两端都固定用同一常量并注释说明。

**[P2] F-9 SecureStore 写是 fire-and-forget，无 await/重试**（NEW，低）
`store.ts` 全部 `void set(...)`/`void this.saveKeyList(...)`（:138,151,153,161,174,182,198,208,209）。内存缓存先更新、落盘异步不等待。风险：进程在「内存已更新、SecureStore 未落盘」窗口被杀 → 持久化与内存不一致 → 重启后 key 丢失 → 解密失败占位。属可用 SecureStore 的合理取舍，但身份密钥（:208）建议至少 `await`。

### 维度三：信任与所有权

**[P1] F-10 `/api/e2e/bundle/:userId` 无所有权/关系校验，任意登录用户可拉任意用户 bundle**（NEW，扩展已知「ownership 缺失」）
`e2e.ts:49-53`：`getE2eBundle(String(req.params.userId))` 直接用路径参数，无「调用者是否有权向该 userId 发起会话」的校验。攻击场景：任意持有效 session token 的用户，遍历 userId（`user_<16hex>` 可枚举，见 cross-cutting 审计 ntfy 条目）→ 拉取他人 identityKey + SPK + **消耗其一次性 OPK**（bundle「取走即删」，e2e.ts:48 注释）→ (a) 窥探他人是否启用 E2EE、身份公钥（公开材料，低敏）；(b) **OPK 抽干 DoS**：反复拉 bundle 耗尽对方 100 个 OPK，使对方被动降级到「无 DH4 的 X3DH」或直接无法被新会话触达。`/api/e2e/capability/:userId`（:73-75）同理，泄露任意用户 enrollment 状态（枚举面）。修复方向：bundle 端点加「调用者与目标 userId 存在 direct 会话（`conversations.participant_ids` 双向，见 MEMORY 数据模型易错点）」或至少「好友关系」校验；OPK 取走加每调用者速率限制。

**[P1] F-11 `/api/e2e/register` 不校验 SPK 是否真由声称的 identityKey 签名**（NEW，中）
`e2e.ts:23-46`：`isB64` 只查 base64 格式与长度，`isPreKeyId` 只查整数范围，**不**验证 `signedPreKeySignature` 确实是 `signedPreKey` 被 `identityKey` 用 XEd25519 签的，也**不**验证 identityKey 是合法 Curve25519 点。攻击场景：用户注册一个「identityKey 与 SPK 签名不匹配」的 bundle → 对端 `processPreKey` 在本地验签失败（libsignal 会验 SPK 签名）→ 对端永远无法与此人建会话（可用性），或更微妙地，若签名校验被某端弱化则构成身份伪造载体。因是「自报身份」，直接危害有限（对方本地 libsignal 会兜底验签），但服务端作为「密钥目录」应承担一次签名/点校验，把非法 bundle 挡在入库前。修复方向：服务端用 `@noble/curves` 的 `ed25519.verify(spkPub, sig, ikPub)` 校验 SPK 签名 + `curve25519` 点校验，失败 400。

**[P2] F-12 OPK id 无唯一性/碰撞处理**（NEW，低）
`e2e.ts:56-70` `addE2eOpks` 追加时不查 id 是否已存在；移动端补充用 `Date.now() % 1_000_000 + i`（e2eService.ts:157）、Web 用 `100000 + Math.random()*9e8 + i`（web e2e.ts:327）。两端 id 生成策略不同、都可能与服务端已有 id 撞。若 `e2e_one_time_prekeys` 的 `prekey_id` 无唯一约束（当前表都缺失，补建时需设计），撞 id 会让「取走即删」删错行。修复方向：补表时 `e2e_one_time_prekeys(user_id, prekey_id)` 联合唯一 + `ON CONFLICT`；或 id 改用服务端单调自增。

**[P1] F-13 设备配对 `/api/pairs` 未挂载 + 三张表缺失 + `ctx.deviceLinkLog` 不存在**（复核确认 + 扩展）
`pairs.ts` 仅在 `pairs.test.ts:35` 挂载；`app.ts` 无 `/api/pairs`；`sqlite.ts` 无 `pair_codes / device_pairs / device_link_events`；`context.ts` 无 `deviceLinkLog`（pairs.ts:107 `ctx.deviceLinkLog.replay` 会崩）。移动端 `DeviceLinkPage.tsx:60,86,111` 调 `getPairs/confirmPair/removePair` → 全 404。配对流程（6 位码 + 一次性公钥指纹，pairs.ts:20-48）设计本身合理（码 5 分钟有效、confirm 校验 `row.user_id === userId` 防跨账号，:65），但整条链路在生产不可达。修复方向：挂 `pairsRouter` + 补三表（`pair_codes` 唯一 `code`、`device_pairs` 主键 `id`、`device_link_events` 供 replay）+ 在 `createAppContext` 实例化 `deviceLinkLog`。

**[P2] F-14 设备配对挑战在 relay 侧、但 relay 无设备级 token 绑定用户**（NEW，中）
`pairs.ts` 注释说「手机端输/扫码后经 relay 完成挑战应答」，但 `relay-server/src/index.ts` 的设备注册（:226-256 `device:register`）只收 `deviceId/deviceName/deviceType`，**不校验该 deviceId 归属哪个登录用户**——只要握手的 `RELAY_AUTH_KEY`（一个**全局**共享密钥，:167,215）对了，任何客户端都能用任意 `deviceId` 注册进 `connectedDevices` 内存 Map。`/devices` 端点（:188-196）同样只认全局 key、暴露**全部**在线设备（跨用户）。→ relay 侧设备身份与用户身份完全脱钩，「设备配对」在 relay 层没有真正的 per-user 归属。另 `connectedDevices/offlineMessages` 纯内存 Map（:149-152），**relay 重启即丢**（离线队列清空、配对在线态全失，不落盘）。修复方向：relay 设备注册要求携带可验证的用户凭证（用户 session token 派生的设备 token），`/devices` 只返回请求者自己的设备；关键状态（配对/离线队列）落盘。

### 维度四：实现健壮性

**[P2] F-15 curve 库选型：emscripten C 编译 + GPL-3.0 许可证**（NEW）
移动端 curve 走 `@privacyresearch/curve25519-typescript@0.0.12`（emscripten 把 libsignal 的 C 版 curve 编译成 JS，`lib/internal/curve.js:13` require 它），而 `libsignal-protocol-typescript` 本身 **GPL-3.0-only**。这是「私有 App 链接 GPL 协议库」的合规风险点（分发需评估 GPL 传染；自用/自部署通常可接受，商用闭源分发需法务评估）。功能上无已知漏洞（是 libsignal 官方 C 实现的忠实移植）。移动端 `MinimalCrypto`（minimalCrypto.ts）只替换了 libsignal 用到的 4 个 WebCrypto 原语（getRandomValues→expo-crypto、AES-CBC→@noble/ciphers、HMAC/HKDF→@noble/hashes），**没有**自实现任何 DH/签名曲线——这点是对的（curve 仍走 libsignal/curve25519，未自造）。

**[P2] F-16 Hermes `TextDecoder('utf-16le')` patch 是必要的，但属「治标」**（NEW，评估）
`mobile/patches/@privacyresearch+curve25519-typescript+0.0.12.patch` 把 curveasm.js 里 `new TextDecoder('utf-16le')` 包进 try/catch，失败时回退手写 LE 解码器。原因（patch 注释 + MEMORY）：Hermes/Expo 的 TextDecoder 构造 'utf-16le' 会抛 RangeError → 模块加载即崩 → 聊天白屏（v0.9.7/0.9.8 白屏根因之一）。评估：这是**必要的运行时兜底**（不改则白屏），但 patch 的是 emscripten 生成的 12k 行 JS，脆且随依赖升级失效（postinstall `patch-package` 每次重装重打）。长期应评估：能否让 curve25519 在 RN 走纯 JS fallback 而非 emscripten 路径，或换纯 TS 实现，从根上摆脱对 emscripten HEAP/TextDecoder 的依赖。当前可接受，但需进「依赖升级即验证 patch 仍命中」的清单。

**[P2] F-17 解密失败静默占位、无重试、无回传**（NEW，低中）
`decryptFrom` catch 一律返回占位符（e2eService.ts:227-229）、`encryptFor` 失败返回 null 走明文（:179,187）。用户感知：发了「看似加密」的消息，对端因 key 轮换/重装显示「🔒 无法解密」，**发送方无任何反馈**，也**没有**「对端未注册/降级明文」的状态提示。体验与安全告知都不到位。修复方向：解密失败时上抛一个可展示的原因码（key 丢失 vs 版本不匹配），UI 区分「历史不可解（FS 预期）」与「应可解但失败（bug/降级）」；发送方在「对端未注册而走了明文」时给一次性提示。

**[P2] F-18 网络抖动触发静默明文降级**（NEW，低）
`isPeerEnrolled` catch 返回 false（e2eService.ts:111-114）、capability 缓存 5 分钟（:56）。失败场景：双端都注册了，但对端 capability 请求因瞬时网络失败 → 判定「未注册」→ 本条走明文。属灰度共存的合理取舍，但意味着「E2EE 是否生效」依赖网络稳定性，且降级无任何日志/埋点，安全事件难以追溯。修复方向：至少对「capability 查询失败导致明文」加一条 warn 日志 + 埋点。

**[P3] F-19 e2e 自检脚本是进程内 mock，不覆盖真实服务端链路**（NEW，低）
`desktop/scripts/e2e-selftest.mjs` 用 `globalThis.fetch` shim + `localStorage` shim 在**进程内**模拟 alice/bob 双端跑 libsignal（不连真服务器），`e2e-live-test.mjs`/`e2e-prod-verify.mjs` 才打真链路。`df18651` 提交信息「152 测试全过」是对**当时挂载着**的 router 测的；router 被回退后（F-1），这组测试与生产脱钩。修复方向：加一条「打真实 `/api/e2e/*`、断言非 404 + 完整 register→bundle→双向解密」的集成测试进 CI，防止「路由又悄悄被合并弄丢」再发生（这正是本域 F-1/F-2/F-13 的共同根因——无集成测试看护）。

### 维度五（存储层，归并到维度二）
预密钥/会话密钥的存储位置小结：**移动端** = `expo-secure-store`（SecureStore，Keystore/Keychain，设计对，但写是 fire-and-forget 见 F-9、清理缺失见 F-7）；**桌面 Web** = `localStorage` 明文（F-6，根信任薄弱点）；**服务端** = 设计上只存公钥（正确），但因 F-2 表缺失当前**什么都没存**（也意味着没有任何服务端 E2EE 状态，与「未挂载」一致）。群聊/附件明文（协议 §0 明示，非缺陷是范围）。

---

## 4. 修复路径

### 短期加固（约 2–4 天，让 E2EE 真正跑通、堵住最低垂的果）

1. **修 F-3（移动端 ArrayBuffer 池 bug）**——一行级改动 + 单测，是「移动端 E2EE 从 0 到能用」的关键开关。`b64ToAb` 对齐 `utf8ToAb` 的 slice 逻辑（e2eService.ts:69、store.ts:23）。
2. **补 F-2（store 五方法 + 两表）**——按 `E2E-PROTOCOL.md` §3 建 `e2e_identities / e2e_one_time_prekeys`（OPK 取走即删）+ 实现 `Store` 五方法，纳入 `sqlite.ts` 迁移。
3. **修 F-1 / F-13（挂回 e2eRouter + pairsRouter）**——把两个孤儿路由挂回 app.ts（走 RouterRegistry），补 `pair_codes/device_pairs/device_link_events` 三表 + 实例化 `deviceLinkLog`。这是与后端审计「9 孤儿路由」同一批，应一起收口。
4. **加集成测试（F-19）**——CI 里加「打真实 `/api/e2e/*` + `/api/pairs/*` 非 404 + 完整 X3DH 双向解密」用例，防止再被合并弄丢。
5. **修 F-10（bundle 越权 DoS）**——bundle 端点加会话/好友关系校验 + OPK 取走限速。低成本、堵掉可枚举 DoS。
6. **修 F-7（登出清理 + 账号作用域）**——E2E 身份按 userId 命名空间 + 登出批量清理 + 新增服务端 identity 覆盖/删除端点。

### 中期（约 1–2 周，补威胁模型的真实缺口）

7. **F-6（Web 私钥下沉 DPAPI/Keychain）**——E2EE 根信任的实质加固，否则 Web 端「端到端」名不副实。
8. **F-11（服务端 SPK 签名/点校验）**——把非法 bundle 挡在入库前。
9. **F-14（relay 设备级用户绑定 + 状态落盘）**——让「设备配对」在 relay 层有真实 per-user 归属、重启不丢。
10. **安全号码/指纹比对（协议 §6 的 v1.1）**——补上 MITM 防护这最后一环，否则「E2EE」永远只有机密性（且当前连机密性都没落地）、无认证性。这是把「防服务器窥探」升级为「防中间人」的必要步骤。

### 迁移 libsignal/MLS 的决策建议

- **客户端侧：保留 `@privacyresearch/libsignal-protocol-typescript`，不要自研、不要切 MLS。** 理由：(a) 它就是标准 X3DH+DR，设计正确，问题全在**外围**（挂载/表/ArrayBuffer/存储），不在协议库本身；(b) MLS 解决的是**群聊**前向保密，而合鸣群聊 v1 明确明文（协议 §0），当前没有群聊 E2EE 需求，上 MLS 是过度工程；(c) GPL-3.0 风险（F-15）在自部署/自用场景可接受，商用闭源分发前再评估，不必因此换库。
- **服务端侧：密钥目录保持「只存公钥」的无状态设计是对的**，不要往服务端引任何私钥或 ratchet 状态。修复聚焦于「把目录真正提供出去 + 越权校验」，而非改架构。
- **真正值得「换/补」的是两块**：(1) 桌面 Web 的密钥存储从 localStorage 换 DPAPI（不是换协议，是换存储后端）；(2) 待做群聊 E2EE 时再引入 Sender Keys（Signal 群方案）而非直接 MLS——Sender Keys 与现有 libsignal 客户端栈兼容性更好、迁移成本更低。

一句话：**当前不缺「更好的协议」，缺的是「把已选对的标准协议真正跑通 + 补齐存储/鉴权/认证三块外围」**。优先级是 F-3 → F-2 → F-1 → 集成测试（先止血让 E2EE 生效），再 F-10/F-7（堵越权与串号），再 F-6/F-11/F-14（补实质安全），最后安全号码（补认证性）。

---

## 5. 统计

| 严重度 | 数量 | 条目 |
|---|---|---|
| P0 | 4 | F-1（e2e 路由未挂载）、F-2（store 方法+表缺失）、F-3（移动端 ArrayBuffer 池 bug）、F-7（登出不清+身份非账号作用域） |
| P1 | 5 | F-4（Web 共用断链，澄清）、F-6（Web 私钥明文 localStorage）、F-10（bundle 越权 DoS）、F-11（SPK 签名不校验）、F-13（pairs 未挂载+表+deviceLinkLog 缺失） |
| P2 | 9 | F-5（kex_complete 幻觉，纠正）、F-8（regId 不一致）、F-9（SecureStore 写不等待）、F-12（OPK id 碰撞）、F-14（relay 设备无用户绑定+不落盘）、F-15（emscripten+GPL）、F-16（Hermes patch 治标）、F-17（解密失败静默）、F-18（网络抖动静默明文） |
| P3 | 1 | F-19（自检脚本进程内 mock，不护生产链路） |
| **合计** | **18** | |

> 注：F-4、F-5 偏「澄清/纠正」性质（F-4 确认桌面端代码干净但被 F-1 否决；F-5 纠正 feature-fill 的「半环」前提），按其在威胁模型中的影响定级，非独立新漏洞。

**已知条目复核结果**（对前置审计）：
- 后端审计「e2eRouter 未挂载（test-only）」→ **确认**，并补上 git 根因（`fc308dc` 大合并回退）+ 行号（app.ts:138-156 清单无 /api/e2e）。
- 后端审计「store 方法/表缺失 → 自身测试失败」→ **确认**，行号定位到 `orchestration/store.ts`（0 个 e2e 方法）与 `db/sqlite.ts`（无 e2e 表）。
- 后端审计「pairsRouter test-only + device_link_events 表缺失」→ **确认并扩展**：`device_pairs/pair_codes` 也缺失，`ctx.deviceLinkLog` 也不存在（比「缺一张表」更严重）。
- 任务提及的「e2e.ts:49/73」→ **确认**：`:49-53` 是 bundle 端点（无所有权校验，升级为 F-10 越权 DoS）；`:73-75` 是 capability 端点（枚举面，并入 F-10）。
- feature-fill「kex_complete 半环无人接收」→ **证伪其前提**：代码无 `kex_complete` 事件，系文档对一个不存在事件的指代（F-5）。
- 新发现（NEW）：**F-3（移动端 ArrayBuffer 池 bug，最关键，此前所有审计均未发现）、F-6（Web 私钥明文 localStorage）、F-7（登出不清+账号作用域）、F-10、F-11、F-12、F-14、F-15、F-16、F-17、F-18、F-19**。

隐私合规：本报告未抄录任何真实 IP / 凭据；外部主机统一 `<SERVER_IP>`、密钥 `<SECRET>`。实测复现（F-3）仅在本地 `node_modules/buffer` 上做内存运算，未触网、未落盘敏感数据。
