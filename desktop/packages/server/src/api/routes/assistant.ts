import { Router } from "express";
import type { AppContext } from "../../context";
import { asyncH, fail, ok } from "./helpers";

/** 内置产品助手 agent（Electron 壳启动时自动引导；headless 环境回退到第一个启用 agent） */
const ASSISTANT_AGENT_ID = "builtin-assistant";
const MAX_MESSAGE_LEN = 8000;
/** 一问一答等待回复上限：超时后前端可凭 runId 到联系人页继续查看 */
const REPLY_TIMEOUT_MS = 60_000;

/** 解析产品助手使用的 agent：优先内置助手，否则第一个启用中的 agent */
function resolveAssistantAgent(ctx: AppContext) {
  const agents = ctx.config.listAgents();
  return (
    agents.find((a) => a.id === ASSISTANT_AGENT_ID && a.enabled) ??
    agents.find((a) => a.enabled)
  );
}

/**
 * 产品助手 API：侧边栏「产品助手」面板的一问一答。
 * chat 模式 maxRounds=1 → 单 agent 收到问题回复一次即结束。
 */
export function assistantRouter(ctx: AppContext): Router {
  const router = Router();

  // 面板打开时探测助手可用性
  router.get("/status", (_req, res) => {
    const agent = resolveAssistantAgent(ctx);
    ok(res, { available: agent !== undefined, agentId: agent?.id, agentName: agent?.name });
  });

  router.post(
    "/ask",
    asyncH(async (req, res) => {
      const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
      if (!message) return fail(res, new Error("消息不能为空"), 400);
      if (message.length > MAX_MESSAGE_LEN) {
        return fail(res, new Error(`消息过长（最多 ${MAX_MESSAGE_LEN} 字）`), 400);
      }

      const agent = resolveAssistantAgent(ctx);
      if (!agent) return fail(res, new Error("暂无可用 Agent，请先在设置中启用"), 503);

      const run = await ctx.engine.createAndExecuteTask(
        "产品助手",
        { mode: "chat", prompt: message, participantIds: [agent.id], maxRounds: 1 },
        "assistant",
      );

      const reply = await ctx.hub.waitForRun(
        run.id,
        (ev) => ev.type === "chat.message" && ev.agentId !== "user",
        REPLY_TIMEOUT_MS,
      );

      ok(res, {
        runId: run.id,
        agentId: agent.id,
        reply: reply && reply.type === "chat.message" ? reply.content : null,
        timeout: !reply,
      });
    }),
  );

  return router;
}
