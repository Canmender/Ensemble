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

  // POST /api/devices/push-token - 注册推送 token
  r.post("/push-token", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("未认证"), 401);

    const { deviceId, token, platform } = req.body;
    if (!deviceId || !token) {
      return fail(res, new Error("deviceId 和 token 必填"), 400);
    }

    try {
      ctx.store.upsertDevice({
        id: deviceId,
        userId,
        name: req.body.name || "",
        type: platform || "mobile",
        pushToken: token,
      });
      ok(res, { success: true });
    } catch (err) {
      fail(res, err instanceof Error ? err : new Error(String(err)));
    }
  });

  return r;
}
