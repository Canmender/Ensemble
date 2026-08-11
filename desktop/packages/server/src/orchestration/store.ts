import type { DatabaseSync } from "node:sqlite";
import type {
  AgentEvent,
  ChatMessage,
  Job,
  Run,
  Task,
  WorkflowDef,
} from "@ensemble/shared";
import { logger } from "../util/logger";

/**
 * 持久化层：tasks / runs / jobs / run_events / chat_messages / workflows
 * 全部通过 node:sqlite DatabaseSync 同步 API。
 *
 * 性能优化（参考 OpenCode sqlc 模式）：
 * 所有 SQL 语句在构造时一次性 prepare，后续调用直接 bind+run/query，
 * 避免每次操作重复解析 SQL。
 */
export class Store {
  // 内存 seq 计数器（避免每次 appendRunEvent 查询 SELECT MAX）
  private eventSeqCounters = new Map<string, number>();
  private jobSeqCounters = new Map<string, number>();

  // 预编译语句（构造时 prepare，生命周期内复用）
  private stmts: {
    // Tasks
    createTask: ReturnType<DatabaseSync["prepare"]>;
    listTasks: ReturnType<DatabaseSync["prepare"]>;
    getTask: ReturnType<DatabaseSync["prepare"]>;
    deleteTask: ReturnType<DatabaseSync["prepare"]>;
    // Runs
    createRun: ReturnType<DatabaseSync["prepare"]>;
    getRun: ReturnType<DatabaseSync["prepare"]>;
    // Jobs
    createJob: ReturnType<DatabaseSync["prepare"]>;
    getJob: ReturnType<DatabaseSync["prepare"]>;
    getJobs: ReturnType<DatabaseSync["prepare"]>;
    getJobEvents: ReturnType<DatabaseSync["prepare"]>;
    getLatestJobForAgent: ReturnType<DatabaseSync["prepare"]>;
    // Run events
    nextEventSeq: ReturnType<DatabaseSync["prepare"]>;
    nextJobSeq: ReturnType<DatabaseSync["prepare"]>;
    insertRunEvent: ReturnType<DatabaseSync["prepare"]>;
    getRunEvents: ReturnType<DatabaseSync["prepare"]>;
    // Chat messages
    createChatMessage: ReturnType<DatabaseSync["prepare"]>;
    listChatMessages: ReturnType<DatabaseSync["prepare"]>;
    // Workflows
    listWorkflows: ReturnType<DatabaseSync["prepare"]>;
    getWorkflow: ReturnType<DatabaseSync["prepare"]>;
    deleteWorkflow: ReturnType<DatabaseSync["prepare"]>;
  };

  constructor(private db: DatabaseSync) {
    // 一次性 prepare 所有固定 SQL（动态 SQL 如 updateRun/updateJob 仍需即时 prepare）
    this.stmts = {
      // Tasks
      createTask: db.prepare("INSERT INTO tasks (id, title, mode, input_json, created_at) VALUES (?, ?, ?, ?, ?)"),
      listTasks: db.prepare("SELECT * FROM tasks ORDER BY created_at DESC"),
      getTask: db.prepare("SELECT * FROM tasks WHERE id = ?"),
      deleteTask: db.prepare("DELETE FROM tasks WHERE id = ?"),
      // Runs
      createRun: db.prepare("INSERT INTO runs (id, task_id, mode, status, task_title, started_at) VALUES (?, ?, ?, ?, ?, ?)"),
      getRun: db.prepare("SELECT * FROM runs WHERE id = ?"),
      // Jobs
      createJob: db.prepare("INSERT INTO jobs (id, run_id, seq, agent_id, agent_name, prompt, status, parent_job_id, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"),
      getJob: db.prepare("SELECT * FROM jobs WHERE id = ?"),
      getJobs: db.prepare("SELECT * FROM jobs WHERE run_id = ? ORDER BY seq"),
      getJobEvents: db.prepare("SELECT event_json FROM run_events WHERE run_id = ? AND job_id = ? ORDER BY seq"),
      getLatestJobForAgent: db.prepare("SELECT * FROM jobs WHERE run_id = ? AND agent_id = ? ORDER BY seq DESC LIMIT 1"),
      // Run events
      nextEventSeq: db.prepare("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM run_events WHERE run_id = ?"),
      nextJobSeq: db.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM jobs WHERE run_id = ?"),
      insertRunEvent: db.prepare("INSERT INTO run_events (run_id, seq, job_id, event_json, ts) VALUES (?, ?, ?, ?, ?)"),
      getRunEvents: db.prepare("SELECT seq, job_id, event_json FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq"),
      // Chat messages
      createChatMessage: db.prepare("INSERT INTO chat_messages (id, run_id, job_id, agent_id, role, content, ts) VALUES (?, ?, ?, ?, ?, ?, ?)"),
      listChatMessages: db.prepare("SELECT * FROM chat_messages WHERE run_id = ? ORDER BY ts"),
      // Workflows
      listWorkflows: db.prepare("SELECT * FROM workflows ORDER BY name"),
      getWorkflow: db.prepare("SELECT * FROM workflows WHERE id = ?"),
      deleteWorkflow: db.prepare("DELETE FROM workflows WHERE id = ?"),
    };
  }

