import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Request, type NextFunction } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { openDb } from "../../db/sqlite";
import { PerUserPluginManager } from "../../plugins/per-user";
import { userPluginsRouter } from "./user-plugins";

/**
 * 用户级插件的属主隔离。
 *
 * 关注两层：
 *  1. 配置/启用状态按 userId 隔离（listForUser 的 SQL 带 WHERE user_id = ?）
 *  2. 插件动作分发的键含 userId（`user/${userId}/${pluginId}/${action}`），
 *     故 alice 无法调用 bob 实例注册的动作
 */

const ALICE = "alice";
const BOB = "bob";

let dir: string;
let db: ReturnType<typeof openDb>;
let plugins: PerUserPluginManager;
let servers: Server[] = [];

/** 最小 host：listForUser 会调 statusOf；actions 端点会调 tryGet */
function makeHost(actions?: Map<string, (b: unknown) => unknown>) {
  return {
    statusOf: () => ({ ok: true, error: null }),
    tryGet: (key: string) => (key === "plugin-actions" ? actions : undefined),
  } as never;
}

function makeApp(userId?: string, actions?: Map<string, (b: unknown) => unknown>): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, res, next: NextFunction) => {
    if (userId) (req as any).user = { id: userId };
    if (!userId) return res.status(401).json({ error: { message: "unauthorized" } });
    next();
  });
  app.use("/api/user-plugins", userPluginsRouter({
    userPlugins: plugins,
    pluginHost: makeHost(actions),
    provide: () => {},
  } as never));
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

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "user-plugins-authz-"));
  db = openDb(join(dir, "a.db"));
  plugins = new PerUserPluginManager(makeHost(), db as never, (() => ({})) as never);
  for (const id of ["p1", "p2"]) {
    plugins.registerCandidate({
      manifest: {
        id, name: `插件${id}`, version: "1.0.0", description: "",
        scheduled: 0, settings: [],
      },
      tool: async () => ({}), hooks: {}, llm: null,
    } as never);
  }
});

/**
 * 写入某用户的插件配置。
 * 不用 setConfig——它会 unmount/mount 插件实例，需要完整 PluginHost；
 * 这里只验属主隔离，直接写库走 listForUser / getUserConfig 的真实读取路径。
 */
function seedConfig(userId: string, pluginId: string, config: unknown) {
  db.prepare(
    "INSERT INTO user_plugins (user_id, plugin_id, config_json, enabled, updated_at) VALUES (?,?,?,1,?) " +
    "ON CONFLICT(user_id, plugin_id) DO UPDATE SET config_json = excluded.config_json",
  ).run(userId, pluginId, JSON.stringify(config), new Date().toISOString());
}

afterAll(async () => {
  for (const s of servers) await new Promise<void>((r) => s.close(() => r()));
  servers = [];
});

describe("用户级插件属主隔离", () => {
  it("配置与启用状态按用户隔离：A 配置过不影响 B 的 hasConfig", async () => {
    seedConfig(ALICE, "p1", { city: "Beijing" });
    const asAlice = await listen(makeApp(ALICE));
    const asBob = await listen(makeApp(BOB));

    const a = await call(asAlice, "GET", "/api/user-plugins");
    const b = await call(asBob, "GET", "/api/user-plugins");
    const ap1 = a.data.find((p: any) => p.id === "p1");
    const bp1 = b.data.find((p: any) => p.id === "p1");
    expect(ap1.hasConfig).toBe(true);
    expect(bp1.hasConfig).toBe(false); // bob 视角看不到 alice 的配置
  });

  it("读配置只返回自己的（GET config）", async () => {
    const asAlice = await listen(makeApp(ALICE));
    const asBob = await listen(makeApp(BOB));
    expect((await call(asAlice, "GET", "/api/user-plugins/p1/config")).data).toEqual({ city: "Beijing" });
    // bob 无配置：store.getUserConfig 返回 {}（空对象），非 undefined
    expect((await call(asBob, "GET", "/api/user-plugins/p1/config")).data).toEqual({});
  });

  it("两人各写各的配置，互不影响（写入隔离）", () => {
    seedConfig(ALICE, "p1", { city: "Beijing" });
    seedConfig(BOB, "p1", { city: "Shanghai" });
    expect(plugins.getUserConfig(ALICE, "p1")).toEqual({ city: "Beijing" });
    expect(plugins.getUserConfig(BOB, "p1")).toEqual({ city: "Shanghai" });
  });

  it("插件动作按 userId 分发：A 无法调用 B 实例的动作（404）", async () => {
    // 只为 bob 注册一个动作
    const actions = new Map<string, (b: unknown) => unknown>([
      [`user/${BOB}/p1/refresh`, () => ({ ok: true, by: BOB })],
    ]);
    const asAlice = await listen(makeApp(ALICE, actions));
    const asBob = await listen(makeApp(BOB, actions));

    const bobCall = await call(asBob, "POST", "/api/user-plugins/p1/actions/refresh", {});
    expect(bobCall.status).toBe(200);
    expect(bobCall.data).toEqual({ ok: true, by: BOB });

    // alice 调同一个 action：键里 userId 不同，查不到 → 404
    const aliceCall = await call(asAlice, "POST", "/api/user-plugins/p1/actions/refresh", {});
    expect(aliceCall.status).toBe(404);
  });

  it("插件未运行时动作端点返回 400", async () => {
    const asAlice = await listen(makeApp(ALICE)); // 无 actions 表
    expect((await call(asAlice, "POST", "/api/user-plugins/p1/actions/refresh", {})).status).toBe(400);
  });

  it("未登录访问被拒（401）", async () => {
    const anon = await listen(makeApp(undefined));
    expect((await call(anon, "GET", "/api/user-plugins")).status).toBe(401);
    expect((await call(anon, "GET", "/api/user-plugins/p1/config")).status).toBe(401);
    expect((await call(anon, "POST", "/api/user-plugins/p1/actions/x", {})).status).toBe(401);
  });
});