import { Router } from "express";
import type { AppContext } from "../../context";
import { fail, ok } from "./helpers";
import type { AppSettings } from "@ensemble/shared";

/** 掩蔽 settings 中的第三方 API key（searchApi / mem0），仅返回是否已配置 */
function maskSettings(s: AppSettings): AppSettings {
  return {
    ...s,
    searchApi: s.searchApi
      ? { ...s.searchApi, apiKey: undefined, apiKeySet: !!s.searchApi.apiKey }
      : undefined,
    mem0: s.mem0
      ? { ...s.mem0, apiKey: undefined, apiKeySet: !!s.mem0.apiKey }
      : undefined,
  } as AppSettings;
}

/** 应用设置路由（workspaceRoot / 确认策略 / 搜索 API / 默认 provider） */
export function settingsRouter(ctx: AppContext): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    ok(res, maskSettings(ctx.config.getSettings()));
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
      if (body.relay !== undefined) patch.relay = body.relay;
      if (body.cloudHost !== undefined) patch.cloudHost = body.cloudHost;

      const settings = await ctx.config.saveSettings(patch);
      ok(res, maskSettings(settings));
    } catch (err) {
      fail(res, err);
    }
  });

  return r;
}
