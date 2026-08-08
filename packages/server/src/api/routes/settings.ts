import { Router } from "express";
import type { AppContext } from "../../context";
import { fail, ok } from "./helpers";

/** 应用设置路由（workspaceRoot / 确认策略 / 搜索 API / 默认 provider） */
export function settingsRouter(ctx: AppContext): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    ok(res, ctx.config.getSettings());
  });

  r.put("/", (req, res) => {
    try {
      const settings = ctx.config.saveSettings(req.body ?? {});
      ok(res, settings);
    } catch (err) {
      fail(res, err);
    }
  });

  return r;
}
