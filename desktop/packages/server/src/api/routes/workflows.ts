import { Router } from "express";
import type { AppContext } from "../../context";
import { asyncH, fail, ok } from "./helpers";

export function workflowsRouter(ctx: AppContext): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    ok(res, ctx.config.listWorkflows());
  });

  r.get("/:id", (req, res) => {
    const def = ctx.config.getWorkflow(req.params.id);
    if (!def) return fail(res, new Error(`workflow not found: ${req.params.id}`), 404);
    ok(res, def);
  });

  r.post("/", async (req, res) => {
    try {
      const def = await ctx.config.saveWorkflow(req.body);
      ok(res, def, 201);
    } catch (err) {
      fail(res, err);
    }
  });

  r.delete("/:id", async (req, res) => {
    await ctx.config.deleteWorkflow(req.params.id);
    ok(res, { deleted: req.params.id });
  });

  r.post(
    "/:id/run",
    asyncH(async (req, res) => {
      const def = ctx.config.getWorkflow(req.params.id);
      if (!def) return fail(res, new Error(`workflow not found: ${req.params.id}`), 404);

      const { prompt } = (req.body ?? {}) as { prompt?: string };
      if (!prompt) return fail(res, new Error("prompt is required"), 400);

      const run = await ctx.engine.createAndExecuteTask(
        `Run workflow: ${def.name ?? def.id}`,
        { mode: "workflow", workflowId: def.id, prompt },
        req.user?.id,
      );
      ok(res, run, 201);
    }),
  );

  return r;
}
