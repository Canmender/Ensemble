# 合鸣（Ensemble）功能补全与 API 差距报告

**日期：** 2026-09-05
**范围：** 合鸣当前功能与 API 全景清单，对照「标准 IM（WhatsApp/Telegram/微信）」与「Agent/多智能体产品（OpenClaw/多智能体编排）」的差距，以及补全优先级与分阶段计划。
**方法：** 逐模块读取 server 路由 + mobile services + desktop renderer 实际代码，端点级核对字段；非文档推测。
**约定：** 本文件不含真实 IP/凭据，外部主机一律 `<SERVER_IP>` / `<NTFY_SERVER_IP>`。

---

## 0. 一句话结论

合鸣**已具备企业级 IM + Agent 编排 + E2EE + 多端同步的骨架**，功能广度接近 OpenIM，但在「IM 消息语义完整性（回执/群管理/媒体/搜索/历史迁移）」和「Agent 工程化（会话状态/流式/权限/反馈）」上仍是骨架。桌面端是 API 消费最完整的端，**移动端约缺 60% 的 API 覆盖面**，是最大的端侧缺口。补全按 P0（修坏+补回执+收协议）→ P1（群管理/媒体/Agent闭环）→ P2（高级特性）三阶段走。

> ⚠️ 前置警示（来自 backend 审计 docs/audit-backend-2026-09-04.md，本报告默认其成立）：当前 server 存在「坏合并」回退——`store.ts`/`db/sqlite.ts` 被回退到 pre-v0.8.3，`tsc` 52 错、25/193 测试红，9 个路由文件存在但 `app.ts` 未挂载，`chat_messages` 无 `seq` 列、`createChatMessage` 返回 void、`batchGetReactions`/`markDelivered` 方法不存在。**下列很多「已实现」的端点在运行时是坏的或 404**。功能补全必须建立在先修坏的基础上，否则是在坏地基上加层。

---

## 1. 合鸣当前功能全景（按模块，三端覆盖）

标注：✅ 完整 · 🟡 部分/骨架 · ❌ 缺失 · 🐛 坏（存在但不工作/404，见前置警示）

| 模块 | 服务端 | 移动端 | 桌面端 | Web端 |
|---|---|---|---|---|
| 认证（注册/登录/JWT/登出） | ✅ | ✅ | ✅ | ✅ |
| 用户资料/头像 | ✅ | ✅ | ✅ | ✅ |
| 好友（增删/列表/资料） | ✅ | ✅ | ✅ | 🟡 |
| 会话列表 | ✅ | ✅ | ✅ | 🟡 |
| 1对1 聊天 | ✅🐛(seq) | ✅ | ✅ | 🟡 |
| 群聊（建群/成员/消息） | 🟡(路由未挂载) | 🟡(无管理UI) | 🟡 | ❌ |
| 消息状态（已送达/已读回执） | 🐛(无status字段) | ❌ | ❌ | ❌ |
| 消息编辑/撤回 | 🟡(撤回🐛) |  | ✅ | ❌ |
| 已读标记（逐条） | ❌ | ❌ | ❌ | ❌ |
| 消息搜索 | ❌ | ❌ | ❌ | ❌ |
| 附件/图片 | 🐛(upload用ctx.storage) | 🟡 | 🟡 | ❌ |
| 语音/视频通话（WebRTC） | ✅ | ✅ | 🟡 | ❌ |
| 系统通知/推送（ntfy） | 🐛(无鉴权+topic可枚举) | 🟡(前台长轮询) | ❌ | ❌ |
| E2EE（Curve25519/预密钥） | 🟡(bundle无ownership校验) | 🟡(半环未闭环) | 🟡 |  |
| 设备管理/配对 | 🟡(relay token不落盘) | 🟡 |  | ❌ |
| Agent 对话（单 agent 聊天） | ✅ | ✅ | ✅ | 🟡 |
| Agent 编排（多 agent/工作流/DAG） | ✅ | 🟡 | 🟡 | 🟡 |
| Agent 会话状态持久化 | ❌ | ❌ | ❌ | ❌ |
| Agent 流式输出（SSE） | ❌ | ❌ | ❌ | ❌ |
| Agent 工具调用/权限 | ❌ | ❌ | ❌ | ❌ |
| 记忆（长期/显式删除） | 🟡(删除无ownership) | ❌ | 🟡 |  |
| 用户插件（卡片/Web片段） | 🟡(路由未挂载) | ❌ |  | ❌ |
| 组织/权限（团队五级角色） | 🟡(路由未挂载) | 🟡(仅me+list) | 🟡 | ❌ |
| Token 用量/计费 | 🟡(路由未挂载) | ❌ |  | ❌ |
| 应用内更新（自研） | ✅ | ✅ | ✅ | ❌ |
| 主题（三态外观/动态主题） | — | ✅ | ✅ | ✅ |
| 国际化 | ❌ | ❌ | ❌ | ❌ |

