import { Router } from "express";
import type { AppContext } from "../../context";
import { asyncH, fail, ok } from "./helpers";

const now = () => new Date().toISOString();

export function mcpRouter(ctx: AppContext): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    const status = ctx.mcpManager.status();
    const configs = ctx.mcpConfig.list().map((c) => ({
      ...c,
      status: status.find((s) => s.id === c.id),
    }));
    ok(res, configs);
  });

  r.post(
    "/",
    asyncH(async (req, res) => {
      const body = req.body ?? {};
      if (!body.id || !body.name) return fail(res, new Error("id and name required"));
      if (ctx.mcpConfig.get(body.id)) return fail(res, new Error(`mcp server exists: ${body.id}`));
      const cfg = ctx.mcpConfig.save({
        id: body.id,
        name: body.name,
        enabled: body.enabled ?? true,
        transport: body.transport ?? "stdio",
        command: body.command,
        args: body.args,
        env: body.env,
        cwd: body.cwd,
        url: body.url,
        headers: body.headers,
        maxTools: body.maxTools,
        toolDescriptionCap: body.toolDescriptionCap,
        autoApprove: body.autoApprove,
        connectTimeoutMs: body.connectTimeoutMs,
        createdAt: now(),
        updatedAt: now(),
      });
      const st = cfg.enabled ? await ctx.mcpManager.connectOrRefresh(cfg) : undefined;
      ok(res, { ...cfg, status: st }, 201);
    }),
  );

  r.put(
    "/:id",
    asyncH(async (req, res) => {
      const existing = ctx.mcpConfig.get(req.params.id);
      if (!existing) return fail(res, new Error(`mcp server not found: ${req.params.id}`), 404);
      const body = req.body ?? {};
      const cfg = ctx.mcpConfig.save({
        ...existing,
        ...body,
        id: existing.id,
        updatedAt: now(),
      });
      const st = cfg.enabled ? await ctx.mcpManager.connectOrRefresh(cfg) : await ctx.mcpManager.disconnect(cfg.id).then(() => undefined);
      ok(res, { ...cfg, status: st });
    }),
  );

  r.delete(
    "/:id",
    asyncH(async (req, res) => {
      await ctx.mcpManager.disconnect(req.params.id);
      ctx.mcpConfig.delete(req.params.id);
      ok(res, { deleted: req.params.id });
    }),
  );

  r.post(
    "/:id/test",
    asyncH(async (req, res) => {
      const cfg = ctx.mcpConfig.get(req.params.id);
      if (!cfg) return fail(res, new Error(`mcp server not found: ${req.params.id}`), 404);
      const result = await ctx.mcpManager.test(cfg);
      ok(res, result);
    }),
  );

  r.post(
    "/:id/refresh",
    asyncH(async (req, res) => {
      const cfg = ctx.mcpConfig.get(req.params.id);
      if (!cfg) return fail(res, new Error(`mcp server not found: ${req.params.id}`), 404);
      const st = await ctx.mcpManager.connectOrRefresh(cfg);
      ok(res, st);
    }),
  );

  return r;
}
