import { describe, expect, it } from "vitest";
import { shouldOffload, previewWithPointer } from "../src/context/offload";

describe("shouldOffload", () => {
  it("超阈值且非豁免工具 → offload", () => {
    expect(shouldOffload("web_fetch", 10000, 8000)).toBe(true);
  });

  it("未超阈值 → 不 offload", () => {
    expect(shouldOffload("web_fetch", 1000, 8000)).toBe(false);
  });

  it("豁免工具即使大也不 offload", () => {
    expect(shouldOffload("read_file", 50000, 8000)).toBe(false);
    expect(shouldOffload("list_dir", 20000, 8000)).toBe(false);
    expect(shouldOffload("execute_command", 30000, 8000)).toBe(false);
  });
});

describe("previewWithPointer", () => {
  it("生成 head + 指针 + tail", () => {
    const content = "A".repeat(100);
    const preview = previewWithPointer(content, "agent-a/off1.txt", 20, 20);
    expect(preview).toContain("AAA");
    expect(preview).toContain("agent-a/off1.txt");
    expect(preview).toContain("中间 60 字符");
  });
});
