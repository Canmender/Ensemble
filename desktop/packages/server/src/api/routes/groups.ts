/**
 * 群组管理 API（P1 群组管理）
 *
 * 1. 群成员角色管理：群主（role=1）/ 管理员（role=2）/ 普通成员（role=3）
 * 2. 入群方式控制：自由加入（0）/ 需审批（1）/ 不可加入（2）
 * 3. 群版本号：每次成员/设置变更 +1（客户端增量同步基础）
 * 4. 群公告
 */
import { Router } from "express";
import type { AppContext } from "../../context";
import { asyncH, fail, ok } from "./helpers";

export function groupsRouter(ctx: AppContext): Router {
  const r = Router();

  /** 更新群入群方式（群主/管理员可调） */
  r.put(
    "/:convId/join-type",
    asyncH(async (req, res) => {
      const userId = req.user?.id;
      if (!userId) return fail(res, new Error("需要登录"), 403);
      const conv = ctx.store.getConversation(String(req.params.convId));
      if (!conv) return fail(res, new Error("会话不存在"), 404);
      const { joinType } = req.body ?? {};
      if (typeof joinType !== "number" || ![0, 1, 2].includes(joinType)) {
        return fail(res, new Error("joinType 必须是 0/1/2"), 400);
      }
      // 权限校验：群主或管理员可操作
      const me = ctx.store.getGroupMember(conv.id, userId);
      if (!me || me.role === 3) return fail(res, new Error("无权限修改入群方式"), 403);
      ctx.store.setJoinType(conv.id, joinType as 0 | 1 | 2);
      ok(res, { joinType });
    }),
  );

  /** 更新群公告（群主/管理员可调） */
  r.put(
    "/:convId/announcement",
    asyncH(async (req, res) => {
      const userId = req.user?.id;
      if (!userId) return fail(res, new Error("需要登录"), 403);
      const conv = ctx.store.getConversation(String(req.params.convId));
      if (!conv) return fail(res, new Error("会话不存在"), 404);
      const me = ctx.store.getGroupMember(conv.id, userId);
      if (!me || me.role === 3) return fail(res, new Error("无权限修改群公告"), 403);
      const { text } = req.body ?? {};
      ctx.store.setAnnouncement(conv.id, typeof text === "string" ? text : null);
      ok(res, { announcement: text ?? null });
    }),
  );

  /** 获取群成员列表 */
  r.get(
    "/:convId/members",
    asyncH(async (req, res) => {
      const conv = ctx.store.getConversation(String(req.params.convId));
      if (!conv) return fail(res, new Error("会话不存在"), 404);
      const members = ctx.store.listGroupMembers(conv.id);
      ok(res, members);
    }),
  );

  /** 设置成员角色（群主操作；不能操作同级） */
  r.put(
    "/:convId/members/:userId/role",
    asyncH(async (req, res) => {
      const operUserId = req.user?.id;
      if (!operUserId) return fail(res, new Error("需要登录"), 403);
      const conv = ctx.store.getConversation(String(req.params.convId));
      if (!conv) return fail(res, new Error("会话不存在"), 404);
      const { role } = req.body ?? {};
      if (typeof role !== "number" || ![1, 2, 3].includes(role)) {
        return fail(res, new Error("role 必须是 1/2/3"), 400);
      }
      const operMe = ctx.store.getGroupMember(conv.id, operUserId);
      const target = ctx.store.getGroupMember(conv.id, String(req.params.userId));
      if (!operMe || !target) return fail(res, new Error("操作者或目标不在群内"), 400);
      // 权限规则：群主可设所有人；管理员只能设普通成员
      if (operMe.role === 2 && (role === 1 || target.role === 1 || target.role === 2)) {
        return fail(res, new Error("管理员不能操作群主或同级管理员"), 403);
      }
      if (operMe.role === 3) {
        return fail(res, new Error("普通成员无权操作"), 403);
      }
      ctx.store.setGroupMemberRole(conv.id, String(req.params.userId), role as 1 | 2 | 3);
      ok(res, { role });
    }),
  );

  /** 踢人（群主/管理员操作；目标角色必须低于操作者） */
  r.post(
    "/:convId/members/:userId/kick",
    asyncH(async (req, res) => {
      const operUserId = req.user?.id;
      if (!operUserId) return fail(res, new Error("需要登录"), 403);
      const conv = ctx.store.getConversation(String(req.params.convId));
      if (!conv) return fail(res, new Error("会话不存在"), 404);
      const targetId = String(req.params.userId);
      if (targetId === operUserId) return fail(res, new Error("不能踢自己"), 400);
      const operMe = ctx.store.getGroupMember(conv.id, operUserId);
      const target = ctx.store.getGroupMember(conv.id, targetId);
      if (!operMe || !target) return fail(res, new Error("操作者或目标不在群内"), 400);
      if (operMe.role === 3) return fail(res, new Error("普通成员无权操作"), 403);
      // 管理员不能踢同级以上
      if (operMe.role === 2 && target.role <= 2) {
        return fail(res, new Error("管理员只能踢普通成员"), 403);
      }
      ctx.store.removeGroupMember(conv.id, targetId, 3);
      ok(res, { kicked: targetId });
    }),
  );

  return r;
}

/**
 * 用户搜索 API（P1）
 * GET /api/users/search?q=关键词&limit=20
 * 按 username/display_name 模糊搜索，排除禁用用户（status 字段）
 */
export function userSearchRouter(ctx: AppContext): Router {
  const r = Router();
  r.get(
    "/search",
    asyncH(async (req, res) => {
      const q = String(req.query.q ?? "").trim();
      if (!q) return fail(res, new Error("q 参数必填"), 400);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
      const users = ctx.store.searchUsers(q, limit);
      ok(res, users.map((u) => ({ id: u.id, username: u.username, displayName: u.displayName })));
    }),
  );
  return r;
}
