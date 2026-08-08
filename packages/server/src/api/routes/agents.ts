import { Router } from "express";
import type { AppContext } from "../../context";
import { asyncH, fail, ok } from "./helpers";

/** Agent 记忆端点（两级记忆：snapshot / consolidate / clear） */
function memoryRoutes(ctx: AppContext, r: Router): void {
  r.get("/:id/memory", asyncH(async (req, res) => {
    if (!/^[a-z0-9-]+$/.test(req.params.id)) return fail(res, new Error("invalid agent id"), 400);
    const snap = await ctx.memoryProvider.snapshot(req.params.id);
    ok(res, snap);
  }));

  r.post("/:id/memory/consolidate", asyncH(async (req, res) => {
    if (!/^[a-z0-9-]+$/.test(req.params.id)) return fail(res, new Error("invalid agent id"), 400);
    await ctx.memoryProvider.consolidate(req.params.id);
    ok(res, { ok: true });
  }));

  r.delete("/:id/memory", (req, res) => {
    if (!/^[a-z0-9-]+$/.test(req.params.id)) return fail(res, new Error("invalid agent id"), 400);
    ctx.memoryProvider.clear(req.params.id);
    ok(res, { deleted: true });
  });
}

export function agentsRouter(ctx: AppContext): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    ok(res, ctx.config.listAgents());
  });

  r.get("/:id", (req, res) => {
    const cfg = ctx.config.getAgent(req.params.id);
    if (!cfg) return fail(res, new Error(`agent not found: ${req.params.id}`), 404);
    ok(res, cfg);
  });

  r.post("/", (req, res) => {
    try {
      const cfg = ctx.config.createAgent(req.body);
      ctx.reloadAgents();
      ok(res, cfg, 201);
    } catch (err) {
      fail(res, err);
    }
  });

  r.put("/:id", (req, res) => {
    try {
      const cfg = ctx.config.updateAgent(req.params.id, req.body);
      ctx.reloadAgents();
      ok(res, cfg);
    } catch (err) {
      fail(res, err);
    }
  });

  r.delete("/:id", (req, res) => {
    ctx.config.deleteAgent(req.params.id);
    ctx.reloadAgents();
    ok(res, { deleted: req.params.id });
  });

  /** 冒烟测试：跑一句 prompt，返回事件流（不落库） */
  r.post(
    "/:id/test",
    asyncH(async (req, res) => {
      const id = req.params.id;
      const cfg = ctx.config.getAgent(id);
      if (!cfg) return fail(res, new Error(`agent not found: ${id}`), 404);
      if (!ctx.registry.has(id)) return fail(res, new Error(`agent not enabled: ${id}`));

      const adapter = ctx.registry.get(id);
      const prompt = req.body?.prompt ?? "Reply with exactly: OK";
      const events = [];
      for await (const ev of adapter.startTask({ prompt, timeoutMs: 120_000 })) {
        events.push(ev);
        if (ev.type === "done") break;
      }
      ok(res, { agentId: id, events });
    }),
  );

  memoryRoutes(ctx, r);
  return r;
}
