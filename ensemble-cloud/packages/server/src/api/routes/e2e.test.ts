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
 */

let dir: string;
let server: Server;
let baseUrl: string;

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
  const app = makeApp("alice");
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  // 不删除临时目录：Windows 下 SQLite 句柄未关闭时 rmdir 报 EPERM，交给系统回收
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("E2EE key directory", () => {
  it("rejects registration without user identity (403)", async () => {
    // 独立无用户 app：直接构造一个未认证端口
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
    const reg = await fetch(`${baseUrl}/api/e2e/register`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(BUNDLE),
    });
    expect((await reg.json()).data).toEqual({ registered: true });

    const cap = await fetch(`${baseUrl}/api/e2e/capability/alice`);
    expect((await cap.json()).data).toEqual({ enrolled: true });

    const capNone = await fetch(`${baseUrl}/api/e2e/capability/nobody`);
    expect((await capNone.json()).data).toEqual({ enrolled: false });
  });

  it("serves bundle and consumes one-time prekeys one by one", async () => {
    const b1 = (await (await fetch(`${baseUrl}/api/e2e/bundle/alice`)).json()).data;
    expect(b1.identityKey).toBe(BUNDLE.identityKey);
    expect(b1.signedPreKeyId).toBe(7);
    expect(b1.oneTimePreKey.key).toBeDefined();

    const b2 = (await (await fetch(`${baseUrl}/api/e2e/bundle/alice`)).json()).data;
    expect(b2.oneTimePreKey.id).not.toBe(b1.oneTimePreKey.id);

    // OPK 耗尽：仍可取 bundle，但 oneTimePreKey 缺省
    const b3 = (await (await fetch(`${baseUrl}/api/e2e/bundle/alice`)).json()).data;
    expect(b3.oneTimePreKey).toBeUndefined();
  });

  it("replenishes one-time prekeys", async () => {
    const res = await fetch(`${baseUrl}/api/e2e/opks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oneTimePreKeys: [{ id: 10, key: "bmV3LTE=" }] }),
    });
    expect((await res.json()).data).toEqual({ remaining: 1 });

    const again = await fetch(`${baseUrl}/api/e2e/bundle/alice`);
    const b = (await again.json()).data;
    expect(b.oneTimePreKey?.id).toBe(10);
  });

  it("returns 404 for unregistered peer", async () => {
    const res = await fetch(`${baseUrl}/api/e2e/bundle/ghost`);
    expect(res.status).toBe(404);
  });
});
