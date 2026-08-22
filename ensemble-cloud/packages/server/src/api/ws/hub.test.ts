import { describe, it, expect } from "vitest";
import { WsHub } from "./hub";

/**
 * WsHub.waitForRun 单元测试（事件驱动等待，替代忙等待轮询）。
 * broadcast 的同步匹配不依赖 WebSocket 连接，可直接实例化测试。
 */
describe("WsHub.waitForRun", () => {
  it("resolves with the matched event when broadcast", async () => {
    const hub = new WsHub();
    const p = hub.waitForRun("run-1", (ev) => ev.type === "run.status" && ev.status === "success", 5000);

    hub.broadcast("run-1", 0, { type: "run.status", status: "running" }); // 不匹配
    hub.broadcast("run-1", 0, { type: "run.status", status: "success" }); // 匹配

    const ev = await p;
    expect(ev?.type).toBe("run.status");
    if (ev?.type === "run.status") expect(ev.status).toBe("success");
    hub.close();
  });

  it("resolves with an agent chat.message, ignoring user messages", async () => {
    const hub = new WsHub();
    const p = hub.waitForRun("run-1", (ev) => ev.type === "chat.message" && ev.agentId !== "user", 5000);

    hub.broadcast("run-1", 0, { type: "chat.message", jobId: "", agentId: "user", content: "hi" });
    hub.broadcast("run-1", 0, { type: "chat.message", jobId: "", agentId: "researcher", content: "reply" });

    const ev = await p;
    expect(ev?.type).toBe("chat.message");
    if (ev?.type === "chat.message") {
      expect(ev.content).toBe("reply");
      expect(ev.agentId).toBe("researcher");
    }
    hub.close();
  });

  it("does not match events for other runs", async () => {
    const hub = new WsHub();
    let matched = false;
    const p = hub.waitForRun("run-1", () => {
      matched = true;
      return false;
    }, 60);

    hub.broadcast("run-2", 0, { type: "chat.message", jobId: "", agentId: "a", content: "x" });

    const ev = await p;
    expect(ev).toBeNull();
    expect(matched).toBe(false); // 其他 run 的事件不应触发 match
    hub.close();
  });

  it("times out and returns null", async () => {
    const hub = new WsHub();
    const ev = await hub.waitForRun("run-1", () => false, 50);
    expect(ev).toBeNull();
    hub.close();
  });

  it("resolves multiple waiters on the same event", async () => {
    const hub = new WsHub();
    const p1 = hub.waitForRun("run-1", (ev) => ev.type === "run.status" && ev.status === "success", 5000);
    const p2 = hub.waitForRun("run-1", (ev) => ev.type === "run.status" && ev.status === "success", 5000);

    hub.broadcast("run-1", 0, { type: "run.status", status: "success" });

    const [e1, e2] = await Promise.all([p1, p2]);
    expect(e1?.type).toBe("run.status");
    expect(e2?.type).toBe("run.status");
    hub.close();
  });

  it("resolves null for pending waiters on close", async () => {
    const hub = new WsHub();
    const p = hub.waitForRun("run-1", () => true, 60_000);
    hub.close();
    expect(await p).toBeNull();
  });
});
