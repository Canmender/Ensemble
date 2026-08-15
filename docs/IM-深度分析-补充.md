# box-im 与 V-IM 二次深度分析（文件+行号证据）

> 定位：在第一轮对比分析（docs/IM-boxim-vim-对比分析.md）基础上，对高风险链路做二次深挖，落到具体文件与行号。
> 范围：①消息收发/推送/离线/去重全链路 ②群聊权限与管理 ③WebRTC 信令安全 ④前端 store/WS 竞态 ⑤数据库 schema/索引 ⑥接口越权复核。

---

## 1. box-im 消息全链路（平台端 -> Netty 推送）

**1.1 消息内容明文写入日志（隐私/合规）**
- im-platform/.../service/impl/PrivateMessageServiceImpl.java：sendMessage() `log.info("发送私聊消息...内容:{}", ...)` 与 recallMessage() 把用户聊天内容打印到 info 级。
- im-server/.../netty/processor/PrivateMessageProcessor.java：process() `log.info("接收到私聊消息...内容:{}", ...)`；GroupMessageProcessor.process() 同样打印 `内容:{}`。
- 影响：消息明文进日志文件，若日志被审计/泄露即造成聊天记录泄露。建议：content 脱敏或降到 debug，或加密存储。

**1.2 群消息日志打印接收用户数量与内容**
- GroupMessageProcessor.process()：`log.info("接收到群消息...接收用户数量:{},内容:{}", ...)`。

**1.3 推送结果回写依赖 Redis 队列（跨进程最终一致）**
- PrivateMessageProcessor.sendResult() / GroupMessageProcessor.sendResult()：将 SUCCESS / NOT_FIND_CHANNEL / UNKONW_ERROR 写入 IM_RESULT_PRIVATE_QUEUE / IM_RESULT_GROUP_QUEUE（按 serviceName 分 key），由 im-platform 订阅消费更新状态。
- 关注点：receivers 为空时直接 return（不写结果），部分目标处于处理中时状态可能停留 PENDING；需确认消费端幂等。

**1.4 分页/离线消息上限与时间窗**
- loadOfflineMessage / loadOffineMessage：均 `limit MAX_OFFLINE_MESSAGE_SIZE` 且限定 MAX_OFFLINE_MESSAGE_DAYS 时间窗，并保证每会话至少拉一条——边界较严谨。

---

## 2. box-im 群聊权限 / 越权复核

### 高危：任意群成员 / 在线状态 未做成员校验（IDOR / 隐私泄露）
- GroupController.java：`GET /group/members/{groupId}`、`GET /group/members/online/{groupId}` 直接调 groupService.findGroupMembers / findOnlineMemberIds；
- GroupServiceImpl.java findGroupMembers()：仅 getById(groupId) + findByGroupId(groupId, version)，**未校验调用者是否在群内**；findOnlineMemberIds() 同样无成员校验。
- GroupMessageController.java：`GET /message/group/findReadedUsers` 经 findReadedUsers() 已做成员校验，此端点安全。
- 影响：任意已登录用户只要知道 groupId 即可枚举任意群成员列表、在线成员 id 集合——水平越权/信息泄露。
- 修复：findGroupMembers / findOnlineMemberIds 入口先做 findByGroupAndUserId + quit==false 校验。

### 中危：invite() 潜在 NPE（健壮性）
- GroupServiceImpl.invite()：`if (Objects.isNull(group) || member.getQuit())`——调用者非群成员时 member 为 null，member.getQuit() 抛 NPE；应改为 member == null || member.getQuit()。

### 良性：群主/管理动作校验较严
- deleteGroup / removeGroupMembers 强校验 ownerId；removeGroupMembers 禁止移除群主与自己；recallMessage 校验 sendId + 5分钟窗口 + 仍在群。

---

## 3. box-im WebRTC 信令安全

### 高危：call() 未校验对方是否为好友（骚扰/欺诈向量）
- WebrtcPrivateServiceImpl.call(uid, mode, offer)：仅 @OnlineCheck + isOnline(uid) + isBusy(uid)，**不校验 uid 是否好友**；任意登录用户知道 userId 即可发起音视频呼叫（响铃 + 可被标记 busy）。
- 且 call 同时 setBusy(uid) 与 setBusy(session.userId)——恶意调用方可反复发起/取消以长期占用对方 busy。
- 修复：call 前做 friendService.isFriend(session.userId, uid) 校验（与私聊 sendMessage 对齐）+ 限频。

### 中危：信令仅靠双端 userId 组 key，无一次性 nonce/房间 token
- getWebRtcSessionKey(userId1, userId2) 由两个 userId 拼 key；建议信令加随机 roomId 与有效期校验。

### 良性：Redis TTL 60 秒自动清理；acceptor 有忙闲状态机。

---

