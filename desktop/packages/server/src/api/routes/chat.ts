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

          // 通过 steer 注入用户消息
          ctx.engine.addSteering(runId, message);

          // 广播用户消息
          ctx.engine.broadcastChatMessage(runId, undefined, "user", "user", message);

          // 等待智能体回复（轮询检查新消息）
          const initialCount = ctx.store.listChatMessages(runId).length;
          const maxWait = 60000; // 最多等待 60 秒
          const startTime = Date.now();

          while (Date.now() - startTime < maxWait) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            const messages = ctx.store.listChatMessages(runId);
            if (messages.length > initialCount) {
              // 找到最新的非用户消息
              const lastMsg = messages[messages.length - 1];
              if (lastMsg.agentId !== "user") {
                return ok(res, { reply: lastMsg.content, agentId: lastMsg.agentId });
              }
            }
          }

          return ok(res, { reply: "(等待回复超时)", agentId });
        }

        // 单聊：创建一次性 Run 获取回复
        const run = await ctx.engine.createAndExecuteTask(`单聊: ${message.slice(0, 30)}`, {
          mode: "single",
          prompt: message,
          agentIds: [agentId],
        });

        // 等待执行完成
        const maxWait = 60000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const currentRun = ctx.store.getRun(run.id);
          if (currentRun?.status === "success" || currentRun?.status === "error") {
            break;
          }
        }

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
      const { runId } = req.params;
      const run = ctx.store.getRun(runId);
      if (!run) return fail(res, new Error("run not found"), 404);

      const messages = ctx.store.listChatMessages(runId);
      ok(res, { messages, status: run.status });
    }),
  );

  return r;
}
