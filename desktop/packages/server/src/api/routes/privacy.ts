import { Router } from "express";
import type { AppContext } from "../../context";
import { asyncH, fail, ok } from "./helpers";
import { newId } from "../../util/id";

/**
 * 用户隐私设置 + 好友审核路由：
 * - PATCH /api/privacy：更新隐私设置
 * - GET /api/privacy：获取隐私设置
 * - POST /api/friend-request：发送好友请求
 * - GET /api/friend-requests：获取好友请求列表
 * - POST /api/friend-requests/:id/accept：接受好友请求
 * - POST /api/friend-requests/:id/reject：拒绝好友请求
 */
export function privacyRouter(ctx: AppContext): Router {
  const r = Router();

  /** 获取隐私设置 */
  r.get("/", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("未认证"), 401);
    try {
      const row = ctx.db.prepare("SELECT * FROM privacy_settings WHERE user_id = ?").get(userId) as any;
      if (!row) {
        ok(res, {
          allowAddFriend: true,
          requireFriendApproval: false,
          allowPrivateChat: true,
          voiceReminder: true,
          showPhone: false,
          showEmail: false,
        });
        return;
      }
      ok(res, {
        allowAddFriend: !!row.allow_add_friend,
        requireFriendApproval: !!row.require_friend_approval,
        allowPrivateChat: !!row.allow_private_chat,
        voiceReminder: !!row.voice_reminder,
        showPhone: !!row.show_phone,
        showEmail: !!row.show_email,
      });
    } catch {
      // 表不存在时返回默认值
      ok(res, {
        allowAddFriend: true,
        requireFriendApproval: false,
        allowPrivateChat: true,
        voiceReminder: true,
        showPhone: false,
        showEmail: false,
      });
    }
  });

  /** 更新隐私设置 */
  r.patch("/", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("未认证"), 401);
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      // 确保表存在
      ctx.db.exec(`CREATE TABLE IF NOT EXISTS privacy_settings (
        user_id TEXT PRIMARY KEY,
        allow_add_friend INTEGER NOT NULL DEFAULT 1,
        require_friend_approval INTEGER NOT NULL DEFAULT 0,
        allow_private_chat INTEGER NOT NULL DEFAULT 1,
        voice_reminder INTEGER NOT NULL DEFAULT 1,
        show_phone INTEGER NOT NULL DEFAULT 0,
        show_email INTEGER NOT NULL DEFAULT 0
      )`);
      const fields: string[] = [];
      const values: any[] = [];
      const map: Record<string, string> = {
        allowAddFriend: "allow_add_friend",
        requireFriendApproval: "require_friend_approval",
        allowPrivateChat: "allow_private_chat",
        voiceReminder: "voice_reminder",
        showPhone: "show_phone",
        showEmail: "show_email",
      };
      for (const [key, col] of Object.entries(map)) {
        if (body[key] !== undefined) {
          fields.push(`${col} = ?`);
          values.push(body[key] ? 1 : 0);
        }
      }
      if (fields.length > 0) {
        values.push(userId);
        ctx.db.prepare(`INSERT INTO privacy_settings (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING`).run(userId);
        ctx.db.prepare(`UPDATE privacy_settings SET ${fields.join(", ")} WHERE user_id = ?`).run(...values);
      }
      ok(res, { updated: true });
    } catch (err) {
      fail(res, err instanceof Error ? err : new Error("更新失败"), 500);
    }
  });

  /** 发送好友请求 */
  r.post("/friend-request", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("未认证"), 401);
    const { targetId } = (req.body ?? {}) as { targetId?: string };
    if (!targetId) return fail(res, new Error("targetId required"), 400);
    if (targetId === userId) return fail(res, new Error("不能添加自己为好友"), 400);

    try {
      // 检查目标用户的隐私设置
      ctx.db.exec(`CREATE TABLE IF NOT EXISTS privacy_settings (
        user_id TEXT PRIMARY KEY,
        allow_add_friend INTEGER NOT NULL DEFAULT 1,
        require_friend_approval INTEGER NOT NULL DEFAULT 0,
        allow_private_chat INTEGER NOT NULL DEFAULT 1,
        voice_reminder INTEGER NOT NULL DEFAULT 1,
        show_phone INTEGER NOT NULL DEFAULT 0,
        show_email INTEGER NOT NULL DEFAULT 0
      )`);
      const privacy = ctx.db.prepare("SELECT allow_add_friend, require_friend_approval FROM privacy_settings WHERE user_id = ?").get(targetId) as any;
      if (privacy && !privacy.allow_add_friend) {
        return fail(res, new Error("对方不允许被添加好友"), 403);
      }

      // 检查是否已经是好友（通过会话存在判断）
      const existing = ctx.db.prepare(
        "SELECT id FROM conversations WHERE user_id = ? AND participant_ids LIKE ? AND type = 'direct'"
      ).get(userId, `%"${targetId}"%`);
      if (existing) return fail(res, new Error("已经是好友"), 409);

      // 检查是否已有待处理的请求
      ctx.db.exec(`CREATE TABLE IF NOT EXISTS friend_requests (
        id TEXT PRIMARY KEY,
        from_user TEXT NOT NULL,
        to_user TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        message TEXT,
        created_at TEXT NOT NULL
      )`);
      const pending = ctx.db.prepare(
        "SELECT id FROM friend_requests WHERE from_user = ? AND to_user = ? AND status = 'pending'"
      ).get(userId, targetId);
      if (pending) return fail(res, new Error("已发送过请求"), 409);

      const id = newId("fr");
      ctx.db.prepare(
        "INSERT INTO friend_requests (id, from_user, to_user, status, message, created_at) VALUES (?, ?, ?, 'pending', ?, ?)"
      ).run(id, userId, targetId, (req.body as any)?.message ?? null, new Date().toISOString());

      // 通知目标用户
      ctx.hub.sendToUser(targetId, {
        type: "chat.mention",
        convId: "",
        convTitle: "好友请求",
        senderId: userId,
        senderName: ctx.store.getUser(userId)?.displayName || userId,
        content: "发送了好友请求",
      });

      ok(res, { sent: true });
    } catch (err) {
      fail(res, err instanceof Error ? err : new Error("发送失败"), 500);
    }
  });

  /** 获取好友请求列表 */
  r.get("/friend-requests", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("未认证"), 401);
    try {
      ctx.db.exec(`CREATE TABLE IF NOT EXISTS friend_requests (
        id TEXT PRIMARY KEY,
        from_user TEXT NOT NULL,
        to_user TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        message TEXT,
        created_at TEXT NOT NULL
      )`);
      const rows = ctx.db.prepare(
        "SELECT * FROM friend_requests WHERE (from_user = ? OR to_user = ?) AND status = 'pending' ORDER BY created_at DESC"
      ).all(userId, userId) as any[];
      ok(res, {
        requests: rows.map((r) => {
          const from = r.from_user === userId ? r.to_user : r.from_user;
          const u = ctx.store.getUser(from);
          return {
            id: r.id,
            fromUser: r.from_user,
            toUser: r.to_user,
            direction: r.from_user === userId ? "outgoing" : "incoming",
            message: r.message,
            createdAt: r.created_at,
            peerName: u?.displayName ?? u?.username ?? from,
          };
        }),
      });
    } catch {
      ok(res, { requests: [] });
    }
  });

  /** 好友列表（已确认的好友关系：accept 过的请求双方；不含自己） */
  r.get("/friends", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("未认证"), 401);
    try {
      ctx.db.exec(`CREATE TABLE IF NOT EXISTS friend_requests (
        id TEXT PRIMARY KEY,
        from_user TEXT NOT NULL,
        to_user TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        message TEXT,
        created_at TEXT NOT NULL
      )`);
      const rows = ctx.db.prepare(
        "SELECT from_user AS a, to_user AS b FROM friend_requests WHERE status = 'accepted' AND (from_user = ? OR to_user = ?)"
      ).all(userId, userId) as Array<{ a: string; b: string }>;
      const friendIds = new Set<string>();
      for (const r of rows) {
        if (r.a === userId) friendIds.add(r.b);
        else friendIds.add(r.a);
      }
      const friends = Array.from(friendIds).map((id) => {
        const u = ctx.store.getUser(id);
        return {
          id,
          username: u?.username ?? id,
          displayName: u?.displayName,
        };
      });
      ok(res, { friends });
    } catch {
      ok(res, { friends: [] });
    }
  });

  /** 接受好友请求 */
  r.post("/friend-requests/:id/accept", asyncH(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("未认证"), 401);
    const requestId = String(req.params.id);
    const row = ctx.db.prepare("SELECT * FROM friend_requests WHERE id = ? AND to_user = ? AND status = 'pending'").get(requestId, userId) as any;
    if (!row) return fail(res, new Error("请求不存在"), 404);

    // 更新请求状态
    ctx.db.prepare("UPDATE friend_requests SET status = 'accepted' WHERE id = ?").run(requestId);

    // 自动创建会话
    const convId = newId("conv");
    const conv = {
      id: convId, userId: row.from_user, type: "direct" as const,
      title: row.from_user, participantIds: [row.from_user, row.to_user],
      runId: convId, unread: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    ctx.store.createConversation(conv);

    // 通知对方
    ctx.hub.sendToUser(row.from_user, {
      type: "chat.mention", convId, convTitle: "好友请求",
      senderId: userId, senderName: ctx.store.getUser(userId)?.displayName || userId,
      content: "接受了好友请求",
    });

    ok(res, { accepted: true, convId });
  }));

  /** 拒绝好友请求 */
  r.post("/friend-requests/:id/reject", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("未认证"), 401);
    const requestId = String(req.params.id);
    const row = ctx.db.prepare("SELECT * FROM friend_requests WHERE id = ? AND to_user = ? AND status = 'pending'").get(requestId, userId) as any;
    if (!row) return fail(res, new Error("请求不存在"), 404);
    ctx.db.prepare("UPDATE friend_requests SET status = 'rejected' WHERE id = ?").run(requestId);
    ok(res, { rejected: true });
  });

  return r;
}