## 4. V-IM 消息链路 / 群聊 / WS 健壮性

**4.1 反伪造较到位**
- MessageHandlerService.handleMessage()：强制 message.setFromId(channelContext.userid)，忽略客户端 fromId——防发件人伪造。
- handleFriendMessage()：canSendFriendMessage 校验好友/非好友开关；handleGroupMessage()：canSendGroupMessage 校验群成员。权限模型稳健。

**4.2 WS 消息处理整体 try/catch 吞异常**
- TioWsMsgHandler.onText()：catch(Exception e){ log.error(...) } 包住全部逻辑，坏消息静默丢弃、无确认/重试。
- 且 onText 每条先 messageLogService.logMessage(text, userId)（记录 JSON 明文）再解析——日志既有明文又有敏感内容。

**4.3 握手不鉴权，绑定靠 READY**
- TioWsMsgHandler.handshake() 直接放行；鉴权在 bindUserInfo()（READY 内 StpUtil.getLoginIdByToken）。未绑定前 channelContext.userid 为 null，普通消息会 NPE（被吞）。

---

## 5. 前端 store / WS 状态与竞态

### box-im im-web
- src/api/wssocket.js：单例 isConnect 防重连，心跳 heartCheck 有 reset/start；但 **onclose 不触发 reconnect**——服务端重启/断网后连接关闭即停，不会自动重连（仅 connect 失败时 catch 里调 reconnect，延迟 15s）。
- devId 用 Math.random()*1000000，弱随机作为设备标识。
- src/store/chatStore.js：消息状态由本地 + 服务端回执共同驱动，离线推送结果经 Redis 队列异步回流——多端并发更新状态存在一致性问题，建议以服务端回执为准做幂等合并。

### V-IM v-im-pc（Electron）
- useChatTextArea.ts / useUploadOperation.ts / views/chat/ChatBox.vue：大量直接操作 messageTextArea.innerHTML，粘贴/拖拽图片时拼接 HTML，可能引入未净化标签或重复上传，存在连续发送/上传竞态。
- Electron 主进程安全较好（contextIsolation:true、nodeIntegration:false、setWindowOpenHandler 拦截、openExternalUrl 校验协议）；建议 sandbox:true。

---

## 6. 数据库 schema / 索引

### box-im（db/im-platform.sql）
- im_private_message：idx_conv_key_seq_no(conv_key,seq_no)、idx_send_recv_id(send_id,recv_id,id)、idx_recv_id(recv_id)——覆盖会话/收发查询，索引良好。
- im_group_message：idx_group_id_seq_no(group_id,seq_no)、idx_send_time(send_time)——覆盖群消息分页与时间窗，良好。
- im_group_member：idx_group_id、idx_user_id——覆盖按群/按用户成员查询，良好。
- 核心表：im_user/im_friend/im_private_message/im_group/im_group_member/im_group_message/im_sensitive_word/im_file_info/im_message_deletion。

### V-IM（doc/v-im.sql）
- 表较精简：im_friend / im_group / im_group_invite / im_group_user / im_message_immunity / im_setting；群成员用 im_group_user，邀请用 im_group_invite，免疫/审批用 im_message_immunity。
- 关注点：未见独立大表 offline/history，历史消息落 VimMessageService；需确认群消息存查与分页索引，避免大群聊无索引全表扫描。

---

## 7. 接口级越权/参数校验复核小结

| 端点 | 项目 | 现状 | 结论 |
|---|---|---|---|
| /group/members/{id}、/group/members/online/{id} | box-im | 无成员校验 | IDOR 高危，需修复 |
| /message/group/findReadedUsers | box-im | 有成员校验 | 正常 |
| /message/private/recall/{id} | box-im | sendId 归属+5min | 正常 |
| /message/group/history | box-im | 成员校验 | 正常 |
| webrtc call/accept/reject/cancel | box-im | call 无好友校验 | 需补好友校验 |
| WS send（friend/group）| V-IM | fromId 强制服务端 + 好友/群校验 | 正常 |
| /profile/** 附件访问 | V-IM | 无鉴权公开 | 高危，需修复 |

---

## 8. 优先修复清单（供后续动手）

1. box-im 群成员/在线接口补成员校验（GroupServiceImpl.findGroupMembers / findOnlineMemberIds）。
2. box-im WebRTC call 补好友校验（WebrtcPrivateServiceImpl.call），并对反复呼叫做限频。
3. box-im im-web wssocket.js onclose 触发自动重连（对齐合鸣 mobile 的重连逻辑）。
4. V-IM /profile/** 附件改为带鉴权流式接口，防公开访问。
5. 两项目消息内容与 token 日志脱敏（统一建议）。
6. box-im invite() NPE 修复（member == null）。

---
*文档基于对 box-im / V-IM 源码逐一阅读与文件+行号证据，供优化与加功能阶段使用。*