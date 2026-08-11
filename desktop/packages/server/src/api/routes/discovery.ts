import { Router } from "express";
import type { AppContext } from "../../context";
import { detectAgents } from "../../discovery/detect";
import { syncAgent } from "../../discovery/sync";
import { INSTALLERS, installHarness } from "../../discovery/install";
import { asyncH, fail, ok } from "./helpers";

/** 本地 agent 发现、安装与同步 */
export function discoveryRouter(ctx: AppContext): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    ok(res, detectAgents());
  });

  r.get("/installers", (_req, res) => {
    ok(
      res,
      Object.values(INSTALLERS).map((i) => ({ type: i.type, name: i.name, autoInstallable: i.autoInstallable })),
    );
  });

  r.post(
    "/:type/sync",
    asyncH(async (req, res) => {
      const type = String(req.params.type);
      const agent = detectAgents(true).find((a) => a.type === type);
      if (!agent) return fail(res, new Error(`local agent not found: ${type}`), 404);

      const result = await syncAgent(agent, {
        skillStore: ctx.skillStore,
        memoryProvider: ctx.memoryProvider,
        configManager: ctx.config,
      });
      ctx.reloadAgents();
      ok(res, result);
    }),
  );

  /** 自动安装缺失的 agent harness（仅 INSTALLERS 白名单内的类型） */
  r.post(
    "/:type/install",
    asyncH(async (req, res) => {
      const type = String(req.params.type);
      const inst = INSTALLERS[type];
      if (!inst) return fail(res, new Error(`unknown harness: ${type}`), 400);

      const result = await installHarness(type);
      if (!result.ok) return fail(res, new Error(result.error ?? "install failed"), 500);

      // 安装成功：强制刷新检测；若检测到，同步创建 agent 配置并启用
      const agent = detectAgents(true).find((a) => a.type === type) ?? null;
      if (agent) {
        await syncAgent(agent, {
          skillStore: ctx.skillStore,
          memoryProvider: ctx.memoryProvider,
          configManager: ctx.config,
        });
        ctx.reloadAgents();
      }
      ok(res, { installed: type, detected: agent });
    }),
  );

  return r;
}

