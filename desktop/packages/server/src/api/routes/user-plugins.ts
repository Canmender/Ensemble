/**
 * per-user 插件管理 API（R4-C，用户主权模型：插件是用户资产）。
 * 挂在 apiAuth 之后（req.user 必有）；候选集是服务器本地 plugins/ 的管理员预置集，
 * 用户做的是 enable/disable + 配置（市场自助安装属 U5 基建）。
 */
import { Router } from "express";
import type { AppContext } from "../../context";
import { fail, ok } from "./helpers";

export function userPluginsRouter(ctx: AppContext): Router {
  const r = Router();

  // 全部：我的插件列表（候选集全量 + 我的启用/配置状态投影）
  r.get("/", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("需要用户身份"), 403);
    const enabled = new Map(ctx.userPlugins.listForUser(userId).map((p) => [p.id, p]));
    const list = ctx.userPlugins.listCandidates().map((m) => ({
      id: m.id,
      name: m.name,
      version: m.version,
      description: m.description,
      scheduled: m.scheduled,
      enabled: enabled.get(m.id)?.enabled ?? false,
      hasConfig: enabled.get(m.id)?.hasConfig ?? false,
    }));
    ok(res, list);
  });

  /** 启用（= 在该用户作用域 mount 实例） */
  r.post("/:id/enable", async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("需要用户身份"), 403);
    const result = await ctx.userPlugins.enable(userId, String(req.params.id));
    if (!result.ok) return fail(res, new Error(result.error ?? "启用失败"), 400);
    ok(res, { enabled: true });
  });

  /** 禁用（= unmount 该用户命名空间实例，其他用户零感知） */
  r.post("/:id/disable", async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("需要用户身份"), 403);
    await ctx.userPlugins.disable(userId, String(req.params.id));
    ok(res, { enabled: false });
  });

  /** 更新用户级配置并热重启实例 */
  r.put("/:id/config", async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("需要用户身份"), 403);
    const body = (req.body ?? {}) as { config?: unknown };
    const applied = await ctx.userPlugins.setConfig(userId, String(req.params.id), body.config ?? {});
    if (!applied) return fail(res, new Error("配置应用失败"), 400);
    ok(res, { applied: true });
  });

  /** 读当前配置 */
  r.get("/:id/config", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("需要用户身份"), 403);
    ok(res, ctx.userPlugins.getUserConfig(userId, String(req.params.id)));
  });

  /**
   * 插件卡片动作端点（U1）：POST /api/users/me/plugins/:id/actions/:action
   * 宿主级 plugin-actions 表由插件实例经 ctx.provide 注册；此处按 (用户, 插件) 分发。
   * 响应约定：插件返回 { card } 时附带广播责任已在插件内完成（经 events 总线），
   * 本端点只透传结果给点击方做原位刷新。
   */
  r.post("/:id/actions/:action", async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("需要用户身份"), 403);
    const pluginId = String(req.params.id);
    const action = String(req.params.action);
    // 实例未启用时其动作处理器不存在 → 拒绝（清单即权限的运行时体现）。
    // 键含 userId：同名插件各用户的实例各自注册自己的闭包，互不覆盖。
    const table = ctx.pluginHost.tryGet<Map<string, (b: unknown) => unknown>>("plugin-actions");
    if (!table) return fail(res, new Error("插件未运行"), 400);
    const fn = table.get(`user/${userId}/${pluginId}/${action}`);
    if (!fn) return fail(res, new Error(`未知动作: ${action}`), 404);
    try {
      ok(res, await fn(req.body ?? {}));
    } catch (e) {
      fail(res, e, 400);
    }
  });

  return r;
}
