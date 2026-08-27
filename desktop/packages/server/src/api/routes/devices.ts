import { Router } from "express";
import type { AppContext } from "../../context";
import { ok, fail } from "./helpers";

/**
 * 设备列表（多端在线状态：手机端 / 电脑端）
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

  /** 注册/更新 Expo Push Token（移动端登录后调用） */
  r.post("/push-token", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("未认证"), 401);
    const { deviceId, token } = req.body ?? {};
    if (typeof deviceId !== "string" || !deviceId) return fail(res, new Error("deviceId required"), 400);
    if (typeof token !== "string" || !token) return fail(res, new Error("token required"), 400);
    // 更新设备的 push_token（设备可能尚未在 devices 表中，upsert 兜底）
    ctx.store.upsertDevice({ id: deviceId, userId, name: "", type: "mobile", pushToken: token });
    ok(res, { ok: true });
  });

  return r;
}
