import { Router } from "express";
import type { AppContext } from "../../context";
import { ok } from "./helpers";

export function healthRouter(ctx: AppContext): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    const agents = ctx.config.listAgents().map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      enabled: a.enabled,
      registered: ctx.registry.has(a.id),
    }));
    ok(res, {
      status: "ok",
      time: new Date().toISOString(),
      agents,
      workflows: ctx.config.listWorkflows().length,
      providers: ctx.config.listProviders().length,
      tools: ctx.toolRegistry.names(),
      configErrors: ctx.config.errors,
    });
  });

  return r;
}
