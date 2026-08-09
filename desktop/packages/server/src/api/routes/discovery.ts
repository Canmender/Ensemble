import { Router } from "express";
import type { AppContext } from "../../context";
import { detectAgents } from "../../discovery/detect";
import { syncAgent } from "../../discovery/sync";
import { asyncH, fail, ok } from "./helpers";

/** 本地 agent 发现与同步 */
export function discoveryRouter(ctx: AppContext): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    ok(res, detectAgents());
  });

  r.post(
    "/:type/sync",
    asyncH(async (req, res) => {
      const type = req.params.type as "claude" | "hermes";
      const agent = detectAgents(true).find((a) => a.type === type);
      if (!agent) return fail(res, new Error(`local agent not found: ${type}`), 404);

      const result = await syncAgent(agent, {
        skillStore: ctx.skillStore,
        memoryProvider: ctx.memoryProvider,
        configManager: ctx.config,
      });
      ctx.reloadAgents();
      ok(res, result);
    }),
  );

  return r;
}
