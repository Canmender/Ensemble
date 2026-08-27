import { Router } from "express";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AppContext } from "../../context";
import { ok, fail } from "./helpers";

/** 提取 `Authorization: Bearer <token>`（auth 路由挂在认证中间件之前，需自行解析） */
function bearerToken(auth: string | undefined): string | null {
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m ? m[1].trim() : null;
}

/**
 * 用户认证路由（注册 / 登录 / 会话）。
 * 挂载在 apiAuth 中间件之前（注册/登录无需已有 token）。
 */
export function authRouter(ctx: AppContext): Router {
  const r = Router();

  /** 注册：创建用户并返回会话 */
  r.post("/register", (req, res) => {
    const { username, password, displayName } = req.body ?? {};
    if (typeof username !== "string" || !/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
      return fail(res, new Error("用户名需 3-32 位字母、数字、_-. 字符"), 400);
    }
    if (typeof password !== "string" || password.length < 6) {
      return fail(res, new Error("密码至少 6 位"), 400);
    }
    const user = ctx.userStore.createUser(
      username,
      password,
      typeof displayName === "string" ? displayName : undefined,
    );
    if (!user) return fail(res, new Error("用户名已存在"), 409);
    const sessionTtlDays = ctx.config.getSettings().im?.sessionTtlDays;
    const { token, expiresAt } = ctx.userStore.createSession(user.id, undefined, sessionTtlDays);
    ok(res, { token, user, expiresAt }, 201);
  });

  /** 登录：校验密码并创建会话 */
  r.post("/login", (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== "string" || typeof password !== "string") {
      return fail(res, new Error("username and password required"), 400);
    }
    const user = ctx.userStore.findByUsername(username);
    if (!user || !ctx.userStore.verifyPassword(user, password)) {
      return fail(res, new Error("用户名或密码错误"), 401);
    }
    const sessionTtlDays2 = ctx.config.getSettings().im?.sessionTtlDays;
    const { token, expiresAt } = ctx.userStore.createSession(user.id, undefined, sessionTtlDays2);
    ok(res, {
      token,
      expiresAt,
      user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role, orgId: user.orgId },
    });
  });

  /** 当前用户信息 */
  r.get("/me", (req, res) => {
    const token = bearerToken(req.headers.authorization);
    const user = token ? ctx.userStore.getUserBySessionToken(token) : undefined;
    if (!user) return fail(res, new Error("未认证"), 401);
    // 附带 avatar_url
    const row = ctx.db.prepare("SELECT avatar_url FROM users WHERE id = ?").get(user.id) as any;
    ok(res, { ...user, avatarUrl: row?.avatar_url ?? undefined });
  });

  /** 更新当前用户昵称 */
  r.patch("/me", (req, res) => {
    const token = bearerToken(req.headers.authorization);
    const user = token ? ctx.userStore.getUserBySessionToken(token) : undefined;
    if (!user) return fail(res, new Error("未认证"), 401);
    const displayName = (req.body as { displayName?: unknown })?.displayName;
    if (typeof displayName !== "string" || !displayName.trim()) {
      return fail(res, new Error("displayName required"), 400);
    }
    const name = displayName.trim().slice(0, 30);
    ctx.userStore.updateDisplayName(user.id, name);
    ok(res, { id: user.id, username: user.username, displayName: name, role: user.role });
  });

  /** 上传头像（base64 JSON） */
  r.post("/avatar", (req, res) => {
    const token = bearerToken(req.headers.authorization);
    const user = token ? ctx.userStore.getUserBySessionToken(token) : undefined;
    if (!user) return fail(res, new Error("未认证"), 401);
    const { data, mime } = (req.body ?? {}) as { data?: string; mime?: string };
    if (typeof data !== "string" || !data) return fail(res, new Error("data required"), 400);
    const ext = mime?.includes("png") ? ".png" : mime?.includes("webp") ? ".webp" : ".jpg";
    const filename = `avatar-${user.id}${ext}`;
    const dir = join(ctx.uploadsDir, "avatars");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), Buffer.from(data, "base64"));
    const url = `/uploads/avatars/${filename}`;
    ctx.db.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").run(url, user.id);
    ok(res, { url });
  });

  /** 用户列表（创建用户-用户会话选人；含头像） */
  r.get("/users", (req, res) => {
    const rows = ctx.db
      .prepare("SELECT id, username, display_name, role, avatar_url FROM users ORDER BY created_at ASC")
      .all() as Array<Record<string, unknown>>;
    ok(res, rows.map((u) => ({
      id: String(u.id),
      username: String(u.username),
      displayName: u.display_name as string | undefined,
      role: String(u.role),
      avatarUrl: u.avatar_url as string | undefined,
    })));
  });

  /** 登出：删除会话 */
  r.post("/logout", (req, res) => {
    const token = bearerToken(req.headers.authorization);
    if (token) ctx.userStore.deleteSession(token);
    ok(res, { loggedOut: true });
  });

  return r;
}
