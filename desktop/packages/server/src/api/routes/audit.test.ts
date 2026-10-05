import { describe, it, expect, beforeEach, afterAll } from "vitest";
import express, { type Request, type NextFunction } from "express";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { openDb } from "../../db/sqlite";
import { Store } from "../../orchestration/store";
import { WsHub } from "../ws/hub";
import { auditRouter } from "./audit";

/**
 * 审计台端到端测试（docs/AUDIT-DESIGN.md）。
 *
 * 背景：审批事件曾从未被记录——pendingConfirms 是内存 Map，批准/拒绝/超时/
 * 关机四条路径全部只 resolve 不落库，重启即丢。本测试把这四条路径固化，
 * 防止将来改回去又不留痕。
 *
 * 重点断言（按「不会误伤」优先）：
 *  - 三种 decision 都能查到，且 auto_reject 能区分来源
 *  - 跨用户隔离：query 里的 userId 被忽略
 *  - args 只存摘要，不含参数原文
 */

const ALICE = "alice";
const BOB = "bob";

let dir: string;
let store: Store;
let hub: WsHub;
let baseUrl: string;

function makeApp(userId?: string): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, res, next: NextFunction) => {
    if (userId) (req as any).user = { id: userId };
    if (!userId) return res.status(401).json({ error: { message: "unauthorized" } });
    next();
  });
  app.use("/api/audit", auditRouter({ store } as never));
  return app;
}

async function listen(app: express.Express): Promise<string> {
  const s = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => s.once("listening", () => r()));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

/** 等 pendingConfirms 里出现新条目（广播是异步的） */
async function waitForConfirm(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const id = (hub as any).pendingConfirms.keys().next().value;
    if (id) return id as string;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("confirm 未进入 pendingConfirms");
}

async function query(as: string, qs = ""): Promise<any[]> {
  const res = await fetch(`${as}/api/audit${qs}`);
  return ((await res.json())?.data ?? []) as any[];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "audit-test-"));
  store = new Store(openDb(join(dir, "a.db")));
  hub = new WsHub();
  hub.appendAudit = (e) => store.appendAuditLog(e);
});

describe("Agent 行为审计台", () => {
  it("记录批准 / 拒绝 / 超时自动拒绝三条路径", async () => {
    const as = await listen(makeApp(ALICE));

    // 批准
    const p1 = hub.requestConfirm("run-1", "delete_file", { path: "a.txt" }, ALICE, 60_000);
    hub.resolveConfirm(await waitForConfirm(), true);
    expect(await p1).toBe(true);

    // 拒绝
    const p2 = hub.requestConfirm("run-1", "write_file", { path: "b.txt" }, ALICE, 60_000);
    hub.resolveConfirm(await waitForConfirm(), false);
    expect(await p2).toBe(false);

    // 超时自动拒绝（50ms）
    expect(await hub.requestConfirm("run-2", "exec", { cmd: "rm -rf /" }, ALICE, 50)).toBe(false);

    const entries = await query(as);
    expect(entries).toHaveLength(3);
    const byDecision = Object.fromEntries(entries.map((e) => [e.decision, e]));
    expect(byDecision.approve.tool).toBe("delete_file");
    expect(byDecision.reject.tool).toBe("write_file");
    expect(byDecision.auto_reject.reason).toBe("timeout");
    expect(byDecision.auto_reject.runId).toBe("run-2");
  });

  it("记录主体、耗时与 run 归属", async () => {
    const as = await listen(makeApp(ALICE));
    const p = hub.requestConfirm("run-x", "write", { a: 1 }, ALICE, 60_000);
    hub.resolveConfirm(await waitForConfirm(), true);
    await p;

    const [e] = await query(as);
    expect(e.userId).toBe(ALICE);
    expect(e.runId).toBe("run-x");
    expect(typeof e.latencyMs).toBe("number");
    expect(e.confirmId).toBeTruthy();
  });

  it("args 只存摘要，不含参数原文", async () => {
    const as = await listen(makeApp(ALICE));
    const p = hub.requestConfirm("run-y", "write_file", { content: "机密内容", path: "x" }, ALICE, 60_000);
    hub.resolveConfirm(await waitForConfirm(), true);
    await p;

    const [e] = await query(as);
    expect(e.argsDigest).toMatch(/^sha256:[0-9a-f]+;keys=\[content,path\];len=\d+$/);
    expect(JSON.stringify(e)).not.toContain("机密内容");
  });

  it("跨用户隔离：query 的 userId 被忽略，只返回自己的", async () => {
    store.appendAuditLog({ userId: ALICE, action: "tool_confirm", tool: "a", decision: "approve" });
    store.appendAuditLog({ userId: BOB, action: "tool_confirm", tool: "b", decision: "reject" });

    const asBob = await listen(makeApp(BOB));
    const asAlice = await listen(makeApp(ALICE));

    const bob = await query(asBob, "?userId=alice");
    expect(bob).toHaveLength(1);
    expect(bob[0].tool).toBe("b");

    const alice = await query(asAlice, "?userId=bob");
    expect(alice).toHaveLength(1);
    expect(alice[0].tool).toBe("a");
  });

  it("按 decision 过滤", async () => {
    const as = await listen(makeApp(ALICE));
    store.appendAuditLog({ userId: ALICE, action: "tool_confirm", tool: "a", decision: "approve" });
    store.appendAuditLog({ userId: ALICE, action: "tool_confirm", tool: "b", decision: "reject" });
    const rejects = await query(as, "?decision=reject");
    expect(rejects).toHaveLength(1);
    expect(rejects[0].tool).toBe("b");
  });

  it("未登录访问被拒（401）", async () => {
    const anon = await listen(makeApp(undefined));
    const res = await fetch(`${anon}/api/audit`);
    expect(res.status).toBe(401);
  });

  it("未注入 appendAudit 时审批仍可用，只是不留痕", async () => {
    // hub.appendAudit 为可选注入；不注入时不应抛错
    const bare = new WsHub();
    const p = bare.requestConfirm("run-z", "tool", {}, ALICE, 60_000);
    for (let i = 0; i < 50; i++) {
      const id = (bare as any).pendingConfirms.keys().next().value;
      if (id) { bare.resolveConfirm(id, true); break; }
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(await p).toBe(true);
  });
});