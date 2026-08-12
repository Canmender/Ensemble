import { Router } from "express";
import type { AppContext } from "../../context";
import { asyncH, fail, ok } from "./helpers";
import { newId } from "../../util/id";
import type { Conversation } from "@ensemble/shared";

const now = () => new Date().toISOString();

/**
 * 企业级会话 API（conversations）：
 * - direct：用户与单个 agent 的 1:1 对话（chat run + 1 participant）
 * - group：多 agent 群聊
 * 消息沿用 chat_messages（run_id 关联），未读计数与会话元数据存 conversations 表。
 */
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
      if (userParticipants.length > 0 && agentParticipants.length > 0) {
        return fail(res, new Error("暂不支持用户与 Agent 混合会话"), 400);
      }
      if (type === "direct" && participantIds.length !== 1) {
        return fail(res, new Error("direct 会话需要一个参与者"), 400);
      }

      const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : type === "direct" ? participantIds[0] : "群聊";

      // 用户-用户会话（无 Agent 参与）：不创建 run，消息直接落库 + 定向推送
      if (userParticipants.length > 0) {
        const id = newId("conv");
        const conv: Conversation = {
          id,
          userId: req.user?.id,
          type,
          title,
          participantIds: userParticipants,
          runId: id,
          unread: 0,
          createdAt: now(),
          updatedAt: now(),
        };
        ctx.store.createConversation(conv);
        ok(res, conv, 201);
        return;
      }

      // Agent 会话：创建 chat 模式 run
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
        participantIds: agentParticipants,
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

      const before = typeof req.query.before === "string" ? req.query.before : undefined;
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);

      // 用户-用户会话（runId = conv id）：消息双方共享，不做 userId 过滤（否则对方看不到自己的消息）
      const all = conv.runId.startsWith("conv_")
        ? ctx.store.listChatMessages(conv.runId)
        : ctx.store.listChatMessages(conv.runId, req.user?.id);
      const filtered = before ? all.filter((m) => m.ts < before) : all;
      ok(res, { messages: filtered.slice(-limit), total: all.length });
    }),
  );

  /** 发送消息（fire-and-forget；agent 回复经 WS 实时推送） */
  r.post(
    "/:id/messages",
    asyncH(async (req, res) => {
      const conv = ctx.store.getConversation(String(req.params.id));
      if (!conv) return fail(res, new Error("conversation not found"), 404);
      const content = (req.body as { content?: unknown })?.content;
      if (typeof content !== "string" || !content.trim()) {
        return fail(res, new Error("content required"), 400);
      }

      // 用户-用户会话（无 run）：消息落库 + 实时推送参与者用户 + 未读
      if (conv.runId.startsWith("conv_")) {
        const senderId = req.user?.id ?? "user";
        ctx.store.createChatMessage({
          id: newId("msg"),
          runId: conv.runId,
          jobId: undefined,
          agentId: senderId,
          role: "user",
          content,
          userId: req.user?.id,
          ts: now(),
        });
        ctx.store.updateConversationMeta(conv.id, content, now());
        // 推送参与者（除发送者）+ 未读。接收者 = 归属用户 + participants（创建者不在 participants 里）
        // runId = conv.runId（conv id），客户端据此把实时消息关联到会话
        const recipients = new Set<string>([conv.userId, ...conv.participantIds].filter((x): x is string => !!x));
        for (const pid of recipients) {
          if (pid === senderId) continue;
          ctx.hub.sendToUser(pid, {
            type: "chat.message",
            jobId: "",
            agentId: senderId,
            content,
          }, conv.runId);
          ctx.store.incrementUnread(conv.id);
        }
        ok(res, { sent: true });
        return;
      }

      // Agent 会话：steering + 广播
      const run = ctx.store.getRun(conv.runId);
      if (run && run.status !== "queued" && run.status !== "running") {
        return fail(res, new Error(`会话已结束（${run.status}），请新建会话`), 409);
      }

      ctx.engine.addSteering(conv.runId, content);
      ctx.engine.broadcastChatMessage(conv.runId, undefined, "user", "user", content);
      ok(res, { sent: true });
    }),
  );

  /** 标记已读（清零未读） */
  r.post(
    "/:id/read",
    asyncH(async (req, res) => {
      const conv = ctx.store.getConversation(String(req.params.id));
      if (!conv) return fail(res, new Error("conversation not found"), 404);
      ctx.store.markRead(conv.id);
      ok(res, { read: true });
    }),
  );

  /** 归档 / 恢复会话 */
  r.post(
    "/:id/archive",
    asyncH(async (req, res) => {
      const conv = ctx.store.getConversation(String(req.params.id));
      if (!conv) return fail(res, new Error("conversation not found"), 404);
      const archived = (req.body as { archived?: boolean })?.archived !== false;
      ctx.store.setConversationArchived(conv.id, archived);
      ok(res, { archived });
    }),
  );

  /** 删除会话 */
  r.delete(
    "/:id",
    asyncH(async (req, res) => {
      const conv = ctx.store.getConversation(String(req.params.id));
      if (!conv) return fail(res, new Error("conversation not found"), 404);
      ctx.store.deleteConversation(conv.id);
      ok(res, { deleted: conv.id });
    }),
  );

  return r;
}
