/**
 * 设备配对 API（L2，《手机桌面互联方案》P1）。
 *
 * 流程：桌面端 POST /code 生成 6 位数字码（5 分钟有效，含一次性公钥指纹）
 * → 手机端输/扫码后经 relay 完成挑战应答（relay 侧改造，移动会话并行）
 * → 手机端持用户 token POST /confirm 提交 { code, mobileDeviceId } → device_pairs 落库
 * → 后续互联信令带 pairId。
 */
import { Router } from "express";
import { randomInt, randomBytes, createHash } from "node:crypto";
import type { AppContext } from "../../context";
import { fail, ok } from "./helpers";

const CODE_TTL_MS = 5 * 60_000;

export function pairsRouter(ctx: AppContext): Router {
  const r = Router();

  /** 桌面端生成配对码（登录用户；desktopDeviceId 由请求体带） */
  r.post("/code", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("需要用户身份"), 403);
    const desktopDeviceId = String(req.body?.desktopDeviceId ?? "").trim();
    if (!desktopDeviceId) return fail(res, new Error("desktopDeviceId required"), 400);
    // 可选公钥指纹（E2EE 预留）：客户端传公钥，服务端只存哈希
    let fingerprint: string | undefined;
    if (typeof req.body?.publicKey === "string" && req.body.publicKey.length <= 512) {
      fingerprint = createHash("sha256").update(req.body.publicKey).digest("hex").slice(0, 16);
    }
    // 6 位数字码；碰撞则重试（10^6 空间 + 过期清理，重试几次足够）
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      try {
        ctx.db
          .prepare("INSERT INTO pair_codes (code, user_id, desktop_device_id, public_key_fingerprint, expires_at) VALUES (?, ?, ?, ?, ?)")
          .run(code, userId, desktopDeviceId, fingerprint ?? null, Date.now() + CODE_TTL_MS);
        return ok(res, {
          code,
          desktopDeviceId,
          publicKeyFingerprint: fingerprint,
          expiresAt: Date.now() + CODE_TTL_MS,
        } satisfies import("@ensemble/shared").PairCodeInfo);
      } catch {
        /* code 撞唯一键 → 重试 */
      }
    }
    fail(res, new Error("配对码生成失败，请重试"), 500);
  });

  /** 手机端确认配对（输码后提交；幂等——同设备对重复确认返回已有 pairId） */
  r.post("/confirm", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("需要用户身份"), 403);
    const code = String(req.body?.code ?? "").trim();
    const mobileDeviceId = String(req.body?.mobileDeviceId ?? "").trim();
    if (!/^\d{6}$/.test(code)) return fail(res, new Error("配对码须为 6 位数字"), 400);
    if (!mobileDeviceId) return fail(res, new Error("mobileDeviceId required"), 400);

    // 清过期（惰性）
    ctx.db.prepare("DELETE FROM pair_codes WHERE expires_at < ?").run(Date.now());
    const row = ctx.db
      .prepare("SELECT user_id, desktop_device_id FROM pair_codes WHERE code = ?")
      .get(code) as { user_id: string; desktop_device_id: string } | undefined;
    if (!row) return fail(res, new Error("配对码无效或已过期"), 404);
    if (row.user_id !== userId) return fail(res, new Error("配对码不属于当前账号"), 403);

    // 幂等：同对已存在直接返回
    const existing = ctx.db
      .prepare("SELECT id FROM device_pairs WHERE user_id = ? AND desktop_device_id = ? AND mobile_device_id = ?")
      .get(userId, row.desktop_device_id, mobileDeviceId) as { id: string } | undefined;
    if (existing) {
      ctx.db.prepare("DELETE FROM pair_codes WHERE code = ?").run(code); // 消费掉
      return ok(res, { pairId: existing.id });
    }

    const pairId = `pair_${randomBytes(8).toString("hex")}`;
    ctx.db
      .prepare("INSERT INTO device_pairs (id, user_id, desktop_device_id, mobile_device_id, paired_at) VALUES (?, ?, ?, ?, ?)")
      .run(pairId, userId, row.desktop_device_id, mobileDeviceId, Date.now());
    ctx.db.prepare("DELETE FROM pair_codes WHERE code = ?").run(code); // 一次性消费
    ok(res, { pairId });
  });

  /** 我的全部设备对 */
  r.get("/", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("需要用户身份"), 403);
    const rows = ctx.db
      .prepare("SELECT id, user_id, desktop_device_id, mobile_device_id, paired_at FROM device_pairs WHERE user_id = ? ORDER BY paired_at DESC")
      .all(userId) as Array<{ id: string; user_id: string; desktop_device_id: string; mobile_device_id: string; paired_at: number }>;
    ok(res, rows);
  });

  /**
   * 补拉（L1）：回放该设备对 sinceTs 之后的互联事件（sync.request 的 REST 形态；
   * WS 信令形态由 relay 链路消费同一 DeviceLinkLog）。须为已配对设备对。
   */
  r.get("/:pairId/events", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("需要用户身份"), 403);
    const pairId = String(req.params.pairId);
    const pair = ctx.db
      .prepare("SELECT id FROM device_pairs WHERE id = ? AND user_id = ?")
      .get(pairId, userId);
    if (!pair) return fail(res, new Error("设备对不存在"), 404);
    const sinceTs = Number(req.query.sinceTs ?? 0) || 0;
    ok(res, ctx.deviceLinkLog.replay(pairId, sinceTs));
  });

  /** 解除配对 */
  r.delete("/:pairId", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("需要用户身份"), 403);
    const info = ctx.db
      .prepare("DELETE FROM device_pairs WHERE id = ? AND user_id = ?")
      .run(String(req.params.pairId), userId);
    if (info.changes === 0) return fail(res, new Error("设备对不存在"), 404);
    ok(res, { removed: true });
  });

  return r;
}
