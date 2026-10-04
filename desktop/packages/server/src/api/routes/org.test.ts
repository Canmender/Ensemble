import { describe, it, expect, beforeEach } from "vitest";
import express, { type Request, type NextFunction } from "express";
import type { Server } from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { orgRouter } from "./org";

/**
 * org（组织与权限）当前行为的记录性测试 —— 不是断言「正确行为」，
 * 而是断言「现状」。目的是给这个已确认有缺陷的路由留一份基线，
 * 将来修复时能看出改动影响了哪些行为。
 *
 * 背景（2026-10-04 审计 + 实测）：
 * 一、org.ts:91 的路径 hack `r.patch("/../../users/:id")` 仍成立。
 *    实测：用原始 socket 发未规范化的 /api/org/../../users/u1，服务器收到
 *    /../../users/u1 后与该 pattern 恰好相等，故命中；而所有正常 HTTP 客户端
 *    都会规范化 URL，所以这个接口在正常客户端下根本调不通。
 *    → 正确写法应为 r.patch("/users/:id")。
 * 二、同端点的权限实现自认未完成：:98-100 注释写「简化实现：先读目标当前
 *    角色；完整实现需读 DB」。即「不能操作同级或更高」这条规则当前并未真正
 *    执行——它只校验「不能授予比自己更高的角色」，不校验目标当前角色的等级。
 * 三、鉴权由 requireRole("owner","admin","moderator") 把关，guest 与
 *    机器凭证（role:system）被拒。这部分是有效的。
 *
 * 本文件记录上述现状，包括看起来「不对」的部分。修复后请同步更新本文件，
 * 并在 commit message 里说明哪些断言变了、为什么。
 */

let store: Record<string, any>;
let servers: Server[] = [];

/** 记录 store 的写操作，便于断言「哪个方法被调用、参数是什么」 */
function makeStore() {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const rec =
    (fn: string) =>
    (...args: unknown[]) => {
      calls.push({ fn, args });
      return { ok: true };
    };
  const s = {
    calls,
    initOrganization: rec("initOrganization"),
    createDepartment: rec("createDepartment"),
    deleteDepartment: rec("deleteDepartment"),
    listDepartments: () => [],
    listMembers: () => [],
    updateUserRole: rec("updateUserRole"),
    updateUserStatus: rec("updateUserStatus"),
    updateUserDepts: rec("updateUserDepts"),
    updateUserTitle: rec("updateUserTitle"),
  };
  store = s as never;
  return s;
}

function makeApp(user?: { id: string; role?: string }): express.Express {
  makeStore();
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res, next: NextFunction) => {
    if (user) (req as any).user = user;
    next();
  });
  app.use("/api/org", orgRouter({ store } as never));
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

/**
 * 用原始 socket 发「未规范化」的路径。
 * fetch / axios / 浏览器都会把 /a/../../b 规范化成 /b，所以想触达路径 hack
 * 只能手写原始请求——这正是该端点在正常客户端下不可达的原因。
 */
function rawRequest(port: number, method: string, path: string, body: unknown): Promise<{ status: number; text: string }> {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body ?? {});
    const sock = net.connect(port, "127.0.0.1", () => {
      sock.write(
        `${method} ${path} HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n` +
        `Content-Length: ${Buffer.byteLength(payload)}\r\nConnection: close\r\n\r\n${payload}`,
      );
    });
    let buf = "";
    sock.on("data", (d) => (buf += d.toString()));
    sock.on("end", () => {
      const status = Number(buf.split(" ")[1] ?? 0);
      const idx = buf.indexOf("\r\n\r\n");
      resolve({ status, text: idx >= 0 ? buf.slice(idx + 4) : "" });
    });
    sock.on("error", () => resolve({ status: 0, text: "" }));
  });
}

beforeEach(() => {
  servers = [];
});

async function closeAll() {
  for (const s of servers) await new Promise<void>((r) => s.close(() => r()));
}