---

## 2. 合鸣 API 端点全景（按模块，约 127 个端点）

路径相对 `/api`。标注 🐛 = 文件存在但 app.ts 未挂载或运行时报错。

**认证 `/auth`（6）**
- `POST /register` · `POST /login` · `POST /logout` · `GET /me` · `POST /change-password` · `POST /refresh`

**用户 `/users`（4）**
- `GET /`（列表，🐛无角色守卫）· `GET /:id` · `PUT /:id` · `GET /:id/avatar`

**好友 `/friends`（5）**
- `POST /`（添加）· `DELETE /:id` · `GET /`（列表）· `GET /:id`（资料）· `POST /:id/accept`（接受）

**会话 `/conversations`（5）**
- `GET /`（列表）· `GET /:id`（详情，🐛缺requireRole）· `POST /`（建会话）· `GET /:id/messages`（拉历史，🐛每调用必500 + afterSeq被丢弃返回全量）· `POST /:id/read`（标记已读）

**消息 `/messages`（3）**
- `POST /`（发送，🐛createChatMessage返回void + 无status字段 + 重复clientMsgId UNIQUE 500）· `PUT /:id`（编辑）· `DELETE /:id`（撤回🐛）

**群组 `/groups`（7）🐛整个文件未挂载**
- `POST /`（建群）· `GET /:id` · `POST /:id/members`（加人）· `DELETE /:id/members/:uid`（踢人）· `PUT /:id`（改群名/群头像）· `POST /:id/leave` · `DELETE /:id`（解散）

**Agent `/agents`（5）🐛CRUD无requireRole**
- `POST /`（创建）· `GET /` · `PUT /:id` · `DELETE /:id` · `POST /:id/chat`（对话）

**E2EE `/e2e`（4）**
- `GET /bundle`（🐛无ownership校验，可拉任意用户密钥包）· `POST /prekeys` · `POST /:id/share-key` · `GET /status`（🐛E2EE enrolled枚举）

**助手 `/assistant`（1）**
- `POST /ask`（🐛路径漂移：移动端调 `/api/assistant/chat`）

**工作流 `/workflows`（4）🐛全部端点无守卫**
- `POST /`（建）· `GET /:id` · `POST /:id/run` · `GET /:id/status`

**插件 `/user-plugins`（4）🐛未挂载**
- `POST /`（安装）· `GET /` · `DELETE /:id` · `POST /:id/toggle`

**记忆 `/memory`（3）🐛deleteExplicit无ownership**
- `GET /` · `PUT /` · `DELETE /explicit`

**组织 `/org`（3）🐛未挂载 + 路径逃逸hack**
- `GET /me` · `GET /list` · `PUT /:id/role`（🐛`../../users/:id`路径逃逸）

**Token 用量 `/tokens`（2）🐛未挂载**
- `GET /usage` · `GET /:id`

**设备配对 `/pairs`（3）🐛未挂载**
- `POST /request` · `GET /pending` · `POST /:id/accept`

**上传 `/uploads`（1）🐛用ctx.storage（AppContext无此字段）全500**
- `POST /`（附件）

**消息表情 `/reactions`（2）🐛未挂载**
- `POST /:msgId` · `DELETE /:msgId/:emoji`

