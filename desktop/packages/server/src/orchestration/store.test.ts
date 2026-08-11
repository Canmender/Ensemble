import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../db/sqlite";
import { Store } from "./store";
import type { Task, Run, Job, ChatMessage, Conversation, WorkflowDef } from "@ensemble/shared";

/** 临时文件 DB 的 Store 测试（验证 SQLite 持久层 CRUD、seq 分配、级联删除） */
function makeStore(): { store: Store; db: ReturnType<typeof openDb>; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "ensemble-store-"));
  const db = openDb(join(dir, "test.db"));
  return { store: new Store(db), db, dir };
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

function setup(): ReturnType<typeof makeStore> {
  const s = makeStore();
  setups.push({ dir: s.dir, db: s.db });
  return s;
}

const ev = (text: string) => ({ type: "output" as const, kind: "text" as const, text, ts: 1735689600000 });

const task = (id: string): Task => ({
  id,
  title: `任务 ${id}`,
  mode: "single",
  input: { mode: "single", prompt: "hi", agentIds: ["a"] },
  createdAt: "2026-01-01T00:00:00.000Z",
});

const run = (id: string, taskId: string): Run => ({
  id,
  taskId,
  mode: "single",
  status: "queued",
  startedAt: "2026-01-01T00:00:00.000Z",
  taskTitle: "任务",
});

const job = (id: string, runId: string, seq: number): Job => ({
  id,
  runId,
  seq,
  agentId: "agent-a",
  agentName: "Agent A",
  prompt: "prompt",
  status: "queued",
  events: [],
  startedAt: "2026-01-01T00:00:00.000Z",
});

// ── Task CRUD ───────────────────────────────────────────────────────────────

describe("Store task CRUD", () => {
  it("creates, lists, and gets a task", () => {
    const { store } = setup();

    store.createTask(task("t1"));
    store.createTask(task("t2"));

    expect(store.listTasks()).toHaveLength(2);
    expect(store.getTask("t1")?.title).toBe("任务 t1");
    // input JSON 往返
    expect(store.getTask("t1")?.input).toEqual(task("t1").input);
  });

  it("deletes a task", () => {
    const { store } = setup();
    store.createTask(task("t1"));
    store.deleteTask("t1");
    expect(store.getTask("t1")).toBeUndefined();
  });

  it("cascades deletion to runs, jobs and events", () => {
    const { store } = setup();

    store.createTask(task("t1"));
    store.createRun(run("r1", "t1"));
    store.createJob(job("j1", "r1", 1));
    store.appendRunEvent("r1", "j1", ev("hello"));

    store.deleteTask("t1");
    expect(store.getTask("t1")).toBeUndefined();
    expect(store.getRun("r1")).toBeUndefined();
    expect(store.getJobs("r1")).toHaveLength(0);
    expect(store.getRunEvents("r1")).toHaveLength(0);
  });
});

// ── Run CRUD ────────────────────────────────────────────────────────────────

describe("Store run CRUD", () => {
  it("creates and updates a run", () => {
    const { store } = setup();

    store.createTask(task("t1"));
    store.createRun(run("r1", "t1"));

    store.updateRun("r1", { status: "success", finalResult: "ok", endedAt: "2026-01-01T00:01:00.000Z" });
    const r = store.getRun("r1");
    expect(r?.status).toBe("success");
    expect(r?.finalResult).toBe("ok");
    expect(r?.endedAt).toBe("2026-01-01T00:01:00.000Z");
  });

  it("lists runs with filters", () => {
    const { store } = setup();

    store.createTask(task("t1"));
    store.createRun({ ...run("r1", "t1"), status: "running" });
    store.createRun({ ...run("r2", "t1"), status: "success" });

    expect(store.listRuns({ status: "running" })).toHaveLength(1);
    expect(store.listRuns({ taskId: "t1" })).toHaveLength(2);
    expect(store.listRuns({ mode: "workflow" })).toHaveLength(0);
  });
});

// ── Job CRUD ────────────────────────────────────────────────────────────────

describe("Store job CRUD", () => {
  it("creates, updates, and lists jobs by run", () => {
    const { store } = setup();

    store.createTask(task("t1"));
    store.createRun(run("r1", "t1"));
    store.createJob(job("j1", "r1", 1));
    store.createJob(job("j2", "r1", 2));

    store.updateJob("j1", { status: "running", result: "部分结果" });
    const jobs = store.getJobs("r1");
    expect(jobs).toHaveLength(2);
    expect(jobs.find((j) => j.id === "j1")?.status).toBe("running");
    expect(jobs.find((j) => j.id === "j1")?.result).toBe("部分结果");
  });

  it("hydrates job events", () => {
    const { store } = setup();

    store.createTask(task("t1"));
    store.createRun(run("r1", "t1"));
    store.createJob(job("j1", "r1", 1));
    store.appendRunEvent("r1", "j1", ev("a"));
    store.appendRunEvent("r1", "j1", ev("b"));

    const [hydrated] = store.hydrateJobEvents(store.getJobs("r1"));
    expect(hydrated.events).toHaveLength(2);
    expect((hydrated.events[1] as { text: string }).text).toBe("b");
  });
});