describe("org 当前行为基线（含已确认的缺陷，修复时同步更新）", () => {
  it("requireRole 有效：guest 与机器凭证被拒（403），moderator 可通过", async () => {
    const guest = await listen(makeApp({ id: "u1", role: "guest" }));
    const system = await listen(makeApp({ id: "bot", role: "system" }));
    const mod = await listen(makeApp({ id: "u2", role: "moderator" }));
    try {
      expect((await call(guest, "GET", "/api/org/members")).status).toBe(403);
      expect((await call(system, "GET", "/api/org/members")).status).toBe(403);
      expect((await call(mod, "GET", "/api/org/members")).status).toBe(200);
    } finally {
      await closeAll();
    }
  });

  it("路径 hack：未规范化的原始路径能命中，正常客户端路径 404（现状记录）", async () => {
    const app = makeApp({ id: "admin1", role: "admin" });
    const url = await listen(app);
    const port = Number(new URL(url).port);
    try {
      // 正常客户端：fetch 会把 /api/org/../../users/u9 规范化掉 → 404
      const normal = await call(url, "PATCH", "/api/org/users/u9", { role: "member" });
      expect(normal.status).toBe(404);

      // 原始未规范化路径：Express 剥掉 /api/org 后得到 /../../users/u9，
      // 与路由 pattern 恰好相等 → 命中（这正是缺陷本身）
      const hacked = await rawRequest(port, "PATCH", "/api/org/../../users/u9", { role: "member" });
      expect(hacked.status).toBe(200);
      expect(store.calls.some((c: { fn: string; args: unknown[] }) => c.fn === "updateUserRole")).toBe(true);
    } finally {
      await closeAll();
    }
  });

  it("权限实现自认未完成：只校验「不能授予更高角色」，不校验目标当前角色（现状记录）", async () => {
    const url = await listen(makeApp({ id: "admin1", role: "admin" }));
    const port = Number(new URL(url).port);
    const HACK = "/api/org/../../users/u9";
    try {
      // admin 试图授予 owner（比自己高）→ 403，这部分规则有效
      const escalate = await rawRequest(port, "PATCH", HACK, { role: "owner" });
      expect(escalate.status).toBe(403);

      // admin 授予 member（比自己低）→ 放行。
      // 当前实现未读目标当前角色，故即便目标实为 owner 也会被降级 ——
      // 这正是 org.ts:98-100 注释自认未完成的部分。
      const downgrade = await rawRequest(port, "PATCH", HACK, { role: "member" });
      expect(downgrade.status).toBe(200);
      expect(store.calls.find((c: { fn: string; args: unknown[] }) => c.fn === "updateUserRole")?.args).toEqual(["u9", "member"]);
    } finally {
      await closeAll();
    }
  });

  it("role 参数非法类型被拒（400）", async () => {
    const url = await listen(makeApp({ id: "admin1", role: "admin" }));
    const port = Number(new URL(url).port);
    try {
      const r = await rawRequest(port, "PATCH", "/api/org/../../users/u9", { role: 123 });
      expect(r.status).toBe(400);
    } finally {
      await closeAll();
    }
  });

  it("status/deptIds/title 三类更新互不影响，各自落到对应 store 方法", async () => {
    const url = await listen(makeApp({ id: "admin1", role: "admin" }));
    const port = Number(new URL(url).port);
    try {
      await rawRequest(port, "PATCH", "/api/org/../../users/u9", { status: "disabled", deptIds: ["d1"], title: "T" });
      const fns = store.calls.map((c: { fn: string; args: unknown[] }) => c.fn);
      expect(fns).toContain("updateUserStatus");
      expect(fns).toContain("updateUserDepts");
      expect(fns).toContain("updateUserTitle");
      expect(fns).not.toContain("updateUserRole"); // 未传 role 不应调它
    } finally {
      await closeAll();
    }
  });
});
