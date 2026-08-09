import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/memory/store";

let dir: string;
let store: MemoryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mem-test-"));
  store = new MemoryStore(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("MemoryStore", () => {
  it("appendDaily 与 listDaily", () => {
    store.appendDaily("agent-a", "2026-08-08", "## 2026-08-08\n- fact1\n");
    const daily = store.listDaily("agent-a");
    expect(daily.length).toBe(1);
    expect(daily[0].date).toBe("2026-08-08");
    expect(store.readDaily("agent-a", "2026-08-08")).toContain("fact1");
  });

  it("rotate 清理过期 daily", () => {
    store.appendDaily("agent-a", "2026-01-01", "old\n");
    store.appendDaily("agent-a", "2026-08-08", "new\n");
    const removed = store.rotate("agent-a", 90);
    expect(removed).toBe(1);
    expect(store.readDaily("agent-a", "2026-01-01")).toBeUndefined();
    expect(store.readDaily("agent-a", "2026-08-08")).toBeDefined();
  });

  it("writeMemoryFile + snapshot 返回 MEMORY.md", () => {
    store.writeMemoryFile("agent-a", "# 长期记忆\n- x");
    const snap = store.snapshot("agent-a");
    expect(snap.memoryFile?.content).toContain("长期记忆");
    expect(snap.dailyLogs).toEqual([]);
  });

  it("addUsage 累计遥测", () => {
    store.addUsage("agent-a", 100);
    store.addUsage("agent-a", 50);
    const snap = store.snapshot("agent-a");
    expect(snap.stats.memUsageTokens).toBe(150);
  });

  it("clear 删除全部", () => {
    store.writeMemoryFile("agent-a", "x");
    store.clear("agent-a");
    expect(existsSync(join(dir, "agent-a"))).toBe(false);
  });
});
