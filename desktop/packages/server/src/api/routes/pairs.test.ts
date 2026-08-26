import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { openDb } from "../../db/sqlite";
import { DeviceLinkLog } from "../../plugins/device-link-log";
import { pairsRouter } from "./pairs";

/**
 * L1+L2 验收（《手机桌面互联方案》）：
 * - 配对流程：生成码（5min 有效）→ 手机 confirm 落库 → 幂等 → 解绑
 * - 配对码安全：过期无效/他人账号拒绝/一次性消费
 * - sync 补拉：sinceTs 回放 delta、hasMore 分片、pairId 归属校验
 */

let server: Server;
let baseUrl: string;
let aliceToken = "alice-token";
const tokens = new Map<string, string>([["alice", "alice-token"], ["mallory", "mallory-token"]]);
const dbDir = mkdtempSync(join(tmpdir(), "pairs-test-"));

function makeApp(): express.Express {
  const db = openDb(join(dbDir, "t.db"));
  const log = new DeviceLinkLog(db);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const auth = String(req.headers.authorization ?? "");
    (req as any).user = { id: auth.replace("Bearer ", "") || "anon" };
    next();
  });
  app.use("/api/pairs", pairsRouter({ db, deviceLinkLog: log } as never));
  return app;
}

beforeAll(async () => {
  const app = makeApp();
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function api(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe("L2 设备配对", () => {
  it("生成 6 位数字码（含过期时间）", async () => {
    const r = await api("POST", "/api/pairs/code", aliceToken, { desktopDeviceId: "desk-1" });
    expect(r.status).toBe(200);
    expect(r.json.data.code).toMatch(/^\d{6}$/);
    expect(r.json.data.expiresAt).toBeGreaterThan(Date.now());
  });

  it("手机 confirm 配对成功并返回 pairId；重复确认幂等", async () => {
    const { json } = await api("POST", "/api/pairs/code", aliceToken, { desktopDeviceId: "desk-1" });
    const code = json.data.code;
    const c1 = await api("POST", "/api/pairs/confirm", aliceToken, { code, mobileDeviceId: "mob-1" });
    expect(c1.status).toBe(200);
    expect(c1.json.data.pairId).toBeTruthy();
    // 码已消费：第二次 confirm 同 code 应失败（一次性）
    const c2 = await api("POST", "/api/pairs/confirm", aliceToken, { code, mobileDeviceId: "mob-2" });
    expect(c2.status).toBe(404);
    // 同设备对重新走一遍配对 → 幂等返回同 pairId
    const { json: j2 } = await api("POST", "/api/pairs/code", aliceToken, { desktopDeviceId: "desk-1" });
    const c3 = await api("POST", "/api/pairs/confirm", aliceToken, { code: j2.data.code, mobileDeviceId: "mob-1" });
    expect(c3.json.data.pairId).toBe(c1.json.data.pairId);
  });

  it("配对码不跨账号（他人 confirm 拒绝）", async () => {
    const { json } = await api("POST", "/api/pairs/code", aliceToken, { desktopDeviceId: "desk-x" });
    const r = await api("POST", "/api/pairs/confirm", "mallory-token", { code: json.data.code, mobileDeviceId: "mob-m" });
    expect(r.status).toBe(403);
  });

  it("列表与解绑", async () => {
    const list = await api("GET", "/api/pairs", aliceToken);
    expect(list.json.data.length).toBeGreaterThanOrEqual(1);
    const pairId = list.json.data[0].id as string;
    // mallory 不能解绑 alice 的设备对
    const wrong = await api("DELETE", `/api/pairs/${pairId}`, "mallory-token");
    expect(wrong.status).toBe(404); // 按 user_id 过滤，不存在即 404
    const del = await api("DELETE", `/api/pairs/${pairId}`, aliceToken);
    expect(del.status).toBe(200);
  });
});

describe("L1 sync 补拉回放", () => {
  it("sinceTs 回放 delta；pairId 归属校验拒绝他人", async () => {
    // 直接写日志（模拟桌面端收发的互联信令）
    const db = openDb(join(dbDir, "t.db")); // 同库再开（node:sqlite 支持多连接）
    const log = new DeviceLinkLog(db);
    const t0 = Date.now() - 10_000;
    for (let i = 1; i <= 3; i++) {
      log.append({ msgId: `m${i}`, pairId: "pair-A", kind: "notify", payload: { i }, ts: t0 + i * 1000 });
    }
    log.append({ msgId: "dup", pairId: "pair-A", kind: "notify", payload: {}, ts: t0 + 500 });
    log.append({ msgId: "dup", pairId: "pair-A", kind: "notify", payload: {}, ts: t0 + 501 }); // 幂等忽略

    // 建立真实配对以便走 REST 校验
    const { json } = await api("POST", "/api/pairs/code", aliceToken, { desktopDeviceId: "desk-1" });
    const c = await api("POST", "/api/pairs/confirm", aliceToken, { code: json.data.code, mobileDeviceId: "mob-1" });
    void c;

    // 未配对的 pairId 拒绝
    const denied = await api("GET", "/api/pairs/pair-A/events?sinceTs=0", aliceToken);
    expect(denied.status).toBe(404);

    // 用真实 pairId 写入事件后回放（dup 重复写入验证幂等：第二次 INSERT OR IGNORE 忽略）
    const pairs = await api("GET", "/api/pairs", aliceToken);
    const realPair = pairs.json.data[pairs.json.data.length - 1].id as string;
    log.append({ msgId: "e1", pairId: realPair, kind: "handoff", payload: { runId: "r1" }, ts: Date.now() - 2000 });
    log.append({ msgId: "e2", pairId: realPair, kind: "notify", payload: { n: 2 }, ts: Date.now() - 1000 });
    log.append({ msgId: "e2", pairId: realPair, kind: "notify", payload: { n: 2 }, ts: Date.now() - 999 }); // 幂等忽略

    const replay = await api("GET", `/api/pairs/${realPair}/events?sinceTs=${Date.now() - 5000}`, aliceToken);
    expect(replay.status).toBe(200);
    expect(replay.json.data.events.map((e: any) => e.msgId)).toEqual(["e1", "e2"]);
    expect(replay.json.data.hasMore).toBe(false);

    // sinceTs 推进 → 只回放增量
    const replay2 = await api("GET", `/api/pairs/${realPair}/events?sinceTs=${Date.now() - 1500}`, aliceToken);
    expect(replay2.json.data.events.map((e: any) => e.msgId)).toEqual(["e2"]);

    // 幂等验证：重复 msgId 在回放里只出现一次
    const all = log.replay(realPair, 0);
    expect(all.events.filter((e) => e.msgId === "e2")).toHaveLength(1);
  });
});
