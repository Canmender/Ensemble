import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../db/sqlite";
import { Store } from "./store";
import { OrchestrationEngine } from "./engine";
import { WsHub } from "../api/ws/hub";
import type { AgentAdapter, AgentTaskInput } from "../adapters/types";

const caps = {
  sessionResume: true,
  partialStreaming: true,
  toolUseEvents: false,
  concurrent: true,
  cwdConfigurable: true,
};

function makeAdapter(result = "最终结论"): AgentAdapter {
  return {
    kind: "builtin",
    capabilities: caps,
    async *startTask(_input: AgentTaskInput) {
      yield { type: "output", kind: "text", text: "思考中…", ts: Date.now() };
      yield {
        type: "done",
        outcome: "success",
        result,
        usage: { inputTokens: 10, outputTokens: 5 },
        sessionId: "sess-1",
        ts: Date.now(),
      };
    },
    async cancel() {},
    async dispose() {},
  };
}

/** 临时 DB + fake adapter 的编排引擎测试（验证 single 模式执行链路） */
function makeEngine(adapter?: AgentAdapter) {
  const dir = mkdtempSync(join(tmpdir(), "ensemble-engine-"));
  const db = openDb(join(dir, "test.db"));
  const store = new Store(db);
  const hub = new WsHub();

  const a = adapter ?? makeAdapter();
  const registry = { get: () => a, has: () => true } as never;
  const engine = new OrchestrationEngine(store, registry as any, hub, () => undefined);
  engine.setAgents([{ id: "agent-a", name: "Agent A", kind: "builtin", enabled: true } as never]);

  return { store, hub, engine, dir, db };
}

const setups: Array<{ dir: string; db: ReturnType<typeof openDb> }> = [];
afterEach(() => {
  for (const s of setups.splice(0)) {
    try {
      s.db.close();
    } catch {
      /* already closed */
    }
    rmSync(s.dir, { recursive: true, force: true });
  }
});

function setup(adapter?: AgentAdapter): ReturnType<typeof makeEngine> {
  const s = makeEngine(adapter);
  setups.push({ dir: s.dir, db: s.db });
  return s;
}

describe("OrchestrationEngine single mode", () => {
  it("executes a single-agent task to completion with result", async () => {
    const { store, hub, engine } = setup();

    const run = await engine.createAndExecuteTask("单聊测试", {
      mode: "single",
      prompt: "你好",
      agentIds: ["agent-a"],
    });
    expect(run.status).toBe("queued");

    // 事件驱动等待 run 完成
    const ev = await hub.waitForRun(
      run.id,
      (e) => e.type === "run.status" && e.status === "success",
      5000,
    );
    expect(ev?.type).toBe("run.status");

    const finalRun = store.getRun(run.id);
    expect(finalRun?.status).toBe("success");
    expect(finalRun?.finalResult).toBe("最终结论");

    // job 落库且带结果
    const jobs = store.hydrateJobEvents(store.getJobs(run.id));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("success");
    expect(jobs[0].result).toBe("最终结论");
    expect(jobs[0].sessionId).toBe("sess-1");

    // 事件流包含 output + done
    expect(jobs[0].events.some((e) => e.type === "output")).toBe(true);
    expect(jobs[0].events.some((e) => e.type === "done")).toBe(true);
    hub.close();
  });

  it("marks the run as error when the adapter throws", async () => {
    const { store, hub, engine } = setup({
      kind: "builtin",
      capabilities: caps,
      async *startTask() {
        throw new Error("adapter exploded");
      },
      async cancel() {},
      async dispose() {},
    });

    const run = await engine.createAndExecuteTask("失败任务", {
      mode: "single",
      prompt: "hi",
      agentIds: ["agent-a"],
    });

    const ev = await hub.waitForRun(
      run.id,
      (e) => e.type === "run.status" && (e.status === "error" || e.status === "cancelled"),
      5000,
    );
    expect(ev?.type).toBe("run.status");
    expect(store.getRun(run.id)?.status).toBe("error");
    hub.close();
  });

  it("marks the run as error when the stream ends without a done event", async () => {
    const { store, hub, engine } = setup({
      kind: "builtin",
      capabilities: caps,
      async *startTask() {
        yield { type: "output", kind: "text", text: "没有收尾", ts: Date.now() };
        // 不产生 done 事件
      },
      async cancel() {},
      async dispose() {},
    });

    const run = await engine.createAndExecuteTask("未完成", {
      mode: "single",
      prompt: "hi",
      agentIds: ["agent-a"],
    });

    const ev = await hub.waitForRun(
      run.id,
      (e) => e.type === "run.status" && (e.status === "error" || e.status === "cancelled"),
      5000,
    );
    expect(ev?.type).toBe("run.status");
    expect(store.getRun(run.id)?.status).toBe("error");

    // job 也应标记 error（stream ended without a done event）
    const jobs = store.getJobs(run.id);
    expect(jobs[0].status).toBe("error");
    hub.close();
  });
});
