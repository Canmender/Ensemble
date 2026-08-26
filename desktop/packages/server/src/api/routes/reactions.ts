/**
 * 消息表情回应 API（P2 平台能力）
 *
 * POST /api/reactions/:messageId { emoji } — 添加回应（每消息每用户每 emoji 唯一）
 * DELETE /api/reactions/:messageId/:emoji — 取消回应
 * GET /api/reactions/:messageId — 获取回应（emoji → userIds[]）
 */
import { Router } from "express";
import type { AppContext } from "../../context";
import { asyncH, fail, ok } from "./helpers";

export function reactionsRouter(ctx: AppContext): Router {
  const r = Router();

  /** 添加回应 */
  r.post(
    "/:messageId",
    asyncH(async (req, res) => {
      const userId = req.user?.id;
      if (!userId) return fail(res, new Error("需要登录"), 403);
      const { emoji } = req.body ?? {};
      if (typeof emoji !== "string" || !emoji || emoji.length > 10) {
        return fail(res, new Error("emoji 无效"), 400);
      }
      const ok2 = ctx.store.addReaction(String(req.params.messageId), userId, emoji);
      if (!ok2) return ok(res, { added: false }); // 已存在（幂等）
      ok(res, { added: true });
    }),
  );

  /** 取消回应 */
  r.delete(
    "/:messageId/:emoji",
    asyncH(async (req, res) => {
      const userId = req.user?.id;
      if (!userId) return fail(res, new Error("需要登录"), 403);
      const ok2 = ctx.store.removeReaction(
        String(req.params.messageId),
        userId,
        decodeURIComponent(String(req.params.emoji)),
      );
      ok(res, { removed: ok2 });
    }),
  );

  /** 获取该消息的所有回应 */
  r.get(
    "/:messageId",
    asyncH(async (req, res) => {
      const reactions = ctx.store.getReactions(String(req.params.messageId));
      ok(res, reactions);
    }),
  );

  return r;
}
