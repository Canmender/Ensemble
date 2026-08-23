import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { openDb } from "../db/sqlite";
import { PluginHost } from "./kernel";
import { PerUserPluginManager, USER_TIMER_CAP, type CandidatePlugin } from "./per-user";
import { PluginUserKv } from "./user-kv";

/**
 * R4 验收试金石（研究任务书）：
 * - 多租户隔离：用户 A disable 插件 → A 作用域内副作用消失；B 的实例不受影响
 * - KV 三元键隔离：插件拿不到别的 (userId, pluginId) 命名空间的数据
 * - timer 闸门：每用户累计 scheduled 超上限时 enable 拒绝
 */

function makeDb(): ReturnType<typeof openDb> {
  return openDb(join(mkdtempSync(join(tmpdir(), "peruser-test-")), "t.db"));
}

/** 测试插件：安装即起一个 interval（effect 化），并记录到全局哨兵 */
const tickPlugin: CandidatePlugin = {
  manifest: { id: "ticker", name: "Ticker", version: "0.1.0", scheduled: 1, eventsOn: [] },
  create: (runtime) => ({
    install: (ctx) => {
      ctx.effect(() => {
        const t = setInterval(() => {}, 60_000);
        t.unref?.();
        runtime.kv.set("mountedAt", Date.now());
        return () => clearInterval(t);
      }, "tick");
    },
  }),
};

describe("PerUserPluginManager 多租户隔离", () => {
  let db: ReturnType<typeof openDb>;
  let host: PluginHost;
  let mgr: PerUserPluginManager;

  beforeAll(() => {
    db = makeDb();
    host = new PluginHost();
    mgr = new PerUserPluginManager(host, db, (u, p) => new PluginUserKv(db, u, p));
    mgr.registerCandidate(tickPlugin);
  });

  it("A 启用后实例 active，命名空间化注册", async () => {
    const r = await mgr.enable("alice", "ticker");
    expect(r.ok).toBe(true);
    expect(host.statusOf("user:alice:ticker").status).toBe("active");
    expect(mgr.listForUser("alice")[0]).toMatchObject({ id: "ticker", enabled: true });
  });

  it("B 独立实例：与 A 同名插件互不影响（多租户核心）", async () => {
    const r = await mgr.enable("bob", "ticker");
    expect(r.ok).toBe(true);
    // 两个独立实例（不同命名空间）
    expect(host.statusOf("user:bob:ticker").status).toBe("active");
    expect(host.list().filter((n) => n.endsWith(":ticker"))).toHaveLength(2);
  });

  it("A disable 后其作用域内副作用消失，B 不受影响（验收试金石）", async () => {
    await mgr.disable("alice", "ticker");
    expect(host.statusOf("user:alice:ticker").status).toBe("unknown"); // 实例已卸载
    expect(mgr.listForUser("alice")[0].enabled).toBe(false);
    expect(host.statusOf("user:bob:ticker").status).toBe("active"); // B 零感知
  });

  it("KV 三元键隔离：同名插件各用户的数据互不可见", async () => {
    const aliceKv = new PluginUserKv(db, "alice", "ticker");
    const bobKv = new PluginUserKv(db, "bob", "ticker");
    aliceKv.set("secret", "alice-data");
    expect(bobKv.get("secret")).toBeUndefined();
    expect(bobKv.get<string>("secret")).toBeUndefined();
    // 同一用户不同插件的键也隔离
    const other = new PluginUserKv(db, "alice", "other");
    expect(other.get("secret")).toBeUndefined();
    // 自己可见 + list 只含自己（mountedAt 是 ticker 实例此前挂载时写入的）
    expect(aliceKv.get("secret")).toBe("alice-data");
    expect(Object.keys(aliceKv.list())).toContain("secret");
  });

  it("timer 闸门：每用户累计超上限拒绝启用", async () => {
    // manifest schema 上限 scheduled=5/插件；注册 4 个 heavy(5×4=20) 占满 carol 的配额
    for (let i = 0; i < 4; i++) {
      mgr.registerCandidate({
        manifest: { id: `heavy-${i}`, name: `Heavy${i}`, version: "0.1.0", scheduled: USER_TIMER_CAP / 4, eventsOn: [] },
        create: (runtime) => ({ install: (ctx) => void ctx }),
      });
      await mgr.enable("carol", `heavy-${i}`);
    }
    const r2 = await mgr.enable("carol", "ticker");
    expect(r2.ok).toBe(false);
    expect(r2.error).toContain("上限");
    // 其他用户不受 carol 占用影响
    const r3 = await mgr.enable("dave", "ticker");
    expect(r3.ok).toBe(true);
  });

  it("配置热重启：setConfig 后实例带新配置重挂", async () => {
    const echoPlugin: CandidatePlugin = {
      manifest: { id: "echo", name: "Echo", version: "0.1.0", scheduled: 0, eventsOn: [] },
      create: (runtime) => ({
        install: (ctx) => {
          // 把生效配置写进自己的 kv 命名空间（供断言读取）
          runtime.kv.set("effectiveConfig", runtime.config);
        },
      }),
    };
    mgr.registerCandidate(echoPlugin);
    await mgr.enable("erin", "echo");
    expect(mgr.listForUser("erin")[0]?.hasConfig).toBe(false);
    await mgr.setConfig("erin", "echo", { greeting: "hi" });
    expect(mgr.listForUser("erin")[0]?.hasConfig).toBe(true);
    const erinKv = new PluginUserKv(db, "erin", "echo");
    expect(erinKv.get<Record<string, unknown>>("effectiveConfig")).toMatchObject({ greeting: "hi" });
    // 配置持久化：重新读取一致
    expect(mgr.getUserConfig("erin", "echo")).toMatchObject({ greeting: "hi" });
  });
});
