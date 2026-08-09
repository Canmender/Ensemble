import { describe, expect, it } from "vitest";
import { splitIntoAtomicGroups } from "../src/context/manager";
import { estimateTokens } from "../src/adapters/builtin/context";
import type { LLMMessage } from "../src/llm/types";

describe("estimateTokens", () => {
  it("估算中文≈1token/字、ASCII≈1token/4字符", () => {
    expect(estimateTokens("你好世界")).toBe(4);
    expect(estimateTokens("abcd")).toBe(1);
  });
});

describe("splitIntoAtomicGroups", () => {
  it("assistant+tool_calls 与后续 tool 结果合并为一组", () => {
    const msgs: LLMMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "thinking", tool_calls: [{ id: "c1", name: "web_search", input: { q: "x" } }] },
      { role: "tool", tool_call_id: "c1", content: "result1" },
      { role: "assistant", content: "final" },
    ];
    const groups = splitIntoAtomicGroups(msgs);
    expect(groups.length).toBe(4);
    // 第 3 组是 assistant + tool 的原子对
    expect(groups[2]).toEqual([msgs[2], msgs[3]]);
  });

  it("不切断 tool_call 与其结果", () => {
    const msgs: LLMMessage[] = [
      { role: "assistant", content: "", tool_calls: [{ id: "c1", name: "t", input: {} }] },
      { role: "tool", tool_call_id: "c1", content: "r" },
      { role: "user", content: "next" },
    ];
    const groups = splitIntoAtomicGroups(msgs);
    const assistantGroup = groups.find((g) => g[0]?.role === "assistant");
    expect(assistantGroup).toHaveLength(2);
  });
});