**应用版本 `/app-version`（3）**
- `GET /desktop` · `GET /mobile` · `GET /web`

**设备 `/devices`（3）**
- `GET /`（🐛公网无鉴权枚举）· `POST /register` · `DELETE /:id`

**服务器状态 `/server-status`（1）**
- `GET /`

**设置 `/settings`（2）**
- `GET /`（🐛返回未脱敏settings，maskSettings只在PUT）· `PUT /`

**WS 通道（非REST）**
- socket.io 设备通道（relay 互联）· ws hub 用户通道（🐛subscribe无runId归属校验；sendToUser缺省runId=""致移动端静默丢事件）
- ⚠️ 双 WS 通道未收敛，无共享 presence/seq；信封字段三方不兼容（desktop `{event,runId,payload}` vs mobile `{event,runId,data:{}}` vs relay 原始透传）

**协议源分裂（RL-1）：** 全仓无单一协议源——desktop 内嵌 shared 导出 `WS_*`，顶层 `shared/` 导出 `PROTOCOL_VERSION`，mobile 硬编码字面量，relay-server 注释「keep in sync with shared/messages」纯手工同步。共 **5 份协议实现已漂移**。

---

## 3. 对照标准 IM（WhatsApp / Telegram / 微信）缺什么

按「标准 IM 用户预期 → 合鸣现状 → 差距」列。

### 3.1 消息语义（最大缺口，P0）
| 标准 IM 能力 | 合鸣现状 | 差距 |
|---|---|---|
| 每条消息单调递增 seq（去重/补拉） | `chat_messages` **无 seq 列** | P0：重连补拉返回全量历史，客户端去重键失效 |
| 发送幂等（client_msg_id 去重） | `createChatMessage` 返回 void + 重复键 UNIQUE 500 | P0：幂等死代码，重发报 500 |
| 已送达回执（✓）/ 已读回执（✓✓） | 无 status 字段，无逐条已读 | P0：微信/WhatsApp 最基础的状态，合鸣完全没有 |
| 消息状态机（sending/sent/delivered/read/failed） | 无 | P0 |
| 消息编辑 | 有 PUT，🐛不稳定 | P1 |
| 撤回（含时限） | 有 DELETE，🐛 | P1 |
| 消息搜索（全文/按人/按会话） | 无 | P1：IM 高频需求 |
| 批量拉历史（分页+游标） | afterSeq 第三参被单参签名丢弃 | P0：无法增量拉 |
| 未读计数（按用户/按会话） | agent 路径不按用户 | P1 |

### 3.2 群能力（P1）
| 标准 IM | 合鸣 | 差距 |
|---|---|---|
| 群成员管理（加/踢/改角色） | 路由存在但未挂载，无 UI | P1 |
| 群公告/群头像/群名 | 路由存在未挂载 | P1 |
| 群内 @ 提及 | 有 mentions 字段，解析不完整 | P1 |
| 管理员/群主权限 | 无角色模型 | P1 |
| 会话 isFriend 双向 | 只查对方单向（conversation.ts:415） | P1：好友标记不准 |

### 3.3 媒体（P1）
| 标准 IM | 合鸣 | 差距 |
|---|---|---|
| 图片/文件上传 | 路由存在，🐛用 ctx.storage 全 500 | P1：上传链路实际不可用 |
| 图片压缩/缩略图 | 无 | P2 |
| 语音条（录制+时长） | WebRTC 通话有，语音条无 | P2 |
| 视频 | 仅 WebRTC 实时，无视频文件 | P2 |
| 表情包/sticker | 无（只有 reaction） | P2 |

### 3.4 通知与离线（P0-P1）
| 标准 IM | 合鸣 | 差距 |
|---|---|---|
| 离线推送（杀进程也能收） | 移动端前台 fetch 长轮询，**App 被杀即断** | P0：无真正的后台通道 |
| 推送鉴权 | ntfy 服务器**无鉴权**，`NTFY_TOKEN` 设计有但代码未实现 | P0 |
| 推送 topic 不可枚举 | topic=`ensemble-<userId>`，userId 形如 `user_<16hex>` 可枚举 | P0：任何人可订阅窃听/伪造 |
| 推送不含正文 | 推送 body 直接带 `content.slice(0,60)` | P0 |
| 前台自动重连 | 聊天屏 WS 无自动重连、无 AppState 前台补拉 | P1 |
| WS token 传输安全 | 走 query param `auth_token=`，日志/代理留存 | P1 |

