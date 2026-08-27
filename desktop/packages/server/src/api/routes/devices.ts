import { Router } from "express";
import type { AppContext } from "../../context";
import { ok, fail } from "./helpers";

/**
 * 设备列表（多端在线状态：手机端 / 电脑端）+ 推送 token 注册
 * 设备在 WS 连接时注册（见 hub onDeviceStatus），在线状态由 hub 实时判定。
 */
export function devicesRouter(ctx: AppContext): Router {
  const r = Router();

  r.get("/", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("未认证"), 401);
    const online = ctx.hub.getOnlineDeviceIds(userId);
    ok(res, ctx.store.listDevices(userId).map((d) => ({ ...d, online: online.has(d.id) })));
  });

  /** 注册/更新设备推送 token（expo push token / FCM token） */
  r.post("/push-token", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("未认证"), 401);
    const { deviceId, token, platform } = req.body ?? {};
    if (!deviceId || !token) return fail(res, new Error("deviceId 和 token 必填"), 400);
    // upsert device row with push_token
    ctx.db
      .prepare(
        `INSERT INTO devices (id, user_id, name, type, push_token, created_at)
         VALUES (?, ?, '', 'mobile', ?, ?)
         ON CONFLICT(id) DO UPDATE SET push_token = excluded.push_token, last_seen_at = ?`,
      )
      .run(deviceId, userId, String(token), new Date().toISOString(), new Date().toISOString());
    ok(res, { registered: true });
  });

  return r;
}
