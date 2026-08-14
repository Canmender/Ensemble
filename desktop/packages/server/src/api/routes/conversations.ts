import { Router } from "express";
import type { AppContext } from "../../context";
import type { Store } from "../../orchestration/store";
import { asyncH, fail, ok } from "./helpers";
import { newId } from "../../util/id";
import type { Conversation, MessageAttachment, MessageReply } from "@ensemble/shared";

const now = () => new Date().toISOString();

/** 校验并归一化消息附件（来自 upload 端点的 url；结构不合法返回 undefined） */
function parseAttachment(raw: unknown): MessageAttachment | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Record<string, unknown>;
  const type = a.type === "image" || a.type === "video" || a.type === "file" ? a.type : null;
  if (!type || typeof a.url !== "string" || !a.url) return undefined;
  return {
    type,
    name: typeof a.name === "string" && a.name ? a.name : "附件",
    size: typeof a.size === "number" ? a.size : 0,
    mime: typeof a.mime === "string" ? a.mime : undefined,
    url: a.url,
  };
}

/** 校验并归一化引用摘要（引用回复；id 必填） */
function parseReply(raw: unknown): MessageReply | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return undefined;
  return {
    id: r.id,
    content: typeof r.content === "string" ? r.content : "",
    agentName: typeof r.agentName === "string" ? r.agentName : undefined,
  };
}

/** 会话列表最后一条消息的预览文案（附件消息用占位符，纯文本用原文） */
function previewText(content: string, attachment?: MessageAttachment): string {
  if (attachment) return attachment.type === "image" ? "[图片]" : `[文件] ${attachment.name}`;
  return content;
}

/** 用户-用户会话（runId = conv id，无 agent run） */
const isUserConv = (conv: Conversation): boolean => conv.runId.startsWith("conv_");

/**
 * 会话访问控制：
 * - 用户-用户会话：仅归属用户与参与者可读写（多用户隔离）
 * - Agent 会话：归属用户或共享会话（user_id 为空）可访问
 */
function canAccessConv(conv: Conversation, userId?: string): boolean {
  if (isUserConv(conv)) {
    return !!userId && (conv.userId === userId || conv.participantIds.includes(userId));
  }
  if (conv.type === "group") {
    // 群聊：归属用户或参与者可访问（人+Agent 混合群的其他用户也能进）
    return !conv.userId || conv.userId === userId || (!!userId && conv.participantIds.includes(userId));
  }
  return !conv.userId || conv.userId === userId;
}

/**
 * 企业级会话 API（conversations）：
 * - direct：用户与单个 agent 的 1:1 对话（chat run + 1 participant）
 * - group：多 agent 群聊
 * 消息沿用 chat_messages（run_id 关联），未读计数与会话元数据存 conversations 表。
 */

/** 解析文本中的 @提及 → 被@的参与者 ID 列表 */
function parseMentions(
  content: string,
  participantIds: string[],
  senderId: string,
  store: Store,
): string[] {
  const mentioned: string[] = [];
  const mentionRe = /@([\p{L}\p{N}_]{1,20})/gu;
  let match: RegExpExecArray | null;
  while ((match = mentionRe.exec(content)) !== null) {
    const name = match[1];
    for (const pid of participantIds) {
      if (pid === senderId || mentioned.includes(pid)) continue;
      const user = store.getUser(pid);
      if (user && (user.displayName === name || user.username === name)) {
        mentioned.push(pid);
      }
    }
  }
  return mentioned;
}

