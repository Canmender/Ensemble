import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigManager } from "./appContext";
import type { ServerEnv } from "./config/env";

/** 临时目录的 ConfigManager 测试：验证 async 写 + mutex 串行化 + 内存缓存 */
function makeConfig(): { cm: ConfigManager; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "ensemble-config-"));
  const env: ServerEnv = {
    port: 8787,
    dbPath: join(dir, "test.db"),
    configDir: join(dir, "config"),
    hermesUseWsl: false,
    hermesWslDistro: "",
  };
  return { cm: new ConfigManager(env), dir };
}

const dirs: string[] = [];

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

afterEach(() => {
  for (const d of dirs.splice(0)) cleanup(d);
});

/** 最小合法 agent input（含 schema 必填的 capabilities/enabled） */
function testAgent(id: string, name: string) {
  return {
    id,
    name,
    kind: "builtin" as const,
    enabled: true,
    capabilities: {
      sessionResume: true,
      partialStreaming: true,
      toolUseEvents: false,
      concurrent: true,
      cwdConfigurable: true,
    },
  };
}

// ── Agent CRUD ──────────────────────────────────────────────────────────────

describe("ConfigManager agent CRUD (async)", () => {
  it("creates an agent, persists to yaml, and reflects in cache", async () => {
    const { cm, dir } = makeConfig();
    dirs.push(dir);

    await cm.createAgent(testAgent("test-agent", "测试"));

    expect(cm.listAgents().some((a) => a.id === "test-agent")).toBe(true);
    const file = join(dir, "config", "agents", "test-agent.yaml");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("name: 测试");
  });

  it("updates an existing agent", async () => {
    const { cm, dir } = makeConfig();
    dirs.push(dir);

    await cm.createAgent(testAgent("agent-a", "A"));
    const updated = await cm.updateAgent("agent-a", { name: "A-改" });

    expect(updated.name).toBe("A-改");
    expect(cm.getAgent("agent-a")?.name).toBe("A-改");
  });

  it("deletes an agent and its file", async () => {
    const { cm, dir } = makeConfig();
    dirs.push(dir);

    await cm.createAgent(testAgent("agent-a", "A"));
    await cm.deleteAgent("agent-a");

    expect(cm.getAgent("agent-a")).toBeUndefined();
    expect(existsSync(join(dir, "config", "agents", "agent-a.yaml"))).toBe(false);
  });

  it("throws on duplicate agent id", async () => {
    const { cm, dir } = makeConfig();
    dirs.push(dir);

    await cm.createAgent(testAgent("dup", "D"));
    await expect(cm.createAgent(testAgent("dup", "D2"))).rejects.toThrow(/already exists/);
  });

  it("serializes concurrent creates via the write lock", async () => {
    const { cm, dir } = makeConfig();
    dirs.push(dir);

    // 并发创建多个不同 agent（mutex 串行写盘）
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        cm.createAgent(testAgent(`agent-${i}`, `Agent ${i}`)),
      ),
    );

    const ids = cm.listAgents().map((a) => a.id);
    for (let i = 0; i < 5; i++) {
      expect(ids).toContain(`agent-${i}`);
    }
  });
});

// ── Workflow CRUD ───────────────────────────────────────────────────────────

describe("ConfigManager workflow CRUD (async)", () => {
  it("saves and deletes a workflow", async () => {
    const { cm, dir } = makeConfig();
    dirs.push(dir);

    await cm.saveWorkflow({ id: "wf-1", name: "工作流", nodes: [{ id: "n1", agentId: "a", prompt: "p" }], edges: [] });
    expect(cm.getWorkflow("wf-1")).toBeDefined();

    await cm.deleteWorkflow("wf-1");
    expect(cm.getWorkflow("wf-1")).toBeUndefined();
  });

  it("rejects workflow ids with path-traversal characters", async () => {
    const { cm, dir } = makeConfig();
    dirs.push(dir);

    // 无白名单时 "../evil" 会覆写 configDir 外的文件
    await expect(
      cm.saveWorkflow({ id: "../evil", name: "X", nodes: [{ id: "n1", agentId: "a", prompt: "p" }], edges: [] }),
    ).rejects.toThrow();
  });
});

// ── Provider CRUD（缓存） ───────────────────────────────────────────────────

describe("ConfigManager provider CRUD (cached)", () => {
  it("creates a provider and reflects in cached listProviders", async () => {
    const { cm, dir } = makeConfig();
    dirs.push(dir);

    await cm.createProvider({
      id: "openai-main",
      name: "OpenAI",
      type: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      enabled: true,
    });

    const list = cm.listProviders();
    expect(list.some((p) => p.id === "openai-main")).toBe(true);
    // apiKey 不出现在响应
    expect(list.find((p) => p.id === "openai-main")?.apiKey).toBeUndefined();
  });

  it("deletes a provider", async () => {
    const { cm, dir } = makeConfig();
    dirs.push(dir);

    await cm.createProvider({ id: "p-1", name: "P", type: "openai", baseUrl: "http://x", enabled: true });
    await cm.deleteProvider("p-1");
    expect(cm.getProvider("p-1")).toBeUndefined();
  });
});

// ── Settings ────────────────────────────────────────────────────────────────

describe("ConfigManager settings (cached)", () => {
  it("saves settings and returns from cache", async () => {
    const { cm, dir } = makeConfig();
    dirs.push(dir);

    const saved = await cm.saveSettings({ workspaceRoot: "/workspace", codeExecutionConfirm: "always" });
    expect(saved.workspaceRoot).toBe("/workspace");
    // 缓存命中，同步返回
    expect(cm.getSettings().workspaceRoot).toBe("/workspace");
  });

  it("persists settings to disk", async () => {
    const { cm, dir } = makeConfig();
    dirs.push(dir);

    await cm.saveSettings({ codeExecutionConfirm: "never" });
    const raw = JSON.parse(
      readFileSync(join(dir, "config", "settings.json"), "utf8"),
    ) as { codeExecutionConfirm: string };
    expect(raw.codeExecutionConfirm).toBe("never");
  });
});
