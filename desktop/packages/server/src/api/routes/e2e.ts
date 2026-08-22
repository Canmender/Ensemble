import { Router } from "express";
import type { AppContext } from "../../context";
import { fail, ok } from "./helpers";

/** base64 串合法性：非空、长度上限、标准字母表 */
function isB64(v: unknown, maxLen = 512): v is string {
  if (typeof v !== "string" || !v || v.length > maxLen) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(v);
}

function isPreKeyId(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 2 ** 31;
}

/**
 * E2EE 密钥目录路由（协议见 desktop/docs/E2E-PROTOCOL.md）。
 * 服务器仅存公钥材料；私钥永不经过网络。
 */
export function e2eRouter(ctx: AppContext): Router {
  const router = Router();

  // 注册/轮换身份密钥包（登录后客户端懒注册；重复注册 = 轮换）
  router.put("/register", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("需要用户身份（设备 token 不可注册密钥）"), 403);
    const b = req.body ?? {};
    if (!isB64(b.identityKey)) return fail(res, new Error("identityKey 非法"), 400);
    if (!isPreKeyId(b.signedPreKeyId)) return fail(res, new Error("signedPreKeyId 非法"), 400);
    if (!isB64(b.signedPreKey)) return fail(res, new Error("signedPreKey 非法"), 400);
    if (!isB64(b.signedPreKeySignature)) return fail(res, new Error("signedPreKeySignature 非法"), 400);
    const opks = Array.isArray(b.oneTimePreKeys) ? b.oneTimePreKeys : [];
    if (opks.length > 500) return fail(res, new Error("oneTimePreKeys 过多（上限 500）"), 400);
    for (const k of opks) {
      if (!isPreKeyId(k?.id) || !isB64(k?.key)) {
        return fail(res, new Error("oneTimePreKeys 含非法项"), 400);
      }
    }
    ctx.store.upsertE2eIdentity(userId, {
      identityKey: b.identityKey,
      signedPreKeyId: b.signedPreKeyId,
      signedPreKeyPublic: b.signedPreKey,
      signedPreKeySignature: b.signedPreKeySignature,
      oneTimePreKeys: opks.map((k: { id: number; key: string }) => ({ id: k.id, key: k.key })),
    });
    ok(res, { registered: true });
  });

  // 取对端密钥包（OPK 取走即删；发起会话用）
  router.get("/bundle/:userId", (req, res) => {
    const bundle = ctx.store.getE2eBundle(String(req.params.userId));
    if (!bundle) return fail(res, new Error("对端未注册端到端加密"), 404);
    ok(res, bundle);
  });

  // 补充一次性预密钥
  router.post("/opks", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, new Error("需要用户身份"), 403);
    const opks = req.body?.oneTimePreKeys;
    if (!Array.isArray(opks) || opks.length === 0 || opks.length > 500) {
      return fail(res, new Error("oneTimePreKeys 非法"), 400);
    }
    for (const k of opks) {
      if (!isPreKeyId(k?.id) || !isB64(k?.key)) {
        return fail(res, new Error("oneTimePreKeys 含非法项"), 400);
      }
    }
    ctx.store.addE2eOpks(userId, opks);
    ok(res, { remaining: ctx.store.countE2eOpks(userId) });
  });

  // 对端是否已启用端到端加密（双方都注册才加密——灰度共存）
  router.get("/capability/:userId", (req, res) => {
    ok(res, { enrolled: ctx.store.hasE2eIdentity(String(req.params.userId)) });
  });

  return router;
}
