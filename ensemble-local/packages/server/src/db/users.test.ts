import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./sqlite";
import { UserStore } from "./users";

/** 临时 DB 的 UserStore 测试（users/sessions + scrypt 密码） */
function makeStore(): { store: UserStore; db: ReturnType<typeof openDb>; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "ensemble-users-"));
  const db = openDb(join(dir, "test.db"));
  return { store: new UserStore(db), db, dir };
}

const setups: Array<{ dir: string; db: ReturnType<typeof openDb> }> = [];
afterEach(() => {
  for (const s of setups.splice(0)) {
    try {
      s.db.close();
    } catch {
      /* already closed */
    }
    rmSync(s.dir, { recursive: true, force: true });
  }
});

function setup(): ReturnType<typeof makeStore> {
  const s = makeStore();
  setups.push({ dir: s.dir, db: s.db });
  return s;
}

describe("UserStore", () => {
  it("creates a user and verifies password", () => {
    const { store } = setup();
    const user = store.createUser("alice", "secret123", "Alice");
    expect(user).not.toBeNull();
    expect(user?.username).toBe("alice");

    const row = store.findByUsername("alice");
    expect(row).toBeDefined();
    expect(store.verifyPassword(row!, "secret123")).toBe(true);
    expect(store.verifyPassword(row!, "wrong")).toBe(false);
  });

  it("rejects duplicate usernames", () => {
    const { store } = setup();
    store.createUser("bob", "password1");
    expect(store.createUser("bob", "password2")).toBeNull();
  });

  it("validates username pattern at route level", () => {
    // createUser 不做正则校验（由路由层负责），但 id 生成可用
    const { store } = setup();
    expect(store.createUser("valid_name-1", "pass123")).not.toBeNull();
  });

  it("creates sessions and resolves users by token", () => {
    const { store } = setup();
    const user = store.createUser("carol", "pass1234");
    const { token, expiresAt } = store.createSession(user!.id, "test-device");

    expect(expiresAt).toBeDefined();
    const resolved = store.getUserBySessionToken(token);
    expect(resolved?.id).toBe(user!.id);
    expect(resolved?.username).toBe("carol");

    // 登出后无法解析
    store.deleteSession(token);
    expect(store.getUserBySessionToken(token)).toBeUndefined();
  });

  it("does not resolve expired sessions", () => {
    const { store, db } = setup();
    const user = store.createUser("dave", "pass1234");
    const { token } = store.createSession(user!.id);
    // 手动把会话改到已过期
    db.prepare("UPDATE sessions SET expires_at = ? WHERE token = ?").run(
      new Date(Date.now() - 1000).toISOString(),
      token,
    );
    expect(store.getUserBySessionToken(token)).toBeUndefined();
  });
});
