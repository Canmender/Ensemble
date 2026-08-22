# 合鸣 E2E 端到端加密协议规范（v1）

> 状态：**v1 定稿**（2026-08-22，桌面端会话起草）——桌面端与移动端共同实现依据。
> 理论基础见 `docs/技术调研/IM端到端加密协议调研.md`（X3DH + Double Ratchet 选型论证）。

## 0. 目标与范围

| 项 | v1（本规范） | 后续版本 |
|----|--------------|----------|
| 1:1 用户私聊 | ✅ 全文加密（X3DH + Double Ratchet） | — |
| 群聊 | ❌ 不加密（明文，与现状一致） | Sender Keys → MLS |
| Agent 会话 | ❌ 明文（Agent 侧需服务端明文） | 不在计划内 |
| 附件 | ❌ 随消息明文传输 | v1.1（内容加密后上传） |
| 安全号码/指纹校验 | ❌ | v1.1 |
| 多设备身份密钥同步 | ❌（每设备独立身份） | v2 |

**核心不变量**：服务器只见公钥与密文；私钥永不离开设备；服务器凭据泄露不导致历史消息泄露。

## 1. 密码学套件

| 用途 | 算法 |
|------|------|
| DH / 密钥协商 | X25519（Curve25519） |
| 签名（SPK） | XEd25519（libsignal 约定） |
| 消息加密 | AES-256-CBC + HMAC-SHA256（libsignal 默认） |
| KDF | HKDF-SHA256 |

**实现库（两端统一，保证线格式兼容）**：[`@privacyresearch/libsignal-protocol-typescript`](https://github.com/PrivacyResearchGroup/libsignal-protocol-typescript)（桌面 web 与 React Native 均可运行）。禁止自行实现密码学原语。

线格式即 libsignal 标准格式：PreKeySignalMessage / SignalMessage，`type: 3` 为 PreKey（会话建立首条）、`type: 1` 为常规消息。

## 2. 身份与注册

- 每台设备（用户 × 端）生成独立身份：IdentityKeyPair（IK）+ SignedPreKeyPair（SPK，IK 签名）+ 100 个 OneTimePreKeyPair（OPK）。
- **注册时机**：登录成功后首次进入聊天前（桌面端在 ChatPage 初始化时懒注册；移动端同）。重复注册 = 轮换身份（旧会话失效，需重建）。
- **私钥存储**：
  - 桌面 v1：`localStorage`（key 前缀 `ensemble.e2e.`；云端版/本地版工作区已分区隔离）。加固路线：经 IPC 存入 Electron safeStorage（DPAPI）。
  - 移动端：Android Keystore（生成/存储 IK 私钥），libsignal store 层对接。

## 3. 服务端 API（密钥目录，服务器只见公钥）

挂载于 `/api/e2e/*`，全部要求 Bearer 认证（同现有 apiAuth）。服务端表：

```
e2e_identities(user_id TEXT PK, identity_key TEXT, spk_id INTEGER, spk_public TEXT,
               spk_signature TEXT, updated_at TEXT)
e2e_one_time_prekeys(id INTEGER PK AUTOINCREMENT, user_id TEXT, prekey_id INTEGER,
                     public_key TEXT)
```

| 端点 | 方法 | 请求 | 响应/语义 |
|------|------|------|-----------|
| `/api/e2e/register` | PUT | `{ identityKey: base64, signedPreKeyId: number, signedPreKey: base64, signedPreKeySignature: base64, oneTimePreKeys: [{ id, key }] }` | 覆盖式注册/轮换；返回 `{ registered: true }` |
| `/api/e2e/bundle/:userId` | GET | — | `{ identityKey, signedPreKeyId, signedPreKey, signedPreKeySignature, oneTimePreKey?: { id, key } }`；**取走即删**该 OPK；OPK 耗尽时 `oneTimePreKey` 缺省（仍可 X3DH，少 DH4） |
| `/api/e2e/opks` | POST | `{ oneTimePreKeys: [{ id, key }] }` | 追加补充 OPK（建议余量 < 20 时补 100） |
| `/api/e2e/capability/:userId` | GET | — | `{ enrolled: boolean }`（是否已注册密钥） |

base64 均为标准编码。所有 key 字段是**公钥**；私钥任何情况下不上传。

## 4. 会话建立与消息收发

### 发起方（A → B，B 未有会话）
1. `GET /api/e2e/bundle/B` 取 B 的密钥包。
2. libsignal `buildSession`（X3DH：DH1..DH4，含 OPK 时四条 DH）。
3. 首条消息以 PreKeySignalMessage（type 3）发送。

### 接收方（B）
1. 收到 type 3 消息 → 用自己的 SPK/对应 OPK 私钥处理 → 会话建立 → 立即回一条任意消息完成双向确认。
2. 用过的 OPK 私钥删除；检测 OPK 余量，低于 20 时 `POST /api/e2e/opks` 补充。

### 消息信封（复用现有 chat 通道，服务器无感）

明文消息 `content` 为任意文本。E2EE 消息的 `content` 固定为 JSON 字符串：

```json
{"e2e":1,"v":1,"ct":{"type":3,"body":"<base64 libsignal 密文>"}}
```

- 接收方按 `content` 首字节 `{` 且含 `"e2e":1` 判定为加密信封，解密后渲染明文。
- 解密失败（如密钥轮换/设备丢失）：显示占位「🔒 无法解密的消息（对方可能重新安装了应用）」，**不报错不崩溃**。
- 判定是否加密：发送前 `GET /api/e2e/capability/:peer`，**双方都已注册才加密**；否则明文（灰度共存，不强求全员升级）。
- capability 结果客户端缓存 ≤ 5 分钟。

### 乱序与重放
Double Ratchet 自带乱序容忍（消息号 + 跳过密钥缓存）。服务端 seq 字段（v0.8.3 已上线）用于投递排序，不参与密码学。

## 5. 客户端职责清单

| 职责 | 桌面端 | 移动端 |
|------|--------|--------|
| libsignal 集成 + 注册 | ✅ 本轮 | 待本规范入库后 |
| 私钥存储 | localStorage（v1）→ DPAPI | Android Keystore |
| 发送链路加密（1:1 用户会话） | ✅ 本轮 | 待实现 |
| 接收链路解密 + 失败占位 | ✅ 本轮 | 待实现 |
| OPK 补充 | ✅ 本轮 | 待实现 |
| 群聊/附件 | 明文（同现状） | 明文（同现状） |

## 6. 明确不做 / 已知限制

- 不做服务器中转加密消息的离线队列加密（服务器只见密文，暂存即密文，天然安全）。
- 不做前向保密群聊（v1 群聊明文——群聊加密是 v2 Sender Keys / MLS 课题）。
- 不防「服务器给假 bundle」的中间人（需 v1.1 安全号码比对）；威胁模型内先接受：服务器由用户自部署。
- 设备丢失 = 该设备历史会话不可解密（FS 特性，非缺陷）。
