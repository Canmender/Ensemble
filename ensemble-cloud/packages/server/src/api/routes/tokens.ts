import { Router } from "express";
import type { AppContext } from "../../context";
import { ok } from "./helpers";

/**
 * Token 用量统计：聚合 jobs.usage_json（各 agent LLM 调用的 input/output tokens）。
 * 供「Token用量」页渲染饼图（按 agent 占比）+ 折线图（按日趋势）。
 */
export function tokensRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/stats", (_req, res) => {
    const runs = ctx.store.listRuns();
    const total = { input: 0, output: 0 };
    const byDay = new Map<string, { input: number; output: number }>();
    const byAgent = new Map<
      string,
      { agentId: string; agentName: string; input: number; output: number }
    >();

    for (const run of runs) {
      const day = (run.startedAt || "").slice(0, 10);
      for (const job of ctx.store.getJobs(run.id)) {
        const input = job.usage?.inputTokens ?? 0;
        const output = job.usage?.outputTokens ?? 0;
        if (input === 0 && output === 0) continue;

        total.input += input;
        total.output += output;

        if (day) {
          const d = byDay.get(day) ?? { input: 0, output: 0 };
          d.input += input;
          d.output += output;
          byDay.set(day, d);
        }

        const a =
          byAgent.get(job.agentId) ??
          { agentId: job.agentId, agentName: job.agentName || job.agentId, input: 0, output: 0 };
        a.input += input;
        a.output += output;
        byAgent.set(job.agentId, a);
      }
    }

    ok(res, {
      total,
      byDay: [...byDay.entries()]
        .map(([day, v]) => ({ day, ...v }))
        .sort((x, y) => x.day.localeCompare(y.day)),
      byAgent: [...byAgent.values()].sort(
        (a, b) => b.input + b.output - (a.input + a.output),
      ),
      runCount: runs.length,
    });
  });

  return router;
}