export function conversationsRouter(ctx: AppContext): Router {
  const r = Router();

  /** 会话列表（当前用户，含 lastMessage / 未读） */
  r.get("/", (req, res) => {
    const archived = req.query.archived === "1" || req.query.archived === "true";
    ok(res, ctx.store.listConversations(req.user?.id, { archived }));
  });

  /** 创建会话（direct：单 agent；group：多 agent 群聊） */
  r.post(
    "/",
    asyncH(async (req, res) => {
      const body = (req.body ?? {}) as {
        type?: string;
        title?: string;
        participantIds?: string[];
        prompt?: string;
      };
      const type = body.type === "group" ? "group" : body.type === "direct" ? "direct" : null;
      const participantIds = Array.isArray(body.participantIds) ? body.participantIds.filter((x) => typeof x === "string") : [];
      if (!type) return fail(res, new Error('type 需为 "direct" 或 "group"'), 400);
      if (participantIds.length === 0) return fail(res, new Error("participantIds 至少一个参与者"), 400);

      // 区分用户与 agent 参与者（user id 以 user_ 开头或存在于用户表）
      const isUser = (id: string) => id.startsWith("user_") || !!ctx.userStore.getById(id);
      const userParticipants = participantIds.filter(isUser);
      const agentParticipants = participantIds.filter((id) => !isUser(id));
      if (type === "direct" && participantIds.length !== 1) {
        return fail(res, new Error("direct 会话需要一个参与者"), 400);
      }

      const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : type === "direct" ? participantIds[0] : "群聊";

      // 纯用户会话（无 Agent 参与，含纯用户群）：不创建 run，消息直接落库 + 定向推送
      if (agentParticipants.length === 0) {
        const id = newId("conv");
        const conv: Conversation = {
          id,
          userId: req.user?.id,
          type,
          title,
          participantIds,
          runId: id,
          unread: 0,
          createdAt: now(),
          updatedAt: now(),
        };
        ctx.store.createConversation(conv);
        // 群聊设置群主（创建者）
        if (type === "group" && req.user?.id) {
          ctx.store.setConversationGroupOwner(id, req.user.id);
        }
        ok(res, conv, 201);
        return;
      }

      // Agent 群 / 人+Agent 混合群：创建 chat 模式 run（调度 agent 讨论）
      const prompt = body.prompt ?? `会话「${title}」已创建，请开始。`;
      const run = await ctx.engine.createAndExecuteTask(
        title,
        { mode: "chat", prompt, participantIds: agentParticipants, maxRounds: 50 },
        req.user?.id,
      );

      const conv: Conversation = {
        id: newId("conv"),
        userId: req.user?.id,
        type,
        title,
        participantIds,
        runId: run.id,
        unread: 0,
        createdAt: now(),
        updatedAt: now(),
      };
      ctx.store.createConversation(conv);
      ok(res, conv, 201);
    }),
  );

  /** 消息历史（分页：before = 时间戳游标，limit 默认 50） */
  r.get(
    "/:id/messages",
    asyncH(async (req, res) => {
      const conv = ctx.store.getConversation(String(req.params.id));
      if (!conv) return fail(res, new Error("conversation not found"), 404);
      if (!canAccessConv(conv, req.user?.id)) return fail(res, new Error("无权限访问该会话"), 403);

      const before = typeof req.query.before === "string" ? req.query.before : undefined;
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);

      // 用户-用户会话（runId = conv id）：消息双方共享，不做 userId 过滤（否则对方看不到自己的消息）
      // 共享历史：用户-用户会话 / 群聊（含 Agent 群、人+Agent 混合群）双方可见；direct agent 会话按归属过滤
      const shared = isUserConv(conv) || conv.type === "group";
      const all = shared
        ? ctx.store.listChatMessages(conv.runId)
        : ctx.store.listChatMessages(conv.runId, req.user?.id);
      const filtered = before ? all.filter((m) => m.ts < before) : all;
      // 已读回执：用户-用户会话返回各参与者最后已读时间（前端按接收者判断自己的消息是否已被读）
      const readers = isUserConv(conv) ? ctx.store.getConversationReads(conv.id) : [];
      ok(res, { messages: filtered.slice(-limit), total: all.length, readers });
    }),
  );

  /** 发送消息（fire-and-forget；agent 回复经 WS 实时推送） */
  r.post(
    "/:id/messages",
    asyncH(async (req, res) => {
      const conv = ctx.store.getConversation(String(req.params.id));
      if (!conv) return fail(res, new Error("conversation not found"), 404);
      if (!canAccessConv(conv, req.user?.id)) return fail(res, new Error("无权限访问该会话"), 403);
      // 群禁言检查（非用户-用户会话）
      if (!conv.runId.startsWith("conv_") && conv.groupMuted) {
        return fail(res, new Error("群已开启全体禁言"), 403);
      }
      const body = (req.body ?? {}) as { content?: unknown; attachment?: unknown; replyTo?: unknown };
      const content = typeof body.content === "string" ? body.content.trim() : "";
      const attachment = parseAttachment(body.attachment);
      const replyTo = parseReply(body.replyTo);
      if (!content && !attachment) {
        return fail(res, new Error("content 或 attachment 必填"), 400);
      }

      // 用户-用户会话（无 run）：消息落库 + 实时推送参与者用户 + per-user 未读
      if (isUserConv(conv)) {
        const senderId = req.user?.id ?? "user";
        // 解析 @提及：@昵称 或 @用户名 → 参与者 ID
        const mentions = parseMentions(content, conv.participantIds, senderId, ctx.store);
        const msgId = newId("msg");
        ctx.store.createChatMessage({
          id: msgId,
          runId: conv.runId,
          jobId: undefined,
          agentId: senderId,
          role: "user",
          content,
          attachment,
          replyTo,
          mentions: mentions.length > 0 ? mentions : undefined,
          userId: req.user?.id,
          ts: now(),
        });
        ctx.store.updateConversationMeta(conv.id, previewText(content, attachment), now());
        // 推送参与者（除发送者）+ 未读。接收者 = 归属用户 + participants（创建者不在 participants 里）
        // runId = conv.runId（conv id），客户端据此把实时消息关联到会话
        const recipients = new Set<string>([conv.userId, ...conv.participantIds].filter((x): x is string => !!x));
        const senderName = ctx.store.getUser(senderId)?.displayName || ctx.store.getUser(senderId)?.username || senderId;
        for (const pid of recipients) {
          if (pid === senderId) continue;
          ctx.hub.sendToUser(pid, {
            type: "chat.message",
            jobId: "",
            agentId: senderId,
            content,
            attachment,
            replyTo,
            mentions: mentions.length > 0 ? mentions : undefined,
          }, conv.runId);
          ctx.store.incrementUnread(conv.id, pid);
          // @提及通知：被@的用户额外收到 chat.mention 事件（优先级更高，始终弹通知）
          if (mentions.includes(pid)) {
            ctx.hub.sendToUser(pid, {
              type: "chat.mention",
              convId: conv.id,
              convTitle: conv.title || senderName,
              senderId,
              senderName,
              content: content.slice(0, 100),
            });
          }
        }
        ok(res, { sent: true, msgId });
        return;
      }

      // Agent 会话：steering + 广播（agent 链路目前只处理文本）
      if (attachment) {
        return fail(res, new Error("暂不支持向 Agent 发送附件"), 400);
      }
      const run = ctx.store.getRun(conv.runId);
      if (run && run.status !== "queued" && run.status !== "running") {
        return fail(res, new Error(`会话已结束（${run.status}），请新建会话`), 409);
      }

      ctx.engine.addSteering(conv.runId, content);
      ctx.engine.broadcastChatMessage(conv.runId, undefined, "user", "user", content);
      ok(res, { sent: true, msgId: undefined });
    }),
  );

  /** 撤回消息（发送者可撤；标记 deleted + 实时广播 chat.deleted） */
  r.delete(
    "/:id/messages/:msgId",
    asyncH(async (req, res) => {
      const conv = ctx.store.getConversation(String(req.params.id));
      if (!conv) return fail(res, new Error("conversation not found"), 404);
      if (!canAccessConv(conv, req.user?.id)) return fail(res, new Error("无权限访问该会话"), 403);
      const msgId = String(req.params.msgId);
      const shared = isUserConv(conv) || conv.type === "group";
      const all = shared
        ? ctx.store.listChatMessages(conv.runId)
        : ctx.store.listChatMessages(conv.runId, req.user?.id);
      const msg = all.find((m) => m.id === msgId);
      if (!msg) return fail(res, new Error("消息不存在"), 404);
      if (msg.deleted) return ok(res, { recalled: msgId });
      // 仅发送者可撤回自己的消息（用户消息 agentId = 发送者 id 或 "user"）
      const mine = msg.agentId === req.user?.id || msg.agentId === "user";
      if (!mine) return fail(res, new Error("只能撤回自己发送的消息"), 403);
      ctx.store.deleteChatMessage(msgId);
      // 实时广播撤回事件（用户-用户：推参与者；agent 会话：run 订阅者）
      const recipients = new Set<string>([conv.userId, ...conv.participantIds].filter((x): x is string => !!x));
      if (isUserConv(conv)) {
        for (const pid of recipients) {
          ctx.hub.sendToUser(pid, { type: "chat.deleted", msgId }, conv.runId);
        }
      } else {
        ctx.hub.broadcast(conv.runId, 0, { type: "chat.deleted", msgId });
      }
      ok(res, { recalled: msgId });
    }),
  );

  /** 标记已读（清零当前用户未读；agent 会话清共享计数） */
  r.post(
    "/:id/read",
    asyncH(async (req, res) => {
      const conv = ctx.store.getConversation(String(req.params.id));
      if (!conv) return fail(res, new Error("conversation not found"), 404);
      if (!canAccessConv(conv, req.user?.id)) return fail(res, new Error("无权限访问该会话"), 403);
      ctx.store.markRead(conv.id, isUserConv(conv) ? req.user?.id : undefined);
      // 已读回执：广播给其他参与者（对方实时看到我读了；readTs 即本次 markRead 时刻）
      if (isUserConv(conv) && req.user?.id) {
        const readTs = new Date().toISOString();
        const recipients = new Set<string>([conv.userId, ...conv.participantIds].filter((x): x is string => !!x));
        for (const pid of recipients) {
          if (pid === req.user.id) continue;
          ctx.hub.sendToUser(pid, { type: "chat.read", userId: req.user.id, readTs }, conv.runId);
        }
      }
      ok(res, { read: true });
    }),
  );

  /** 归档 / 恢复会话 */
  r.post(
    "/:id/archive",
    asyncH(async (req, res) => {
      const conv = ctx.store.getConversation(String(req.params.id));
      if (!conv) return fail(res, new Error("conversation not found"), 404);
      if (!canAccessConv(conv, req.user?.id)) return fail(res, new Error("无权限访问该会话"), 403);
      const archived = (req.body as { archived?: boolean })?.archived !== false;
      ctx.store.setConversationArchived(conv.id, archived);
      ok(res, { archived });
    }),
  );

  /** 静音 / 取消静音 */
  r.post(
    "/:id/mute",
    asyncH(async (req, res) => {
      const conv = ctx.store.getConversation(String(req.params.id));
      if (!conv) return fail(res, new Error("conversation not found"), 404);
      if (!canAccessConv(conv, req.user?.id)) return fail(res, new Error("无权限访问该会话"), 403);
      const muted = (req.body as { muted?: boolean })?.muted !== false;
      ctx.store.setConversationMuted(conv.id, muted);
      ok(res, { muted });
    }),
  );

  /** 置顶 / 取消置顶 */
  r.post(
    "/:id/pin",
    asyncH(async (req, res) => {
      const conv = ctx.store.getConversation(String(req.params.id));
      if (!conv) return fail(res, new Error("conversation not found"), 404);
      if (!canAccessConv(conv, req.user?.id)) return fail(res, new Error("无权限访问该会话"), 403);
      const pinned = (req.body as { pinned?: boolean })?.pinned !== false;
      ctx.store.setConversationPinned(conv.id, pinned);
      ok(res, { pinned });
    }),
  );

  /** 修改群信息（群名 / 成员列表 / 群公告 / 群禁言） */
  r.patch(
    "/:id",
    asyncH(async (req, res) => {
      const conv = ctx.store.getConversation(String(req.params.id));
      if (!conv) return fail(res, new Error("conversation not found"), 404);
      if (!canAccessConv(conv, req.user?.id)) return fail(res, new Error("无权限访问该会话"), 403);
      if (conv.runId.startsWith("conv_")) return fail(res, new Error("用户会话不支持修改"), 400);
      const body = (req.body ?? {}) as { title?: string; participantIds?: string[]; announcement?: string; groupMuted?: boolean; groupAdmins?: string[] };
      if (body.title !== undefined) {
        ctx.store.updateConversationTitle(conv.id, body.title);
      }
      if (body.participantIds !== undefined && Array.isArray(body.participantIds)) {
        ctx.store.updateConversationParticipants(conv.id, body.participantIds);
      }
      if (body.announcement !== undefined) {
        ctx.store.updateConversationAnnouncement(conv.id, body.announcement);
      }
      if (body.groupMuted !== undefined) {
        ctx.store.setConversationGroupMuted(conv.id, body.groupMuted);
      }
      if (body.groupAdmins !== undefined && Array.isArray(body.groupAdmins)) {
        ctx.store.setConversationGroupAdmins(conv.id, body.groupAdmins);
      }
      // 广播群变更事件（群成员实时看到更新）
      const updated = ctx.store.getConversation(conv.id);
      if (updated) {
        const changeMsg = body.title !== undefined ? `群名已改为「${body.title}」`
          : body.announcement !== undefined ? "群公告已更新"
          : body.groupMuted !== undefined ? (body.groupMuted ? "群已开启全体禁言" : "群已解除禁言")
          : "群成员已变更";
        for (const pid of updated.participantIds) {
          ctx.hub.sendToUser(pid, {
            type: "chat.mention",
            convId: updated.id,
            convTitle: updated.title || "",
            senderId: "system",
            senderName: "系统通知",
            content: changeMsg,
          });
        }
      }
      ok(res, { updated: true });
    }),
  );

  /** 消息搜索：在会话内按关键词检索 */
  r.get(
    "/:id/messages/search",
    asyncH(async (req, res) => {
      const conv = ctx.store.getConversation(String(req.params.id));
      if (!conv) return fail(res, new Error("conversation not found"), 404);
      if (!canAccessConv(conv, req.user?.id)) return fail(res, new Error("无权限访问该会话"), 403);
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      if (!q) return fail(res, new Error("搜索关键词不能为空"), 400);
      const messages = ctx.store.searchChatMessages(conv.runId, q);
      ok(res, { messages, total: messages.length });
    }),
  );

  /** 删除会话 */
  r.delete(
    "/:id",
    asyncH(async (req, res) => {
      const conv = ctx.store.getConversation(String(req.params.id));
      if (!conv) return fail(res, new Error("conversation not found"), 404);
      if (!canAccessConv(conv, req.user?.id)) return fail(res, new Error("无权限访问该会话"), 403);
      ctx.store.deleteConversation(conv.id);
      ok(res, { deleted: conv.id });
    }),
  );

  return r;
}
