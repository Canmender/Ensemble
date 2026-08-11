import { Router } from "express";
import type { AppContext } from "../../context";
import { asyncH, fail, ok } from "./helpers";

/**
 * 直接对话 API —— IM 风格的单轮对话
 *
 * POST /api/chat
 * - agentId: 智能体 ID
 * - message: 用户消息
 * - runId?: 群聊 Run ID（用于多轮对话上下文）
 *
 * 返回智能体的回复内容
 */
export function chatRouter(ctx: AppContext): Router {
  const r = Router();

  /**
   * 单聊：直接调用智能体获取回复
   */
  r.post(
    "/",
    asyncH(async (req, res) => {
      const { agentId, message, runId } = req.body ?? {};
      if (!agentId || !message) return fail(res, new Error("agentId and message required"));

      try {
        // 如果有 runId，说明是群聊中继续对话
        if (runId) {
          const run = ctx.store.getRun(runId);
          if (!run) return fail(res, new Error("run not found"), 404);

          // 事件驱动等待 agent 回复（替代 200ms 忙等待轮询）：
          // 命中 agent 新消息（chat.message）或 run 终止（error/cancelled）即 resolve
          const waitForReply = ctx.hub.waitForRun(
            runId,
            (ev) => {
              if (ev.type === "chat.message") return ev.agentId !== "user";
              if (ev.type === "run.status") return ev.status === "error" || ev.status === "cancelled";
              return false;
            },
            60_000,
          );

          // 先注册等待，再注入用户消息，避免竞态
          ctx.engine.addSteering(runId, message);

          // 广播用户消息
          ctx.engine.broadcastChatMessage(runId, undefined, "user", "user", message);

          const ev = await waitForReply;
          if (!ev) return ok(res, { reply: "(等待回复超时)", agentId });
          if (ev.type === "chat.message") return ok(res, { reply: ev.content, agentId: ev.agentId });
          return ok(res, { reply: "(任务已终止)", agentId });
        }

        // 单聊：创建一次性 Run 获取回复
        const run = await ctx.engine.createAndExecuteTask(`单聊: ${message.slice(0, 30)}`, {
          mode: "single",
          prompt: message,
          agentIds: [agentId],
        });

        // 事件驱动等待执行完成（替代 200ms 忙等待轮询）
        await ctx.hub.waitForRun(
          run.id,
          (ev) =>
            ev.type === "run.status" &&
            (ev.status === "success" || ev.status === "error" || ev.status === "cancelled"),
          60_000,
        );

        // 获取结果
        const finalRun = ctx.store.getRun(run.id);
        const jobs = ctx.store.getJobs(run.id);
        const lastJob = jobs[jobs.length - 1];

        const reply = lastJob?.result || finalRun?.finalResult || "(无回复)";

        return ok(res, { reply, agentId, runId: run.id });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return fail(res, new Error(message));
      }
    }),
  );

  /**
   * 获取群聊历史消息
   */
  r.get(
    "/history/:runId",
    asyncH(async (req, res) => {
      const runId = String(req.params.runId);
      const run = ctx.store.getRun(runId);
      if (!run) return fail(res, new Error("run not found"), 404);

      const messages = ctx.store.listChatMessages(runId);
      ok(res, { messages, status: run.status });
    }),
  );

  /**
   * 获取群聊历史消息（移动端协议：GET /api/chat/:runId/messages）
   */
  r.get(
    "/:runId/messages",
    asyncH(async (req, res) => {
      const runId = String(req.params.runId);
      const run = ctx.store.getRun(runId);
      if (!run) return fail(res, new Error("run not found"), 404);

      const messages = ctx.store.listChatMessages(runId);
      ok(res, { messages, status: run.status });
    }),
  );

  /**
   * 群聊发送消息（fire-and-forget，回复通过 WS 实时推送）。
   * 移动端协议：POST /api/chat/:runId/messages { content }
   */
  r.post(
    "/:runId/messages",
    asyncH(async (req, res) => {
      const runId = String(req.params.runId);
      const { content } = req.body ?? {};
      const run = ctx.store.getRun(runId);
      if (!run) return fail(res, new Error("run not found"), 404);
      if (typeof content !== "string" || !content.trim()) {
        return fail(res, new Error("content required"), 400);
      }

      ctx.engine.addSteering(runId, content);
      ctx.engine.broadcastChatMessage(runId, undefined, "user", "user", content);
      ok(res, { sent: true });
    }),
  );

  return r;
}
