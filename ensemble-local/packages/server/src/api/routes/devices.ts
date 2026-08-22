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

  return r;
}
