import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Request, type NextFunction } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { openDb } from "../../db/sqlite";
import { Store } from "../../orchestration/store";
import { groupsRouter } from "./groups";

/**
 * 群管理的角色权限（属主隔离的第二层：同群成员之间的权限边界）。
 *
 * 角色语义（见 groups.ts 的 setRole 注释）：1=群主 2=管理员 3=普通成员。
 * 规则：
 *   - 群主（1）可设所有人
 *   - 管理员（2）不能操作群主或同级管理员
 *   - 普通成员（3）无权操作
 *   - 改入群方式/公告：非普通成员即可
 * 这些规则全在路由侧用 getGroupMember 判定，是本组防护最严的路由，
 * 因此负例（越权被拒）比正例更重要。
 */

const OWNER = "owner";     // role 1 群主
const ADMIN = "admin";     // role 2 管理员
const ADMIN2 = "admin2";   // role 2 另一个管理员
const MEMBER = "member";   // role 3 普通成员
const OUTSIDER = "outsider"; // 不在群内

let store: Store;
let servers: Server[] = [];

function makeApp(userId?: string): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, res, next: NextFunction) => {
    if (userId) (req as any).user = { id: userId };
    if (!userId) return res.status(401).json({ error: { message: "unauthorized" } });
    next();
  });
  app.use("/api/groups", groupsRouter({ store } as never));
  return app;
}

async function listen(app: express.Express): Promise<string> {
  const s = app.listen(0, "127.0.0.1");
  servers.push(s);
  await new Promise<void>((r) => s.once("listening", () => r()));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

async function call(as: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${as}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: (await res.json().catch(() => null))?.data };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "groups-authz-"));
  store = new Store(openDb(join(dir, "a.db")));
  const now = new Date().toISOString();
  store.createConversation({
    id: "c1", userId: OWNER, type: "group", title: "测试群",
    participantIds: [OWNER, ADMIN, ADMIN2, MEMBER], runId: "r1",
    unread: 0, createdAt: now, updatedAt: now,
  } as never);
  store.setGroupMemberRole("c1", OWNER, 1);
  store.setGroupMemberRole("c1", ADMIN, 2);
  store.setGroupMemberRole("c1", ADMIN2, 2);
  store.setGroupMemberRole("c1", MEMBER, 3);
});

afterAll(async () => {
  for (const s of servers) await new Promise<void>((r) => s.close(() => r()));
  servers = [];
});

describe("群成员角色权限", () => {
  it("群主可设任何人为管理员", async () => {
    const asOwner = await listen(makeApp(OWNER));
    const r = await call(asOwner, "PUT", "/api/groups/c1/members/member/role", { role: 2 });
    expect(r.status).toBe(200);
    expect(store.getGroupMember("c1", MEMBER)?.role).toBe(2);
    store.setGroupMemberRole("c1", MEMBER, 3); // 复位供后续用例
  });

  it("管理员不能设群主或同级管理员（403）", async () => {
    const asAdmin = await listen(makeApp(ADMIN));
    // 目标是群主
    const r1 = await call(asAdmin, "PUT", "/api/groups/c1/members/owner/role", { role: 3 });
    expect(r1.status).toBe(403);
    // 目标是同级管理员
    const r2 = await call(asAdmin, "PUT", "/api/groups/c1/members/admin2/role", { role: 3 });
    expect(r2.status).toBe(403);
    expect(store.getGroupMember("c1", OWNER)?.role).toBe(1);
    expect(store.getGroupMember("c1", ADMIN2)?.role).toBe(2);
  });

  it("普通成员无权改角色（403）", async () => {
    const asMember = await listen(makeApp(MEMBER));
    const r = await call(asMember, "PUT", "/api/groups/c1/members/admin/role", { role: 3 });
    expect(r.status).toBe(403);
    expect(store.getGroupMember("c1", ADMIN)?.role).toBe(2);
  });

  it("群外用户改角色被拒（400：不在群内）", async () => {
    const asOut = await listen(makeApp(OUTSIDER));
    const r = await call(asOut, "PUT", "/api/groups/c1/members/admin/role", { role: 3 });
    expect(r.status).toBe(400);
  });

  it("普通成员不能改入群方式与群公告（403）", async () => {
    const asMember = await listen(makeApp(MEMBER));
    expect((await call(asMember, "PUT", "/api/groups/c1/join-type", { joinType: 0 })).status).toBe(403);
    expect((await call(asMember, "PUT", "/api/groups/c1/announcement", { text: "x" })).status).toBe(403);
  });

  it("管理员可改入群方式与公告（200）", async () => {
    const asAdmin = await listen(makeApp(ADMIN));
    expect((await call(asAdmin, "PUT", "/api/groups/c1/join-type", { joinType: 2 })).status).toBe(200);
    expect((await call(asAdmin, "PUT", "/api/groups/c1/announcement", { text: "公告" })).status).toBe(200);
  });

  it("非法 role 值被拒（400）", async () => {
    const asOwner = await listen(makeApp(OWNER));
    expect((await call(asOwner, "PUT", "/api/groups/c1/members/member/role", { role: 9 })).status).toBe(400);
  });

  it("会话不存在返回 404", async () => {
    const asOwner = await listen(makeApp(OWNER));
    expect((await call(asOwner, "GET", "/api/groups/nope/members")).status).toBe(404);
  });

  it("未登录访问被拒（401）", async () => {
    const anon = await listen(makeApp(undefined));
    expect((await call(anon, "GET", "/api/groups/c1/members")).status).toBe(401);
    expect((await call(anon, "PUT", "/api/groups/c1/join-type", { joinType: 0 })).status).toBe(401);
  });
});