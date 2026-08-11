import { Router } from "express";
import type { AppContext } from "../../context";
import { asyncH, fail, ok } from "./helpers";

export function providersRouter(ctx: AppContext): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    ok(res, ctx.config.listProviders());
  });

  r.get("/:id", (req, res) => {
    const cfg = ctx.config.getProvider(String(req.params.id));
    if (!cfg) return fail(res, new Error(`provider not found: ${String(req.params.id)}`), 404);
    ok(res, cfg);
  });

  r.post("/", async (req, res) => {
    try {
      const body = req.body ?? {};
      const created = await ctx.config.createProvider(body);
      if (body.apiKey) ctx.keyStore.set(created.id, body.apiKey);
      ctx.reloadProviders();
      ok(res, created, 201);
    } catch (err) {
      fail(res, err);
    }
  });

  r.put("/:id", async (req, res) => {
    try {
      const id = String(req.params.id);
      const updated = await ctx.config.updateProvider(id, req.body ?? {});
      if (req.body?.apiKey) ctx.keyStore.set(id, req.body.apiKey);
      ctx.reloadProviders();
      ok(res, updated);
    } catch (err) {
      fail(res, err);
    }
  });

  r.delete("/:id", async (req, res) => {
    await ctx.config.deleteProvider(String(req.params.id));
    ctx.keyStore.delete(String(req.params.id));
    ctx.reloadProviders();
    ok(res, { deleted: String(req.params.id) });
  });

  /** 测试连接（main 进程内带 key 真实调用） */
  r.post(
    "/:id/test",
    asyncH(async (req, res) => {
      const id = String(req.params.id);
      if (!ctx.providerRegistry.has(id)) {
        return fail(res, new Error(`provider not enabled: ${id}`), 400);
      }
      const provider = ctx.providerRegistry.get(id);
      const result = await provider.testConnection();
      ok(res, result);
    }),
  );

  /** 拉取可用模型列表 */
  r.get(
    "/:id/models",
    asyncH(async (req, res) => {
      const id = String(req.params.id);
      if (!ctx.providerRegistry.has(id)) {
        return fail(res, new Error(`provider not enabled: ${id}`), 400);
      }
      const models = await ctx.providerRegistry.get(id).listModels();
      ok(res, { models });
    }),
  );

  return r;
}
