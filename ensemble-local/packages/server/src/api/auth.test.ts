import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { apiAuth } from "./auth";

/**
 * 认证中间件 HTTP 级测试。
 * 用真实 express app（listen 0 + Node fetch）验证：
 * - Bearer token 校验（缺失/错误/正确）
 * - health 公开端点放行
 * - ws-token bootstrap 端点的 Origin/Referer 校验
 */

const SECRET = "test-secret-token";

function makeApp(): express.Express {
  const app = express();
  app.use(
    "/api",
    apiAuth({
      getToken: () => SECRET,
      publicPaths: ["/health"],
      originGuardPaths: ["/ws-token"],
    }),
  );

  // 模拟真实端点
  app.get("/api/health", (_req, res) => res.json({ data: { status: "ok" } }));
  app.get("/api/ws-token", (_req, res) => res.json({ token: SECRET }));
  app.get("/api/agents", (_req, res) => res.json({ data: [] }));
  app.post("/api/tasks", (_req, res) => res.json({ data: {} }));
  return app;
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = makeApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

// ── Bearer token 校验 ───────────────────────────────────────────────────────

describe("Bearer token authentication", () => {
  it("rejects requests without a token (401)", async () => {
    const res = await fetch(`${baseUrl}/api/agents`);
    expect(res.status).toBe(401);
  });

  it("rejects requests with an invalid token (401)", async () => {
    const res = await fetch(`${baseUrl}/api/agents`, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects requests with a malformed Authorization header (401)", async () => {
    const res = await fetch(`${baseUrl}/api/agents`, {
      headers: { Authorization: SECRET }, // 缺少 Bearer 前缀
    });
    expect(res.status).toBe(401);
  });

  it("rejects requests with an empty token (401)", async () => {
    const res = await fetch(`${baseUrl}/api/agents`, {
      headers: { Authorization: "Bearer " },
    });
    expect(res.status).toBe(401);
  });

  it("allows requests with the correct token (200)", async () => {
    const res = await fetch(`${baseUrl}/api/agents`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(res.status).toBe(200);
  });

  it("accepts the Bearer scheme case-insensitively (200)", async () => {
    const res = await fetch(`${baseUrl}/api/agents`, {
      headers: { Authorization: `bearer ${SECRET}` },
    });
    expect(res.status).toBe(200);
  });

  it("protects write endpoints too (401 without token)", async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("returns a JSON error body with code on 401", async () => {
    const res = await fetch(`${baseUrl}/api/agents`);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("unauthorized");
  });

  it("sets WWW-Authenticate header on 401", async () => {
    const res = await fetch(`${baseUrl}/api/agents`);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer /);
  });
});

// ── 公开端点 ────────────────────────────────────────────────────────────────

describe("public paths", () => {
  it("allows /api/health without a token (200)", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
  });
});

// ── ws-token Origin/Referer 校验 ────────────────────────────────────────────

describe("ws-token origin guard", () => {
  it("allows requests without Origin/Referer (curl / React Native) (200)", async () => {
    const res = await fetch(`${baseUrl}/api/ws-token`);
    expect(res.status).toBe(200);
  });

  it("allows same-origin desktop requests (http://127.0.0.1:<any port>)", async () => {
    const res = await fetch(`${baseUrl}/api/ws-token`, {
      headers: { Origin: "http://127.0.0.1:49321" },
    });
    expect(res.status).toBe(200);
  });

  it("allows dev-mode Vite origin (http://localhost:5173)", async () => {
    const res = await fetch(`${baseUrl}/api/ws-token`, {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(res.status).toBe(200);
  });

  it("allows IPv6 loopback origin", async () => {
    const res = await fetch(`${baseUrl}/api/ws-token`, {
      headers: { Origin: "http://[::1]:5173" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects a remote malicious origin (403)", async () => {
    const res = await fetch(`${baseUrl}/api/ws-token`, {
      headers: { Origin: "https://evil.example.com" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects a remote origin via Referer when Origin is absent (403)", async () => {
    const res = await fetch(`${baseUrl}/api/ws-token`, {
      headers: { Referer: "https://evil.example.com/page" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects an invalid Origin value (403)", async () => {
    const res = await fetch(`${baseUrl}/api/ws-token`, {
      headers: { Origin: "not-a-url" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects non-GET methods on ws-token (405)", async () => {
    const res = await fetch(`${baseUrl}/api/ws-token`, { method: "POST" });
    expect(res.status).toBe(405);
  });
});

// ── 多凭证认证（用户 token / API key / 设备 token） ─────────────────────────

describe("multi-credential auth", () => {
  const app = express();
  app.use(
    "/api",
    apiAuth({
      resolveUser: (token) =>
        token === "user-token" ? { id: "u1", username: "alice", role: "user" } : undefined,
      apiKey: "machine-key",
      getToken: () => "device-token",
      publicPaths: ["/health"],
      originGuardPaths: ["/ws-token"],
    }),
  );
  app.get("/api/agents", (req, res) => res.json({ data: { user: req.user?.username ?? null } }));
  app.get("/api/health", (_req, res) => res.json({ data: { status: "ok" } }));

  let s: Server;
  let url: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      s = app.listen(0, "127.0.0.1", () => {
        url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => s.close((err) => (err ? reject(err) : resolve())));
  });

  it("resolves a user session token to req.user", async () => {
    const res = await fetch(`${url}/api/agents`, {
      headers: { Authorization: "Bearer user-token" },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.user).toBe("alice");
  });

  it("resolves the machine API key to system user", async () => {
    const res = await fetch(`${url}/api/agents`, {
      headers: { Authorization: "Bearer machine-key" },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.user).toBe("system");
  });

  it("accepts the device token without a user (local mode)", async () => {
    const res = await fetch(`${url}/api/agents`, {
      headers: { Authorization: "Bearer device-token" },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.user).toBeNull();
  });

  it("rejects unknown tokens", async () => {
    const res = await fetch(`${url}/api/agents`, {
      headers: { Authorization: "Bearer unknown-token" },
    });
    expect(res.status).toBe(401);
  });

  it("still allows public health without a token", async () => {
    const res = await fetch(`${url}/api/health`);
    expect(res.status).toBe(200);
  });
});
