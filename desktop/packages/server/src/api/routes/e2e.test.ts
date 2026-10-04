import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Request, type NextFunction } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { openDb } from "../../db/sqlite";
import { Store } from "../../orchestration/store";
import { e2eRouter } from "./e2e";

/**
 * E2EE 密钥目录 HTTP 级测试（协议见 desktop/docs/E2E-PROTOCOL.md）：
 * 注册/轮换、bundle 下发与 OPK 取走即删、OPK 补充、capability 探测。
 * 认证用假中间件注入 req.user（apiAuth 已有独立测试覆盖）。
 *
 * 属主校验：bundle / capability 需登录，且请求双方存在共同会话。
 * 测试用 alice（登录态）与 bob（会话内对端），
 * evil 为已注册但无共同会话的用户，用于验证遍历被拒。
 */

let dir: string;
let server: Server;
let baseUrl: string;
let store: Store;

const ALICE = "alice";
const BOB = "bob";
const EVIL = "evil";

function makeApp(userId?: string): express.Express {
  const db = openDb(join(dir, `e2e-${userId ?? "anon"}.db`));
  const store = new Store(db);
  const app = express();
  app.use(express.json());
  if (userId) {
    app.use((req: Request, _res, next: NextFunction) => {
      (req as any).user = { id: userId };
      next();
    });
  }
  app.use("/api/e2e", e2eRouter({ store } as any));
  return app;
}

const BUNDLE = {
  identityKey: "aWtlLXB1YmxpYw==", // "ike-public"
  signedPreKeyId: 7,
  signedPreKey: "c3BrLXB1YmxpYw==", // "spk-public"
  signedPreKeySignature: "c2ln",
  oneTimePreKeys: [
    { id: 1, key: "b3BrLTE=" },
    { id: 2, key: "b3BrLTI=" },
  ],
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "e2e-test-"));
  const db = openDb(join(dir, "shared.db"));
  store = new Store(db);
  // alice ↔ bob 建立共同会话；alice ↔ evil 不建立
  store.createConversation({
    id: "conv-ab",
    userId: ALICE,
    type: "direct",
    participantIds: [ALICE, BOB],
    runId: "run-ab",
    unread: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  store.createConversation({
    id: "conv-priv",
    userId: EVIL,
    type: "direct",
    participantIds: [EVIL, "carol"],
    runId: "run-evil",
    unread: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const app = express();
  app.use(express.json());
  app.use((req: Request, _res, next: NextFunction) => {
    (req as any).user = { id: ALICE }; // alice 为登录态
    next();
  });
  app.use("/api/e2e", e2eRouter({ store } as any));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  // 注册密钥，使「已注册」与「有会话」两个条件彼此独立。
  // /register 恒以登录态写入，故 bob/evil 直接经 store 落库。
  await fetch(`${baseUrl}/api/e2e/register`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(BUNDLE),
  });
  for (const uid of [BOB, EVIL]) {
    store.upsertE2eIdentity(uid, {
      identityKey: BUNDLE.identityKey,
      signedPreKeyId: BUNDLE.signedPreKeyId,
      signedPreKeyPublic: BUNDLE.signedPreKey,
      signedPreKeySignature: BUNDLE.signedPreKeySignature,
      oneTimePreKeys: [],
    });
  }
  // 为 bob 单独补预密钥，使「取走即删」用例有确定的初始数量
  store.addE2eOpks(BOB, BUNDLE.oneTimePreKeys);
});

afterAll(async () => {
  // 不删除临时目录：Windows 下 SQLite 句柄未关闭时 rmdir 报 EPERM，交给系统回收
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("E2EE key directory", () => {
  it("rejects registration without user identity (403)", async () => {
    const anon = makeApp(undefined);
    const s2 = anon.listen(0, "127.0.0.1");
    await new Promise<void>((r) => s2.once("listening", r));
    const url = `http://127.0.0.1:${(s2.address() as AddressInfo).port}`;
    try {
      const res = await fetch(`${url}/api/e2e/register`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BUNDLE),
      });
      expect(res.status).toBe(403);
    } finally {
      await new Promise<void>((r) => s2.close(() => r()));
    }
  });

  it("validates bundle fields on registration (400)", async () => {
    const res = await fetch(`${baseUrl}/api/e2e/register`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...BUNDLE, identityKey: "not valid base64!!!" }),
    });
    expect(res.status).toBe(400);
  });

  it("registers and reports capability", async () => {
    const cap = await fetch(`${baseUrl}/api/e2e/capability/${BOB}`);
    expect((await cap.json()).data).toEqual({ enrolled: true });
  });

  it("serves bundle and consumes one-time prekeys one by one", async () => {
    const b1 = (await (await fetch(`${baseUrl}/api/e2e/bundle/${BOB}`)).json()).data;
    expect(b1.identityKey).toBe(BUNDLE.identityKey);
    expect(b1.signedPreKeyId).toBe(7);
    expect(b1.oneTimePreKey.key).toBeDefined();

    const b2 = (await (await fetch(`${baseUrl}/api/e2e/bundle/${BOB}`)).json()).data;
    expect(b2.oneTimePreKey.id).not.toBe(b1.oneTimePreKey.id);

    // OPK 耗尽：仍可取 bundle，但 oneTimePreKey 缺省
    const b3 = (await (await fetch(`${baseUrl}/api/e2e/bundle/${BOB}`)).json()).data;
    expect(b3.oneTimePreKey).toBeUndefined();
  });

  it("replenishes one-time prekeys", async () => {
    // /opks 恒写入登录态用户（alice）的预密钥。beforeAll 的 /register 已为
    // alice 写入 2 把，此处再补 1 把 → remaining = 3。
    const res = await fetch(`${baseUrl}/api/e2e/opks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oneTimePreKeys: [{ id: 10, key: "bmV3LTE=" }] }),
    });
    expect((await res.json()).data).toEqual({ remaining: 3 });

    // alice 不能取自己的 bundle（self-bundle 在 X3DH 中无用）；
    // 此处断言仅验证补充的 OPK 已落库给登录态用户
    const self = await fetch(`${baseUrl}/api/e2e/bundle/${ALICE}`);
    expect(self.status).toBe(400);
    expect(store.countE2eOpks(ALICE)).toBe(3);
  });

  // ---------- 属主校验 ----------

  it("rejects bundle read for a peer with no shared conversation (403)", async () => {
    // alice 请求 evil 的密钥包：evil 已注册但与 alice 无共同会话
    const res = await fetch(`${baseUrl}/api/e2e/bundle/${EVIL}`);
    expect(res.status).toBe(403);
  });

  it("rejects capability probe for a peer with no shared conversation (403)", async () => {
    const res = await fetch(`${baseUrl}/api/e2e/capability/${EVIL}`);
    expect(res.status).toBe(403);
  });

  it("rejects reading one's own bundle (400)", async () => {
    const res = await fetch(`${baseUrl}/api/e2e/bundle/${ALICE}`);
    expect(res.status).toBe(400);
  });

  it("requires authentication for bundle and capability (401)", async () => {
    const anon = makeApp(undefined);
    const s2 = anon.listen(0, "127.0.0.1");
    await new Promise<void>((r) => s2.once("listening", r));
    const url = `http://127.0.0.1:${(s2.address() as AddressInfo).port}`;
    try {
      const bundle = await fetch(`${url}/api/e2e/bundle/${BOB}`);
      expect(bundle.status).toBe(401);
      const cap = await fetch(`${url}/api/e2e/capability/${BOB}`);
      expect(cap.status).toBe(401);
    } finally {
      await new Promise<void>((r) => s2.close(() => r()));
    }
  });
});