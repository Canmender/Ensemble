import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { openDb } from "../../db/sqlite";
import { Store } from "../../orchestration/store";
import { runsRouter } from "./runs";

/**
 * R0 回归锁定（研究手册《插件化重构实施手册》R0 项）：
 * GET /api/runs/:id/events 必须同时接受 afterSeq 与移动端历史参数名 since——
 * 参数名错配曾导致移动端补拉静默失效。
 */

let dir: string;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "runs-routes-test-"));
  const db = openDb(join(dir, "runs.db"));
  const store = new Store(db);
  // 造一个带 3 条事件的 run（runs.task_id 外键 → 先建 task）
  store.createTask({
    id: "t1", title: "t", mode: "single",
    input: { mode: "single", prompt: "test" },
    createdAt: new Date().toISOString(),
  } as never);
  const run = {
    id: "r-events", taskId: "t1", mode: "single" as const,
    status: "success" as const, startedAt: new Date().toISOString(),
  };
  store.createRun(run);
  for (let i = 1; i <= 3; i++) {
    store.appendRunEvent("r-events", undefined, { type: "agent.event", agentId: "a", text: `e${i}`, ts: Date.now() + i } as never);
  }
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).user = { id: "u1" }; next(); });
  app.use("/api/runs", runsRouter({ store } as never));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/runs/:id/events 参数名兼容", () => {
  it("afterSeq 返回该序号之后的事件", async () => {
    const res = await fetch(`${baseUrl}/api/runs/r-events/events?afterSeq=1`);
    const json = (await res.json()) as { data: { events: Array<{ seq: number }> } };
    expect(json.data.events.map((e) => e.seq)).toEqual([2, 3]);
  });

  it("since 与 afterSeq 行为一致（移动端历史参数名）", async () => {
    const res = await fetch(`${baseUrl}/api/runs/r-events/events?since=2`);
    const json = (await res.json()) as { data: { events: Array<{ seq: number }> } };
    expect(json.data.events.map((e) => e.seq)).toEqual([3]);
  });

  it("无参数返回全量", async () => {
    const res = await fetch(`${baseUrl}/api/runs/r-events/events`);
    const json = (await res.json()) as { data: { events: unknown[] } };
    expect(json.data.events).toHaveLength(3);
  });
});
