import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Request, type NextFunction } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { openDb } from "../../db/sqlite";
import { Store } from "../../orchestration/store";
import { tokensRouter } from "./tokens";

/**
 * Token 用量统计的属主隔离（回归固化）。
 *
 * 背景：2026-10-04 修复的越权缺陷——tokens.ts:13 曾调用 listRuns() 漏传
 * userId，而 store.listRuns(filter?, userId?) 本就支持隔离（同包 runs.ts:10、
 * tasks.ts:16 均正确传入）。漏传导致任何登录用户能看到全服务器所有 run 的
 * token 消耗聚合。
 *
 * 关键断言是「正例 + 反例」：只测「alice 看到自己的 111」无法排除
 * 「库里恰好只有 alice 的数据」或「接口本来就返回全量」。反例 1110
 * 把修复前的状态量化出来，两者并存才证明过滤真实生效。
 */

const ALICE = "alice";
const BOB = "bob";
const ALICE_TOKENS = 111;
const BOB_TOKENS = 999;

let dir: string;
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
  app.use("/api/tokens", tokensRouter({ store } as never));
  return app;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "tokens-authz-"));
  const db = openDb(join(dir, "a.db"));
  store = new Store(db);
  const now = new Date().toISOString();

  // alice 与 bob 各有 run 与 job，用量刻意不同以便识别串味
  for (const [uid, input] of [[ALICE, ALICE_TOKENS], [BOB, BOB_TOKENS]] as const) {
    store.createTask({
      id: `t_${uid}`, title: `任务${uid}`, mode: "chat",
      input: { prompt: "x" }, userId: uid, createdAt: now,
    } as never);
    store.createRun({
      id: `r_${uid}`, taskId: `t_${uid}`, mode: "chat", status: "done",
      userId: uid, startedAt: now, updatedAt: now,
    } as never);
    store.createJob({
      id: `j_${uid}`, runId: `r_${uid}`, seq: 0, agentId: "a1",
      agentName: "agent", prompt: "p", status: "done", createdAt: now,
    } as never);
    // usage 由 updateJob 写入——createJob 不含该列（首次实测踩过这个坑）
    store.updateJob(`j_${uid}`, { usage: { inputTokens: input, outputTokens: 11 } } as never);
  }

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

async function stats(base = baseUrl) {
  const res = await fetch(`${base}/api/tokens/stats`);
  return { status: res.status, data: (await res.json().catch(() => null))?.data };
}

describe("Token 用量属主隔离", () => {
  it("登录用户只聚合自己的 run，不含他人用量", async () => {
    const r = await stats();
    expect(r.status).toBe(200);
    expect(r.data.total.input).toBe(ALICE_TOKENS);
    expect(r.data.total.output).toBe(11);
  });

  it("正反对照：加 userId 得 111，无参得 1110（修复前的越权面）", () => {
    // 反例：直接调 store 层，量化「若不传 userId」会看到的全量
    const sum = (uid?: string) =>
      store
        .listRuns(undefined, uid)
        .reduce((s, r) => s + store.getJobs(r.id).reduce((x, j) => x + (j.usage?.inputTokens ?? 0), 0), 0);
    expect(sum(ALICE)).toBe(ALICE_TOKENS);
    expect(sum(BOB)).toBe(BOB_TOKENS);
    expect(sum()).toBe(ALICE_TOKENS + BOB_TOKENS); // 修复前的行为
  });

  it("按 agent 与按日的聚合同样只含自己的数据", async () => {
    const r = await stats();
    expect(r.data.byAgent).toHaveLength(1);
    expect(r.data.byAgent[0].input).toBe(ALICE_TOKENS);
    // byDay 每天一行，合计等于 total
    const daySum = r.data.byDay.reduce((s: number, d: any) => s + d.input, 0);
    expect(daySum).toBe(ALICE_TOKENS);
  });

  it("未登录访问被拒（401）", async () => {
    const anon = makeApp(undefined);
    const s2 = anon.listen(0, "127.0.0.1");
    await new Promise<void>((r) => s2.once("listening", () => r()));
    const url = `http://127.0.0.1:${(s2.address() as AddressInfo).port}`;
    try {
      const r = await stats(url);
      expect(r.status).toBe(401);
    } finally {
      await new Promise<void>((r) => s2.close(() => r()));
    }
  });
});
