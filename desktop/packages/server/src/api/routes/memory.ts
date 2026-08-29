import { Router } from "express";
import type { AppContext } from "../../context";
import { asyncH, ok } from "./helpers";

/** 全局记忆汇总（导航"记忆"页：列出所有 agent 的记忆） */
export function memoryRouter(ctx: AppContext): Router {
  const r = Router();

  r.get(
    "/",
    asyncH(async (_req, res) => {
      const agents = ctx.config.listAgents();
      const list: unknown[] = [];
      for (const a of agents) {
        const m = await ctx.memoryProvider.memoryForAgent(a.id);
        const hasMemory = m.file.memoryFile || m.file.dailyLogs.length > 0 || (m.sqlEntries?.length ?? 0) > 0;
        if (!hasMemory) continue;
        list.push({
          agentId: a.id,
          name: a.name,
          memory: m.file.memoryFile?.content.slice(0, 2000),
          dailyCount: m.file.dailyLogs.length,
          sqlCount: m.sqlEntries?.length ?? 0,
          sqlEntries: (m.sqlEntries ?? []).slice(0, 20),
          stats: m.file.stats,
        });
      }
      ok(res, list);
    }),
  );

  r.delete(
    "/:id",
    asyncH(async (req, res) => {
      const userId = req.user?.id;
      if (!userId) return fail(res, new Error("未认证"), 401);
      try {
        ctx.memoryPoolManager.deleteExplicit(req.params.id);
        ok(res, { success: true });
      } catch (err) {
        fail(res, err instanceof Error ? err : new Error(String(err)));
      }
    }),
  );

  return r;
}
