import { describe, expect, it, vi } from "vitest";
import { HookManager } from "../src/hooks/manager";
import type { LoopContext, LoopHook } from "../src/hooks/types";
import type { LLMMessage } from "../src/llm/types";

function makeCtx(): LoopContext {
  return {
    provider: {} as any,
    model: "test",
    agentId: "agent-1",
    msgs: [] as LLMMessage[],
    llmTools: [],
    vars: {},
  };
}

describe("HookManager", () => {
  it("按注册序执行事件", async () => {
    const order: string[] = [];
    const h1: LoopHook = { name: "a", preReasoning: () => void order.push("a") };
    const h2: LoopHook = { name: "b", preReasoning: () => void order.push("b") };
    const m = new HookManager();
    m.add(h1);
    m.add(h2);
    await m.run("preReasoning", makeCtx());
    expect(order).toEqual(["a", "b"]);
  });

  it("onError 短路返回首个 retry", async () => {
    const h1: LoopHook = {
      name: "a",
      onError: () => ({ retry: false }),
    };
    const h2: LoopHook = {
      name: "b",
      onError: () => ({ retry: true, reason: "recover" }),
    };
    const m = new HookManager();
    m.add(h1);
    m.add(h2);
    const res = await m.runError(makeCtx(), new Error("boom"));
    expect(res?.retry).toBe(true);
  });

  it("remove 后不再执行", async () => {
    const fn = vi.fn();
    const m = new HookManager();
    const off = m.add({ name: "x", preReasoning: fn });
    off();
    await m.run("preReasoning", makeCtx());
    expect(fn).not.toHaveBeenCalled();
  });
});
