import { describe, it, expect } from "vitest";
import { PluginHost } from "./kernel";
import { EventBus, isPluginListenable, isPluginNamespaced } from "./events";
import { RouterRegistry } from "./routers";

/**
 * R3 验收（研究任务书）：
 * - waterfallAsync 异步短路：返回 {approved} 即决策（false 也是决策——包对象语义）、
 *   undefined 交下游、无监听器走 fallback、监听器异常不中断管线
 * - chat/message 事件链路：emit 后观察者收到的载荷与 engine 直调 hub 的帧字段一致
 * - 插件事件权限面：白名单前缀 + 命名空间 emit
 * - RouterRegistry：顺序挂载 + 重复路径拒绝
 */

describe("EventBus tool/confirm 异步短路", () => {
  it("监听器返回 {approved:false} 是有效决策（短路，不走 fallback）", async () => {
    const host = new PluginHost();
    const bus = new EventBus(host);
    await host.register({
      name: "auto-deny",
      install: (ctx) => ctx.on("tool/confirm", (_p, next) => {
        void next;
        return { approved: false };
      }),
    });
    let fallbackCalled = false;
    const result = await bus.requestToolConfirm({ runId: "r", tool: "exec", args: {} }, async () => {
      fallbackCalled = true;
      return true;
    });
    expect(result).toBe(false);
    expect(fallbackCalled).toBe(false);
  });

  it("无监听器走 fallback（WS 弹窗等用户）", async () => {
    const host = new PluginHost();
    const bus = new EventBus(host);
    const result = await bus.requestToolConfirm({ runId: "r", tool: "exec", args: {} }, async () => true);
    expect(result).toBe(true);
  });

  it("监听器返回 undefined 交给下游；异常监听器不中断管线", async () => {
    const host = new PluginHost();
    const bus = new EventBus(host);
    await host.register({
      name: "broken",
      install: (ctx) => ctx.on("tool/confirm", () => {
        throw new Error("policy crashed");
      }),
    });
    await host.register({
      name: "approver",
      install: (ctx) => ctx.on("tool/confirm", () => ({ approved: true })),
    });
    const result = await bus.requestToolConfirm({ runId: "r", tool: "exec", args: {} }, async () => false);
    expect(result).toBe(true);
  });
});

describe("chat/message 帧一致性", () => {
  it("事件链路观察者收到的载荷字段与原 hub 直调帧一致", async () => {
    const host = new PluginHost();
    const bus = new EventBus(host);
    const received: unknown[] = [];
    await host.register({
      name: "chat-broadcaster",
      install: (ctx) => ctx.on("chat/message", (p) => {
        received.push(p);
        return undefined; // 观察者委托下游
      }),
    });
    // 模拟 engine.emit 的载荷形态（engine.broadcastChatMessage 构造的 payload）
    bus.emit("chat/message", {
      runId: "run-1", jobId: "job-1", agentId: "agent-a", role: "assistant",
      content: "hello", attachment: undefined, id: "msg-1", seq: 7, userId: "u1",
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      runId: "run-1", id: "msg-1", seq: 7, agentId: "agent-a", content: "hello",
    });
  });

  it("多观察者按注册序都收到（waterfall 观察语义）", async () => {
    const host = new PluginHost();
    const bus = new EventBus(host);
    const order: string[] = [];
    await host.register({ name: "a", install: (ctx) => ctx.on("device/status", () => { order.push("a"); }) });
    await host.register({ name: "b", install: (ctx) => ctx.on("device/status", () => { order.push("b"); }) });
    bus.emit("device/status", { userId: "u", device: { id: "d", name: "n", type: "mobile" }, online: true });
    await new Promise<void>((r) => setTimeout(r, 0)); // emit 是 fire-and-forget，让异步分发排空
    expect(order).toEqual(["a", "b"]);
  });
});

describe("插件事件权限面", () => {
  it("白名单前缀判定", () => {
    expect(isPluginListenable("chat/message")).toBe(true);
    expect(isPluginListenable("run/started")).toBe(true);
    expect(isPluginListenable("device/status")).toBe(true);
    expect(isPluginListenable("internal/service")).toBe(false);
    expect(isPluginListenable("tool/confirm")).toBe(false); // HITL 决策面不对插件开放
  });

  it("插件 emit 必须带自己的命名空间前缀", () => {
    expect(isPluginNamespaced("poll", "poll/updated")).toBe(true);
    expect(isPluginNamespaced("poll", "chat/message")).toBe(false);
  });
});

describe("RouterRegistry", () => {
  it("按注册序返回且拒绝重复路径", () => {
    const reg = new RouterRegistry();
    reg.register("/api/a", {} as never);
    reg.register("/api/b", {} as never);
    expect(reg.list().map((e) => e.path)).toEqual(["/api/a", "/api/b"]);
    expect(() => reg.register("/api/a", {} as never)).toThrow(/重复/);
  });
});