### 3.5 账号与多设备（P1）
| 标准 IM | 合鸣 | 差距 |
|---|---|---|
| 多设备同时在线 | 无共享 presence/seq | P1 |
| 会话状态随登出重置 | 推送/设备/会话用模块级单例，不随登出重置 | P1：多账号串状态 |
| 设备配对/信任 | 路由存在未挂载 | P1 |
| 账号注销/数据迁移 | 无 | P2 |

### 3.6 历史与迁移（P2）
| 标准 IM | 合鸣 | 差距 |
|---|---|---|
| 消息归档/导出 | 无 | P2 |
| 换机历史同步 | 依赖服务端，但 E2EE 半环未闭环 | P2 |
| 草稿 | 无 | P2 |

---

## 4. 对照 Agent/多智能体产品（OpenClaw / 多智能体编排）缺什么

| Agent 产品能力 | 合鸣现状 | 差距 |
|---|---|---|
| 单 Agent 对话 | ✅ 可用 | — |
| 多 Agent 编排（工作流/DAG/角色分工） | ✅ 有 workflows，🐛无守卫 | 可用但需加固 |
| Agent 会话状态持久化（跨轮上下文） | ❌ 无 | P1：多轮对话无状态，每次重新拼 prompt |
| 流式输出（SSE/逐 token） | ❌ 无，全量返回 | P1：长回答体验差 |
| Agent 工具调用/函数调用 | ❌ 无 | P1：Agent 只能答不能做 |
| Agent 工具权限/审批（human-in-the-loop） | ❌ 无 | P1：安全风险 |
| Agent 反馈（赞/踩/重生成） | ❌ 无 | P2 |
| Agent 记忆（长期记忆读写） | 🟡 有 memory，🐛删除无 ownership | P1 |
| Agent 用量/成本（token 计费） | 🟡 路由未挂载 | P1 |
| Agent 模型选择/多模型路由 | ❌ 无 | P2 |
| Agent 插件（自定义工具/卡片） | 🟡 路由未挂载，无 UI | P1 |
| E2EE 保护 Agent 消息 | 🟡 半环未闭环（kex_complete 无人接收） | P1 |
| Agent 群（Agent 加入群聊协作） | ❌ 无 | P2：合鸣差异化卖点，未做 |
| 任务/定时 Agent | 插件系统方案里有「定时」挂载面，未实现 | P2 |

**合鸣差异化卖点（相对纯 IM）：** AI 编排 / 插件 / E2EE / relay 多设备互联 / 组织权限。这些是护城河，但当前多数是「有路由骨架、无闭环」——E2EE 半环、插件无 UI、组织权限仅 me+list。

---

## 5. 三端各自缺口

### 移动端（最大缺口，API 覆盖约 40%）
- 缺：群管理 UI、消息状态（回执）、消息搜索、附件上传（服务端也坏）、记忆管理 UI、Token 用量 UI、组织/权限 UI、设备配对 UI、Agent 流式
- 单例不随登出重置 → 多账号串状态
- 推送无后台通道、WS 无前台重连
- E2EE 非真 libsignal（注释自称占位，「生产须装 libsignal」）
- 白屏根因：`ms` StyleSheet 包装器从未存在（30+ 文件模块顶层调用）→ 补 `export const ms = StyleSheet.create`
- 服务器地址硬编码（connection.ts 有真实 IP）→ 应用内更新无法换服务器

### 桌面端（最完整，但仍是骨架）
- API 消费最完整（org/插件/token 都有 UI 调用，尽管服务端路由未挂载）
- 缺：Agent 流式、Agent 工具权限、消息搜索、E2EE 闭环
- 双版本（cloud/local）脚手架 ensemble-*/packages/ 是活跃漂移隐患，建议删除只留 start.bat