  // ---------- Tasks ----------
  createTask(task: Task): void {
    this.stmts.createTask.run(task.id, task.title, task.mode, JSON.stringify(task.input), task.createdAt);
  }

  listTasks(): Task[] {
    const rows = this.stmts.listTasks.all() as any[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      mode: r.mode,
      input: JSON.parse(r.input_json),
      createdAt: r.created_at,
    }));
  }

  getTask(id: string): Task | undefined {
    const r = this.stmts.getTask.get(id) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      title: r.title,
      mode: r.mode,
      input: JSON.parse(r.input_json),
      createdAt: r.created_at,
    };
  }

  deleteTask(id: string): void {
    // Cascade delete: child records reference tasks via foreign keys.
    // Delete in order from deepest child to parent to respect FK constraints.
    // chat_messages -> run_events -> jobs -> runs -> task
    const runs = this.db.prepare("SELECT id FROM runs WHERE task_id = ?").all(id) as any[];
    for (const run of runs) {
      this.db.prepare("DELETE FROM chat_messages WHERE run_id = ?").run(run.id);
      this.db.prepare("DELETE FROM run_events WHERE run_id = ?").run(run.id);
      this.db.prepare("DELETE FROM jobs WHERE run_id = ?").run(run.id);
    }
    this.db.prepare("DELETE FROM runs WHERE task_id = ?").run(id);
    this.stmts.deleteTask.run(id);
  }

  // ---------- Runs ----------
  createRun(run: Run): void {
    this.stmts.createRun.run(run.id, run.taskId, run.mode, run.status, run.taskTitle ?? null, run.startedAt);
  }

  updateRun(id: string, patch: Partial<Run>): void {
    const sets: string[] = [];
    const vals: any[] = [];
    if (patch.status !== undefined) { sets.push("status = ?"); vals.push(patch.status); }
    if (patch.endedAt !== undefined) { sets.push("ended_at = ?"); vals.push(patch.endedAt); }
    if (patch.finalResult !== undefined) { sets.push("final_result = ?"); vals.push(patch.finalResult); }
    if (patch.error !== undefined) { sets.push("error = ?"); vals.push(patch.error); }
    if (!sets.length) return;
    vals.push(id);
    // 劯态 SQL：SET 子句因 patch 不同而变化，无法预编译
    this.db.prepare(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  getRun(id: string): Run | undefined {
    const r = this.stmts.getRun.get(id) as any;
    if (!r) return undefined;
    return rowToRun(r);
  }

  listRuns(filter?: { taskId?: string; mode?: string; status?: string }): Run[] {
    const where: string[] = [];
    const vals: any[] = [];
    if (filter?.taskId) { where.push("task_id = ?"); vals.push(filter.taskId); }
    if (filter?.mode) { where.push("mode = ?"); vals.push(filter.mode); }
    if (filter?.status) { where.push("status = ?"); vals.push(filter.status); }
    // 动态 SQL：WHERE 子句因 filter 不同而变化
    const sql = `SELECT * FROM runs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY started_at DESC`;
    const rows = this.db.prepare(sql).all(...vals) as any[];
    return rows.map(rowToRun);
  }

  // ---------- Jobs ----------
  createJob(job: Job): void {
    this.stmts.createJob.run(
      job.id, job.runId, job.seq, job.agentId, job.agentName, job.prompt,
      job.status, job.parentJobId ?? null, job.startedAt ?? new Date().toISOString(),
    );
    // 更新 job seq 计数器
    const currentMax = this.jobSeqCounters.get(job.runId) ?? 0;
    if (job.seq > currentMax) {
      this.jobSeqCounters.set(job.runId, job.seq);
    }
  }

  updateJob(id: string, patch: Partial<Job>): void {
    const sets: string[] = [];
    const vals: any[] = [];
    if (patch.status !== undefined) { sets.push("status = ?"); vals.push(patch.status); }
    if (patch.result !== undefined) { sets.push("result = ?"); vals.push(patch.result); }
    if (patch.error !== undefined) { sets.push("error = ?"); vals.push(patch.error); }
    if (patch.sessionId !== undefined) { sets.push("session_id = ?"); vals.push(patch.sessionId); }
    if (patch.usage !== undefined) { sets.push("usage_json = ?"); vals.push(JSON.stringify(patch.usage)); }
    if (patch.endedAt !== undefined) { sets.push("ended_at = ?"); vals.push(patch.endedAt); }
    if (!sets.length) return;
    vals.push(id);
    // 动态 SQL
    this.db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  getJob(id: string): Job | undefined {
    const r = this.stmts.getJob.get(id) as any;
    if (!r) return undefined;
    return rowToJob(r);
  }

  getJobs(runId: string): Job[] {
    const rows = this.stmts.getJobs.all(runId) as any[];
    return rows.map(rowToJob);
  }

  /** 查询一个 job 的全部事件（按 seq 排序） */
  getJobEvents(runId: string, jobId: string): AgentEvent[] {
    const rows = this.stmts.getJobEvents.all(runId, jobId) as any[];
    return rows.map((r) => JSON.parse(r.event_json) as AgentEvent);
  }

  /** 批量填充 jobs 的事件（避免 N+1） */
  hydrateJobEvents(jobs: Job[]): Job[] {
    return jobs.map((j) => ({ ...j, events: this.getJobEvents(j.runId, j.id) }));
  }

  getLatestJobForAgent(runId: string, agentId: string): Job | undefined {
    const r = this.stmts.getLatestJobForAgent.get(runId, agentId) as any;
    return r ? rowToJob(r) : undefined;
  }

  // ---------- Run events ----------
  nextEventSeq(runId: string): number {
    // 优先使用内存计数器（避免 SELECT MAX 查询）
    const cached = this.eventSeqCounters.get(runId);
    if (cached !== undefined) {
      const next = cached + 1;
      this.eventSeqCounters.set(runId, next);
      return next;
    }
    // 首次查询，初始化计数器并返回
    const r = this.stmts.nextEventSeq.get(runId) as any;
    const seq = Number(r?.max_seq ?? 0) + 1;
    this.eventSeqCounters.set(runId, seq);
    return seq;
  }

  /** run 内下一个 job 序号 */
  nextJobSeq(runId: string): number {
    const cached = this.jobSeqCounters.get(runId);
    if (cached !== undefined) {
      const next = cached + 1;
      this.jobSeqCounters.set(runId, next);
      return next;
    }
    const r = this.stmts.nextJobSeq.get(runId) as any;
    const seq = Number(r?.s ?? 0) + 1;
    this.jobSeqCounters.set(runId, seq);
    return seq;
  }

  /**
   * 原子分配 seq 并落库（同步方法：JS 单线程下 MAX+1 与 INSERT 不可被打断）。
   * 并行 job 各自调用不会拿到相同 seq（分配与写入在同一同步块内）。
   */
  appendRunEvent(runId: string, jobId: string | undefined, event: AgentEvent): number {
    const seq = this.nextEventSeq(runId);
    this.stmts.insertRunEvent.run(runId, seq, jobId ?? null, JSON.stringify(event), new Date(event.ts).toISOString());
    // 更新内存计数器
    this.eventSeqCounters.set(runId, seq);
    return seq;
  }

  /** 清理指定 run 的 seq 计数器（run 结束时调用） */
  cleanupRunSeqCounters(runId: string): void {
    this.eventSeqCounters.delete(runId);
    this.jobSeqCounters.delete(runId);
  }

  getRunEvents(runId: string, afterSeq = 0): Array<{ seq: number; jobId?: string; event: AgentEvent }> {
    const rows = this.stmts.getRunEvents.all(runId, afterSeq) as any[];
    return rows.map((r) => ({
      seq: Number(r.seq),
      jobId: r.job_id ?? undefined,
      event: JSON.parse(r.event_json),
    }));
  }

  // ---------- Chat messages ----------
  createChatMessage(msg: ChatMessage): void {
    this.stmts.createChatMessage.run(msg.id, msg.runId, msg.jobId ?? null, msg.agentId, msg.role, msg.content, msg.ts);
  }

  listChatMessages(runId: string): ChatMessage[] {
    const rows = this.stmts.listChatMessages.all(runId) as any[];
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      jobId: r.job_id ?? undefined,
      agentId: r.agent_id,
      role: r.role,
      content: r.content,
      ts: r.ts,
    }));
  }

  // ---------- Workflows ----------
  listWorkflows(): WorkflowDef[] {
    const rows = this.stmts.listWorkflows.all() as any[];
    return rows.map((r) => JSON.parse(r.def_json) as WorkflowDef);
  }

  getWorkflow(id: string): WorkflowDef | undefined {
    const r = this.stmts.getWorkflow.get(id) as any;
    return r ? (JSON.parse(r.def_json) as WorkflowDef) : undefined;
  }

  saveWorkflow(def: WorkflowDef): void {
    const exists = this.db.prepare("SELECT id FROM workflows WHERE id = ?").get(def.id);
    const now = new Date().toISOString();
    if (exists) {
      this.db.prepare("UPDATE workflows SET name = ?, def_json = ?, updated_at = ? WHERE id = ?")
        .run(def.name, JSON.stringify(def), now, def.id);
    } else {
      this.db.prepare("INSERT INTO workflows (id, name, def_json, updated_at) VALUES (?, ?, ?, ?)")
        .run(def.id, def.name, JSON.stringify(def), now);
    }
  }

  deleteWorkflow(id: string): void {
    this.stmts.deleteWorkflow.run(id);
  }
}

function rowToRun(r: any): Run {
  return {
    id: r.id,
    taskId: r.task_id,
    mode: r.mode,
    status: r.status,
    startedAt: r.started_at,
    endedAt: r.ended_at ?? undefined,
    finalResult: r.final_result ?? undefined,
    error: r.error ?? undefined,
    taskTitle: r.task_title ?? undefined,
  };
}

function rowToJob(r: any): Job {
  const events: AgentEvent[] = [];
  return {
    id: r.id,
    runId: r.run_id,
    seq: Number(r.seq),
    agentId: r.agent_id,
    agentName: r.agent_name,
    prompt: r.prompt,
    status: r.status,
    events,
    result: r.result ?? undefined,
    usage: r.usage_json ? JSON.parse(r.usage_json) : undefined,
    sessionId: r.session_id ?? undefined,
    parentJobId: r.parent_job_id ?? undefined,
    startedAt: r.started_at ?? undefined,
    endedAt: r.ended_at ?? undefined,
    error: r.error ?? undefined,
  };
}
