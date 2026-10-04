import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Request, type NextFunction } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { openDb } from "../../db/sqlite";
import { Store } from "../../orchestration/store";
import { reactionsRouter } from "./reactions";

/**
 * 消息表情回应的属主隔离。
 *
 * 关注点：写操作的身份必须来自登录态 req.user?.id，不接受客户端传入的
 * userId——否则任何登录用户都能替他人添加或移除表情回应。
 * 删除时 store 的 SQL 带 user_id 条件，故只能删自己的。
 */

const ALICE = "alice";
const BOB = "bob";
const MSG = "msg-1";

let store: Store;
let server: Server;
let baseUrl: string;

function makeApp(userId?: string): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, res, next: NextFunction) => {
    if (userId) (req as any).user = { id: userId };
    if (!userId) return res.status(401).json({ error: { message: "unauthorized" } });
    next();
  });
  app.use("/api/reactions", reactionsRouter({ store } as never));
  return app;
}

async function api(method: string, path: string, body?: unknown, base = baseUrl) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: (await res.json().catch(() => null))?.data };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "reactions-authz-"));
  store = new Store(openDb(join(dir, "a.db")));
  const app = makeApp(ALICE);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("表情回应属主隔离", () => {
  it("登录用户可为自己添加回应", async () => {
    const r = await api("POST", `/api/reactions/${MSG}`, { emoji: "👍" });
    expect(r.status).toBe(200);
    const got = await api("GET", `/api/reactions/${MSG}`);
    expect(got.data["👍"].count).toBe(1);
    expect(got.data["👍"].userIds).toContain(ALICE);
  });

  it("只能移除自己的回应：bob 删 alice 的表情不生效", async () => {
    const bob = makeApp(BOB);
    const s2 = bob.listen(0, "127.0.0.1");
    await new Promise<void>((r) => s2.once("listening", () => r()));
    const bobUrl = `http://127.0.0.1:${(s2.address() as AddressInfo).port}`;
    try {
      const r = await api("POST", `/api/reactions/${MSG}`, { emoji: "👍" }, bobUrl);
      expect(r.status).toBe(200);
      // 两人各有一个 👍，count 应为 2
      const got = await api("GET", `/api/reactions/${MSG}`);
      expect(got.data["👍"].count).toBe(2);
      expect(got.data["👍"].userIds.sort()).toEqual([ALICE, BOB]);
      // bob 尝试移除：SQL 带 user_id，仅他自己的那条被删
      await api("DELETE", `/api/reactions/${MSG}/${encodeURIComponent("👍")}`, undefined, bobUrl);
      const after = await api("GET", `/api/reactions/${MSG}`);
      expect(after.data["👍"].userIds).toEqual([ALICE]);
    } finally {
      await new Promise<void>((r) => s2.close(() => r()));
    }
  });

  it("未登录访问被拒（401）", async () => {
    const anon = makeApp(undefined);
    const s2 = anon.listen(0, "127.0.0.1");
    await new Promise<void>((r) => s2.once("listening", () => r()));
    const url = `http://127.0.0.1:${(s2.address() as AddressInfo).port}`;
    try {
      expect((await api("GET", `/api/reactions/${MSG}`, undefined, url)).status).toBe(401);
      expect((await api("POST", `/api/reactions/${MSG}`, { emoji: "🔥" }, url)).status).toBe(401);
    } finally {
      await new Promise<void>((r) => s2.close(() => r()));
    }
  });
});
