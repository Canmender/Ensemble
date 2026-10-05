import { Router } from "express";
import type { AppContext } from "../../context";
import { asyncH, fail, ok } from "./helpers";

/**
 * 审计查询 API（设计见 docs/AUDIT-DESIGN.md）。
 *
 * 只读元数据：谁在什么时候批准/拒绝了哪个工具。
 * **不记录消息内容**，args 也只存摘要（sha256 + 键名列表 + 长度）。
 *
 * 鉴权：本轮**只允许查自己的记录**。不开放跨用户查询——
 * 审计的价值是「我确认过什么」而非「管理员查员工」，且组织权限体系
 * 尚未落地，此时开放跨用户查询等于用 ad-hoc 方式绕过它。
 */
export function auditRouter(ctx: AppContext): Router {
  const r = Router();

  r.get(
    "/",
    asyncH(async (req, res) => {
      const userId = req.user?.id;
      if (!userId) return fail(res, new Error("需要登录"), 403);
      const q = req.query as Record<string, string | undefined>;
      const entries = ctx.store.listAuditLog({
        userId, // 强制当前登录用户，不接受 query 传入
        runId: q.runId,
        decision: q.decision,
        from: q.from,
        to: q.to,
        limit: q.limit ? Number(q.limit) : undefined,
      });
      ok(res, entries);
    }),
  );

  return r;
}