import { Router } from "express";
import type { AppContext } from "../../context";
import { fail, ok } from "./helpers";

/** 应用设置路由（workspaceRoot / 确认策略 / 搜索 API / 默认 provider） */
export function settingsRouter(ctx: AppContext): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    ok(res, ctx.config.getSettings());
  });

  r.put("/", async (req, res) => {
    try {
      // Explicitly destructure only allowed fields to prevent mass-assignment / injection.
      // The appSettingsSchema will further validate, but we avoid passing arbitrary keys.
      const body = req.body ?? {};
      const patch: Record<string, unknown> = {};
      if (body.workspaceRoot !== undefined) patch.workspaceRoot = body.workspaceRoot;
      if (body.searchApi !== undefined) patch.searchApi = body.searchApi;
      if (body.codeExecutionConfirm !== undefined) patch.codeExecutionConfirm = body.codeExecutionConfirm;
      if (body.defaultProviderId !== undefined) patch.defaultProviderId = body.defaultProviderId;
      if (body.mem0 !== undefined) patch.mem0 = body.mem0;
      if (body.security !== undefined) patch.security = body.security;

      const settings = await ctx.config.saveSettings(patch);
      ok(res, settings);
    } catch (err) {
      fail(res, err);
    }
  });

  return r;
}
