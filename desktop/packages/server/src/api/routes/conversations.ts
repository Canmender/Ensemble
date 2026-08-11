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
    ok(res, ctx.store.listConversations(req.user?.id));
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
      if (participantIds.length === 0) return fail(res, new Error("participantIds 至少一个 agent"), 400);
      if (type === "direct" && participantIds.length !== 1) {
        return fail(res, new Error("direct 会话需要一个 agent"), 400);
      }

      const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : type === "direct" ? participantIds[0] : "群聊";
      const prompt = body.prompt ?? `会话「${title}」已创建，请开始。`;

      // 创建 chat 模式 run（direct = 1 个 participant，长期持续；group = 多 agent 轮转）
      const run = await ctx.engine.createAndExecuteTask(
        title,
        { mode: "chat", prompt, participantIds, maxRounds: 50 },
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

      const before = typeof req.query.before === "string" ? req.query.before : undefined;
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);

      const all = ctx.store.listChatMessages(conv.runId, req.user?.id);
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

      // 会话关联 run 已结束 → 拒绝"只进不出"
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