### Web 端（最薄）
- 仅基础聊天/认证，群/Agent/插件/组织/推送几乎全缺
- 是四大端中功能最薄的，可作为「轻量只读端」定位或暂缓

---

## 6. 补全优先级与分阶段计划

### 阶段 0 — 修坏地基（阻塞一切，必须先做，约 2-3 天）
> 来自 backend 审计，不修则后续全在坏地基上。
1. 恢复被坏合并回退的 `store.ts`/`db/sqlite.ts`（git checkout 正确版本）
2. `chat_messages` 加 `seq` 列 + 迁移
3. `createChatMessage` 返回 message 对象（非 void）+ 幂等去重
4. 补齐 `batchGetReactions`/`markDelivered` 等被删方法
5. `app.ts` 挂载 9 个未挂载路由（groups/tokens/reactions/assistant/org/user-plugins/pairs/e2e）
6. 修 `ctx.storage`（AppContext 补字段）让上传可用
7. 收敛双 `@ensemble/shared` 树

### 阶段 1 — IM 消息语义 + 协议收敛（P0，约 1 周）
1. **单一协议源**：建 shared 协议包，desktop/mobile/relay/web 全部 import，消灭 5 份漂移；统一信封 `{event,runId,payload}`；统一 presence/seq
2. **消息状态机**：加 `status` 字段（sending/sent/delivered/read）+ 逐条已读回执 + 已送达回执
3. **增量拉历史**：修 afterSeq 签名，游标分页
4. **ntfy 加固**：随机设备级 topic（或 HMAC）+ 恢复 NTFY_TOKEN 鉴权 + 推送脱敏（不带正文）+ 真正的后台通道
5. **移动端 ms() 修复**（白屏 P0）
6. **WS 前台重连 + AppState 补拉**（移动端）
7. 三处真实 IP 脱敏（隐私红线）

### 阶段 2 — 群管理 + 媒体 + Agent 闭环（P1，约 1-2 周）
1. 群管理 UI（加/踢/角色/公告）+ isFriend 双向
2. 媒体上传闭环（图片压缩/缩略图）
3. Agent 会话状态持久化（跨轮上下文）
4. Agent 流式输出（SSE）
5. E2EE 闭环（补 kex_complete 接收端，或换真 libsignal）
6. 记忆 ownership 校验 + 移动端记忆 UI
7. 消息搜索（服务端全文索引）
8. 设备配对闭环

### 阶段 3 — 高级特性 + 差异化（P2，持续）
1. Agent 工具调用/权限（human-in-the-loop）
2. Agent 群（Agent 入群协作）— 合鸣护城河
3. 用户插件 UI 闭环（卡片/Web片段/原生插槽）
4. 组织权限全功能（五级角色 + 部门树）
5. 国际化
6. 多设备 presence 共享
7. 删除 ensemble-*/packages/ 漂移隐患

### 端侧建议
- **移动端优先**（缺口最大、是用户主入口）：阶段 1 全部 + 阶段 2 的群/媒体
- **桌面端**：API 已较全，重点补 Agent 流式/工具/搜索
- **Web 端**：建议定位为轻量只读端或暂缓，资源投移动/桌面

---

## 7. 风险与依赖

- **阶段 0 是硬前置**：当前 server 运行时是坏树（52 tsc 错、9 路由未挂载、消息链路多 500），不先修，任何新功能都立不住。
- **协议收敛（1.1）牵一发动全身**：5 端同时改信封，需一次性联调，建议先冻结 mobile 字面量、统一到 shared 包。
- **E2EE**：当前非真 libsignal，若要「端到端加密」作为卖点，阶段 2 的闭环是诚实前提；否则应降级表述。
- **ntfy**：若短期不做鉴权+随机 topic，至少文档标注「仅限可信网络自用」。

---

*本报告基于 2026-09-05 对 server 路由 / mobile services / desktop renderer 的逐模块代码核对。端点级 🐛 标记来自 backend 审计（docs/audit-backend-2026-09-04.md）的实测，落地修复前应逐条复核行号。*
