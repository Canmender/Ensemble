import { describe, it, expect } from "vitest";
import { PluginHost, type EnsemblePlugin } from "./kernel";

/**
 * 插件内核契约测试（对齐 cordis 测试钉死的语义，见 docs/技术调研/Cordis源码深度解析.md）：
 * - fail-closed：未注册服务读取抛错
 * - 失败插件副作用自动回滚
 * - 卸载逆序清理 + 级联卸载依赖方 + 服务随所有权移除
 * - waterfall 环绕中间件（next 委托 / 短路 / 顺序）
 */

function makePlugin(name: string, opts: Partial<EnsemblePlugin> = {}): EnsemblePlugin {
  return { name, install: () => {}, ...opts };
}

describe("PluginHost 服务容器", () => {
  it("fail-closed: get 未注册服务抛错，tryGet 返回 undefined", async () => {
    const host = new PluginHost();
    let thrown = false;
    await host.register({
      name: "p",
      install: (ctx) => {
        try {
          ctx.get("nope");
        } catch {
          thrown = true;
        }
      },
    });
    expect(thrown).toBe(true);
  });

  it("provide 后依赖方可通过 inject 拿到服务；同名覆盖替换实现", async () => {
    const host = new PluginHost();
    await host.register({
      name: "storage",
      install: (ctx) => ctx.provide("storage", { kind: "sqlite" }),
    });
    let seen = "";
    await host.register({
      name: "consumer",
      inject: ["storage"],
      install: (ctx) => {
        seen = (ctx.get<{ kind: string }>("storage") as { kind: string }).kind;
      },
    });
    expect(seen).toBe("sqlite");

    // 替换实现 → 旧 consumer 被级联卸载（unregister 移除状态 → unknown）
    await host.register({
      name: "storage",
      install: (ctx) => ctx.provide("storage", { kind: "json" }),
    });
    expect(host.statusOf("consumer").status).toBe("unknown");
    await host.register({
      name: "consumer",
      inject: ["storage"],
      install: (ctx) => {
        seen = (ctx.get<{ kind: string }>("storage") as { kind: string }).kind;
      },
    });
    expect(seen).toBe("json");
  });

  it("缺必需依赖时注册失败且状态可查询", async () => {
    const host = new PluginHost();
    const ok = await host.register(makePlugin("orphan", { inject: ["missing"] }));
    expect(ok).toBe(false);
    expect(host.statusOf("orphan").status).toBe("inactive");
  });
});

describe("PluginHost effect 可逆副作用", () => {
  it("install 失败时已登记副作用自动回滚", async () => {
    const host = new PluginHost();
    const disposed: string[] = [];
    const ok = await host.register({
      name: "halfway",
      install: (ctx) => {
        ctx.effect(() => disposed.push("e1"), "e1");
        ctx.effect(() => () => disposed.push("e1-disposed"), "e2");
        throw new Error("boom");
      },
    });
    expect(ok).toBe(false);
    // 回滚只调用 disposer：e1 的 execute 已执行（push "e1"），e2 的 disposer 被逆序触发
    expect(disposed).toEqual(["e1", "e1-disposed"]);
    // 半成品提供的服务也被撤走
    expect(host.getServiceNames()).not.toContain("x");
  });

  it("unregister 逆序清理 disposer", async () => {
    const host = new PluginHost();
    const order: string[] = [];
    await host.register({
      name: "p",
      install: (ctx) => {
        ctx.effect(() => () => order.push("first"), "a");
        ctx.effect(() => () => order.push("second"), "b");
      },
    });
    await host.unregister("p");
    expect(order).toEqual(["second", "first"]); // LIFO
  });

  it("unregister 移除本插件提供的服务并级联卸载依赖方", async () => {
    const host = new PluginHost();
    await host.register({ name: "svc", install: (ctx) => ctx.provide("db", {}) });
    await host.register({ name: "app", inject: ["db"], install: () => {} });
    expect(host.list().sort()).toEqual(["app", "svc"]);

    await host.unregister("svc");
    expect(host.list()).toEqual([]);
    expect(host.getServiceNames()).not.toContain("db");
  });
});

describe("PluginHost waterfall 管线", () => {
  it("环绕中间件：next() 委托下游并包装返回值", async () => {
    const host = new PluginHost();
    await host.register({
      name: "outer",
      install: (ctx) => ctx.on("message", (p, next) => `[w:${next()}]`),
    });
    await host.register({
      name: "inner",
      install: (ctx) => ctx.on("message", (p) => `core(${p})`),
    });
    const out = host.waterfall<string, string>("message", "hi", () => "builtin");
    expect(out).toBe("[w:core(hi)]");
  });

  it("不调用 next 即短路（否决）", async () => {
    const host = new PluginHost();
    await host.register({
      name: "gate",
      install: (ctx) => ctx.on("send", (p, _next) => "blocked", { prepend: true }),
    });
    const out = host.waterfall<string, string>("send", "msg", () => "sent");
    expect(out).toBe("blocked");
  });

  it("无监听器走 fallback 内置行为", () => {
    const host = new PluginHost();
    const out = host.waterfall<string, string>("any", "x", () => "default");
    expect(out).toBe("default");
  });
});
