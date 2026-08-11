import { Router } from "express";
import type { AppContext } from "../../context";
import { ok } from "./helpers";
import { hostname } from "node:os";

/**
 * 健康检查（公开探活端点）。
 * 仅返回状态与数量统计，不暴露 agent/tools 详情或本地路径（防指纹侦察）。
 */
export function healthRouter(ctx: AppContext): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    ok(res, {
      status: "ok",
      time: new Date().toISOString(),
      // 供移动端直连识别（与 mDNS 发布的 deviceId 一致）
      deviceId: `desktop-${hostname().replace(/[^a-zA-Z0-9]/g, "-")}`,
      agents: ctx.config.listAgents().length,
      workflows: ctx.config.listWorkflows().length,
      providers: ctx.config.listProviders().length,
    });
  });

  return r;
}
