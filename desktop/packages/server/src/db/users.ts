import type { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** 认证用户（附加到 req.user，供路由做数据隔离） */
export interface AuthUser {
  id: string;
  username: string;
  displayName?: string;
  role: string;
  orgId?: string;
}

/** users 表行 */
export interface UserRow {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  displayName?: string;
  role: string;
  orgId?: string;
  createdAt: string;
  updatedAt: string;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

/** 用户与会话存储（users / sessions 表），密码 scrypt 哈希（node:crypto，零依赖） */
export class UserStore {
  constructor(private db: DatabaseSync) {}

  /** 创建用户（用户名唯一；重复返回 null） */
  createUser(username: string, password: string, displayName?: string): AuthUser | null {
    if (this.findByUsername(username)) return null;
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    const id = `user_${randomBytes(8).toString("hex")}`;
    const now = new Date().toISOString();
    this.db
      .prepare("INSERT INTO users (id, username, password_hash, salt, display_name, role, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, username, hash, salt, displayName ?? null, "user", now, now);
    return { id, username, displayName, role: "user" };
  }

  findByUsername(username: string): UserRow | undefined {
    const r = this.db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
      | Record<string, unknown>
      | undefined;
    return r ? rowToUser(r) : undefined;
  }

  getById(id: string): AuthUser | undefined {
    const r = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return r
      ? { id: String(r.id), username: String(r.username), displayName: r.display_name as string | undefined, role: String(r.role), orgId: r.org_id as string | undefined }
      : undefined;
  }

  /** 校验密码（scrypt + timing-safe） */
  verifyPassword(user: UserRow, password: string): boolean {
    const hash = scryptSync(password, user.salt, 64);
    const expected = Buffer.from(user.passwordHash, "hex");
    return hash.length === expected.length && timingSafeEqual(hash, expected);
  }

  /** 创建会话，返回 token + 过期时间 */
  createSession(userId: string, deviceInfo?: string): { token: string; expiresAt: string } {
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    this.db
      .prepare("INSERT INTO sessions (token, user_id, created_at, expires_at, device_info) VALUES (?,?,?,?,?)")
      .run(token, userId, new Date().toISOString(), expiresAt, deviceInfo ?? null);
    return { token, expiresAt };
  }

  /** 通过会话 token 解析用户（含过期检查） */
  getUserBySessionToken(token: string): AuthUser | undefined {
    const r = this.db
      .prepare(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?",
      )
      .get(token, new Date().toISOString()) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return {
      id: String(r.id),
      username: String(r.username),
      displayName: r.display_name as string | undefined,
      role: String(r.role),
      orgId: r.org_id as string | undefined,
    };
  }

  deleteSession(token: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  }
}

function rowToUser(r: Record<string, unknown>): UserRow {
  return {
    id: String(r.id),
    username: String(r.username),
    passwordHash: String(r.password_hash),
    salt: String(r.salt),
    displayName: r.display_name as string | undefined,
    role: String(r.role),
    orgId: r.org_id as string | undefined,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}
