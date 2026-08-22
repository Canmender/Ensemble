# IM 端到端加密协议调研

> 调研日期：2026-08-22 | 主题：加密安全
> 关联项目现状：合鸣为云架构 IM（服务器 + relay 全程可见明文）；待办中有三类凭据轮换（见 [[privacy-protection-convention]]、[[session-2026-08-22]]）
> 方法：检索 Signal 官方规范、IETF RFC 9420 及 2024–2025 密码学分析文献

## 结论速览

1. **1v1 加密的标准答案仍是 Signal 协议**（X3DH 握手 + Double Ratchet 持续加密），提供前向保密（FS）、攻陷后恢复（PCS）、可否认性三重保证。
2. **群聊加密的规模答案是 MLS**（RFC 9420，TreeKEM 树结构）：成员变更成本从 O(N) 降到 O(log N)，PCS 是协议结构性产物而非"等下一个人发言"。
3. 对合鸣：先做 1v1 E2EE，群聊按规模选 sender-keys 过渡或 MLS；服务器职责退化为"盲投递+密钥目录"，与现有云架构完全兼容。

## 一、Signal 协议双件套

### X3DH（Extended Triple Diffie-Hellman）——会话建立

每个用户在服务器预注册三类公钥：

- **身份密钥 IK**（长期）：身份锚点
- **已签名预密钥 SPK**（定期轮换）：由 IK 签名
- **一次性预密钥 OPK**（用完即弃，可选但推荐）

发起方 Alice 计算 DH 链：

```
DH1 = DH(IK_A, SPK_B)   ┐
DH2 = DH(EK_A, IK_B)    ├─ 相互认证（用到双方身份密钥）
DH3 = DH(EK_A, SPK_B)   ┘
DH4 = DH(EK_A, OPK_B)   ← 可选，一次性预密钥增强前向保密

SK = KDF(DH1 || DH2 || DH3 || [DH4])
```

Bob 用同样四步算出相同 SK 后**立即删除所有 DH 输出和已用的 OPK**——这就是初始前向保密的来源。EK 是 Alice 的临时密钥，用完即弃。

### Double Ratchet——持续消息加密

两层棘轮叠加：

- **对称密钥棘轮**：根链 → 发送链/接收链，每条消息派生唯一消息密钥，用完即删。当前链钥匙泄露也解不开历史消息（FS）。
- **DH 棘轮（乒乓）**：消息头携带发送方当前棘轮公钥；对方收到新公钥就生成新 DH 对刷新根链。即使攻击者短暂攻陷一方，一旦双方恢复正常通信，新鲜 DH 熵把攻击者重新关在门外——**PCS（break-in recovery）**。
- **乱序容忍**：消息头带消息号 N 和上一链长度 PN，接收方缓存被跳过的消息密钥等待迟到消息。

| 安全性质 | 由谁提供 |
|---|---|
| 前向保密 FS | 临时密钥 + 每消息密钥删除 |
| 攻陷后恢复 PCS | DH 棘轮再换钥 |
| 相互认证 | DH1/DH2 使用身份密钥 |
| 可否认性 | 基于 DH 的密钥协商（无签名绑定内容） |

## 二、群聊问题与 MLS（RFC 9420）

### Signal 方案的群聊短板

Signal 本体没有群协议，应用层做法是 N 条 pairwise Double Ratchet 会话 + Sender Key 广播：

- 每次成员变更需要 N 次加密（100 人群 = 100 次加密；5000 人群 = 5000 次）；
- Sender Key 链的 PCS 依赖"下一个发信人拉入新 DH 熵"——若没人发言，攻击者拿到当前 sender key 可以**无限期被动窃听直到链被重置**；
- 成员变更后的恢复成本随群规模平方增长。

### MLS / TreeKEM 的解法

MLS 把整个群做成**单个密码学对象（ratchet tree）**：

- 每个成员是树的一个叶子，节点持有密钥对；更新时只需提交**自己叶子到根的一条路径**——5000 人群约 13 个密文，20 万人群约 18 个节点更新，成本 O(log N)；
- 每次 Commit 都产出全新根密钥并销毁旧的，**PCS 不依赖谁先发言，是协议结构的必然产物**；
- RFC 9420 明确目标：2 人到数千人群的异步密钥建立，同时具备 FS 与 PCS。

### 2025 年形式化分析的警示

IACR ePrint 2025/554 用对称签密形式化分析了 MLS、Session、Signal、Matrix 四家的群聊构造：

- MLS 和 Session 存在内部人员 replay/reorder 攻击面；
- Signal 群聊存在外部伪造攻击面；
- 各构造在识别出的攻击之外均形式化安全——即"已知且可控"，选型时要知道这些残余风险。

## 三、选型对比

| 维度 | Signal (pairwise + sender keys) | MLS (TreeKEM) |
|---|---|---|
| 适用规模 | 1v1 至小群 | 2 人至数千人 |
| 成员变更成本 | O(N) | O(log N) |
| PCS 保证 | 依赖后续发言触发 | 结构性保证 |
| 生态成熟度 | libsignal 极成熟，WhatsApp/Signal 亿级验证 | OpenMLS 等实现，XMPP/Matrix 在接入 |
| 工程复杂度 | 低（现成库） | 中（需实现 Delivery Service 语义） |
| 形式化分析 | 最充分 | 充分（含 2025 新发现） |

## 四、对合鸣的建议路线

1. **第一步（1v1 E2EE）**：采用 X3DH + Double Ratchet。优先评估 libsignal 绑定；若嫌跨语言绑定重，可评估 TypeScript 实现库但必须过代码审计。预密钥目录放服务器（服务器只见公钥），与现有云端架构零冲突。
2. **第二步（群聊）**：小群先用 sender-keys 过渡（每消息 O(1) 开销，接受其 PCS 弱点并配合定期强制轮换）；群规模上到数百人或对 PCS 有硬要求时迁移 MLS。
3. **服务器角色转变**：E2EE 上线后服务器从"可信内容载体"降级为"盲投递管道 + 公钥目录"。这正好呼应凭据轮换待办——即使服务器凭据泄露，历史消息也不泄。
4. **配套机制**：安全号码/指纹校验（防中间人）、多设备身份密钥同步策略、密钥更换时的用户提示 UI，需在协议落地前排期。
5. **私钥本地存储已有现成落点**（2026-08-22 代码核实）：桌面端已实现基于 Electron `safeStorage`（Windows DPAPI）的 KeyStore（`ensemble-cloud/packages/desktop/src/main/keychain.ts`，实现 `@ensemble/server` 的 `KeyStore` 接口）。身份密钥/预密钥私钥可直接存入该层；移动端需对应实现（Android Keystore）。注意 safeStorage 在 Linux 下依赖 gnome-keyring/kwallet，跨平台部署时要处理降级路径。

## 参考来源

- [X3DH Specification — Signal](https://signal.org/docs/specifications/x3dh/)
- [Double Ratchet Specification — Signal](https://signal.org/docs/specifications/doubleratchet/)
- [RFC 9420: The Messaging Layer Security (MLS) Protocol](https://www.ietf.org/rfc/rfc9420)
- [Signal Protocol vs MLS — Umbrella X](https://umbrellax.io/blog/signal-protocol-vs-mls/)
- [Secure Group Chat Protocols — Haven Messenger](https://havenmessenger.com/blog/posts/secure-group-chat-protocols/)
- [The Double Ratchet: Security Notions, Proofs, and Modularization (IACR 2018/1037)](https://eprint.iacr.org/2018/1037)
- [Formal Analysis of Chat Encryption Constructions (IACR 2025/554)](https://eprint.iacr.org/2025/554)
