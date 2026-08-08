import { Router } from "express";
import type { AppContext } from "../../context";
import { fail, ok } from "./helpers";

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

  r.post("/", (req, res) => {
    try {
      const def = ctx.config.saveWorkflow(req.body);
      ok(res, def, 201);
    } catch (err) {
      fail(res, err);
    }
  });

  r.delete("/:id", (req, res) => {
    ctx.config.deleteWorkflow(req.params.id);
    ok(res, { deleted: req.params.id });
  });

  return r;
}