// ── Run events / seq 分配 ───────────────────────────────────────────────────

describe("Store run events and seq allocation", () => {
  it("assigns monotonically increasing seq per run", () => {
    const { store } = setup();

    store.createTask(task("t1"));
    store.createRun(run("r1", "t1"));

    const s1 = store.nextEventSeq("r1");
    const s2 = store.nextEventSeq("r1");
    expect(s2).toBe(s1 + 1);
  });

  it("appends events atomically and reads after a seq", () => {
    const { store } = setup();

    store.createTask(task("t1"));
    store.createRun(run("r1", "t1"));
    store.createJob(job("j1", "r1", 1));

    store.appendRunEvent("r1", "j1", ev("one"));
    store.appendRunEvent("r1", "j1", ev("two"));
    const s3 = store.appendRunEvent("r1", "j1", ev("three"));
    expect(s3).toBe(3);

    const after = store.getRunEvents("r1", 2);
    expect(after).toHaveLength(1);
    expect((after[0].event as { text: string }).text).toBe("three");
    expect(after[0].seq).toBe(3);
  });

  it("allocates job seq per run independently", () => {
    const { store } = setup();

    store.createTask(task("t1"));
    store.createRun(run("r1", "t1"));
    store.createRun(run("r2", "t1"));

    expect(store.nextJobSeq("r1")).toBe(1);
    expect(store.nextJobSeq("r1")).toBe(2);
    expect(store.nextJobSeq("r2")).toBe(1); // 独立 run
  });
});

// ── Chat messages ───────────────────────────────────────────────────────────

describe("Store chat messages", () => {
  it("creates and lists messages in ts order", () => {
    const { store } = setup();

    store.createTask(task("t1"));
    store.createRun(run("r1", "t1"));

    const msg = (id: string, role: "user" | "assistant", ts: string): ChatMessage => ({
      id, runId: "r1", jobId: "j1", agentId: role, role, content: "内容", ts,
    });
    store.createChatMessage(msg("m1", "assistant", "2026-01-01T00:00:02.000Z"));
    store.createChatMessage(msg("m2", "user", "2026-01-01T00:00:01.000Z"));

    const msgs = store.listChatMessages("r1");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].id).toBe("m2"); // ts 升序
  });
});

// ── Workflows ───────────────────────────────────────────────────────────────

describe("Store workflows", () => {
  it("inserts and updates a workflow", () => {
    const { store } = setup();

    const wf = (name: string): WorkflowDef => ({
      id: "wf-1",
      name,
      nodes: [{ id: "n1", agentId: "a", prompt: "p" }],
      edges: [],
    });

    store.saveWorkflow(wf("旧名"));
    expect(store.getWorkflow("wf-1")?.name).toBe("旧名");

    store.saveWorkflow(wf("新名"));
    expect(store.getWorkflow("wf-1")?.name).toBe("新名");
    expect(store.listWorkflows()).toHaveLength(1); // update 而非重复插入
  });

  it("deletes a workflow", () => {
    const { store } = setup();
    store.saveWorkflow({ id: "wf-1", name: "W", nodes: [{ id: "n1", agentId: "a", prompt: "p" }], edges: [] });
    store.deleteWorkflow("wf-1");
    expect(store.getWorkflow("wf-1")).toBeUndefined();
  });
});

// ── Conversations ───────────────────────────────────────────────────────────

describe("Store conversations", () => {
  const conv = (id: string, runId: string): Conversation => ({
    id,
    userId: "u1",
    type: "direct",
    participantIds: ["agent-a"],
    runId,
    unread: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  it("creates and lists conversations for a user", () => {
    const { store } = setup();
    store.createConversation(conv("c1", "r1"));
    store.createConversation({ ...conv("c2", "r2"), userId: "u2" });

    const mine = store.listConversations("u1");
    expect(mine.some((c) => c.id === "c1")).toBe(true);
    expect(mine.some((c) => c.id === "c2")).toBe(false);
  });

  it("updates lastMessage metadata and unread", () => {
    const { store } = setup();
    store.createConversation(conv("c1", "r1"));

    store.updateConversationMeta("c1", "hello", "2026-01-01T00:01:00.000Z");
    const c = store.getConversation("c1");
    expect(c?.lastMessage).toBe("hello");
    expect(c?.lastMessageTs).toBe("2026-01-01T00:01:00.000Z");

    store.incrementUnread("c1");
    store.incrementUnread("c1");
    expect(store.getConversation("c1")?.unread).toBe(2);

    store.markRead("c1");
    expect(store.getConversation("c1")?.unread).toBe(0);
  });

  it("looks up conversation by run id", () => {
    const { store } = setup();
    store.createConversation(conv("c1", "run-xyz"));
    expect(store.getConversationByRunId("run-xyz")?.id).toBe("c1");
    expect(store.getConversationByRunId("nope")).toBeUndefined();
  });

  it("deletes a conversation", () => {
    const { store } = setup();
    store.createConversation(conv("c1", "r1"));
    store.deleteConversation("c1");
    expect(store.getConversation("c1")).toBeUndefined();
  });
});
