import type { DatabaseSync } from "node:sqlite";
import type {
  AgentEvent,
  ChatMessage,
  Job,
  Run,
  Task,
  WorkflowDef,
} from "@multiagent/shared";
import { logger } from "../util/logger";

/**
 * 持久化层：tasks / runs / jobs / run_events / chat_messages / workflows
 * 全部通过 better-sqlite3 同款同步 API（node:sqlite DatabaseSync）。
 */
export class Store {
  constructor(private db: DatabaseSync) {}

  // ---------- Tasks ----------
  createTask(task: Task): void {
    this.db
      .prepare("INSERT INTO tasks (id, title, mode, input_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(task.id, task.title, task.mode, JSON.stringify(task.input), task.createdAt);
  }

  listTasks(): Task[] {
    const rows = this.db.prepare("SELECT * FROM tasks ORDER BY created_at DESC").all() as any[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      mode: r.mode,
      input: JSON.parse(r.input_json),
      createdAt: r.created_at,
    }));
  }

  getTask(id: string): Task | undefined {
    const r = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
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
    this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  }

  // ---------- Runs ----------
  createRun(run: Run): void {
    this.db
      .prepare(
        `INSERT INTO runs (id, task_id, mode, status, task_title, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(run.id, run.taskId, run.mode, run.status, run.taskTitle ?? null, run.startedAt);
  }

  updateRun(id: string, patch: Partial<Run>): void {
    const sets: string[] = [];
    const vals: any[] = [];
    if (patch.status !== undefined) {
      sets.push("status = ?");
      vals.push(patch.status);
    }
    if (patch.endedAt !== undefined) {
      sets.push("ended_at = ?");
      vals.push(patch.endedAt);
    }
    if (patch.finalResult !== undefined) {
      sets.push("final_result = ?");
      vals.push(patch.finalResult);
    }
    if (patch.error !== undefined) {
      sets.push("error = ?");
      vals.push(patch.error);
    }
    if (!sets.length) return;
    vals.push(id);
    this.db.prepare(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  getRun(id: string): Run | undefined {
    const r = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as any;
    if (!r) return undefined;
    return rowToRun(r);
  }

  listRuns(filter?: { taskId?: string; mode?: string; status?: string }): Run[] {
    const where: string[] = [];
    const vals: any[] = [];
    if (filter?.taskId) {
      where.push("task_id = ?");
      vals.push(filter.taskId);
    }
    if (filter?.mode) {
      where.push("mode = ?");
      vals.push(filter.mode);
    }
    if (filter?.status) {
      where.push("status = ?");
      vals.push(filter.status);
    }
    const sql = `SELECT * FROM runs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY started_at DESC`;
    const rows = this.db.prepare(sql).all(...vals) as any[];
    return rows.map(rowToRun);
  }

  // ---------- Jobs ----------
  createJob(job: Job): void {
    this.db
      .prepare(
        `INSERT INTO jobs (id, run_id, seq, agent_id, agent_name, prompt, status, parent_job_id, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        job.id,
        job.runId,
        job.seq,
        job.agentId,
        job.agentName,
        job.prompt,
        job.status,
        job.parentJobId ?? null,
        job.startedAt ?? new Date().toISOString(),
      );
  }

  updateJob(id: string, patch: Partial<Job>): void {
    const sets: string[] = [];
    const vals: any[] = [];
    if (patch.status !== undefined) {
      sets.push("status = ?");
      vals.push(patch.status);
    }
    if (patch.result !== undefined) {
      sets.push("result = ?");
      vals.push(patch.result);
    }
    if (patch.error !== undefined) {
      sets.push("error = ?");
      vals.push(patch.error);
    }
    if (patch.sessionId !== undefined) {
      sets.push("session_id = ?");
      vals.push(patch.sessionId);
    }
    if (patch.usage !== undefined) {
      sets.push("usage_json = ?");
      vals.push(JSON.stringify(patch.usage));
    }
    if (patch.endedAt !== undefined) {
      sets.push("ended_at = ?");
      vals.push(patch.endedAt);
    }
    if (!sets.length) return;
    vals.push(id);
    this.db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  getJob(id: string): Job | undefined {
    const r = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as any;
    if (!r) return undefined;
    return rowToJob(r);
  }

  getJobs(runId: string): Job[] {
    const rows = this.db
      .prepare("SELECT * FROM jobs WHERE run_id = ? ORDER BY seq")
      .all(runId) as any[];
    return rows.map(rowToJob);
  }

  /** 查询一个 job 的全部事件（按 seq 排序） */
  getJobEvents(runId: string, jobId: string): AgentEvent[] {
    const rows = this.db
      .prepare(
        "SELECT event_json FROM run_events WHERE run_id = ? AND job_id = ? ORDER BY seq",
      )
      .all(runId, jobId) as any[];
    return rows.map((r) => JSON.parse(r.event_json) as AgentEvent);
  }

  /** 批量填充 jobs 的事件（避免 N+1） */
  hydrateJobEvents(jobs: Job[]): Job[] {
    return jobs.map((j) => ({ ...j, events: this.getJobEvents(j.runId, j.id) }));
  }

  getLatestJobForAgent(runId: string, agentId: string): Job | undefined {
    const r = this.db
      .prepare("SELECT * FROM jobs WHERE run_id = ? AND agent_id = ? ORDER BY seq DESC LIMIT 1")
      .get(runId, agentId) as any;
    return r ? rowToJob(r) : undefined;
  }

  // ---------- Run events ----------
  nextEventSeq(runId: string): number {
    const r = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM run_events WHERE run_id = ?")
      .get(runId) as any;
    return Number(r?.max_seq ?? 0) + 1;
  }

  /** run 内下一个 job 序号 */
  nextJobSeq(runId: string): number {
    const r = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM jobs WHERE run_id = ?")
      .get(runId) as any;
    return Number(r?.s ?? 0) + 1;
  }

  /**
   * 原子分配 seq 并落库（同步方法：JS 单线程下 MAX+1 与 INSERT 不可被打断）。
   * 并行 job 各自调用不会拿到相同 seq（分配与写入在同一同步块内）。
   */
  appendRunEvent(runId: string, jobId: string | undefined, event: AgentEvent): number {
    const seq = this.nextEventSeq(runId);
    this.db
      .prepare(
        "INSERT INTO run_events (run_id, seq, job_id, event_json, ts) VALUES (?, ?, ?, ?, ?)",
      )
      .run(runId, seq, jobId ?? null, JSON.stringify(event), new Date(event.ts).toISOString());
    return seq;
  }

  getRunEvents(runId: string, afterSeq = 0): Array<{ seq: number; jobId?: string; event: AgentEvent }> {
    const rows = this.db
      .prepare("SELECT seq, job_id, event_json FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq")
      .all(runId, afterSeq) as any[];
    return rows.map((r) => ({
      seq: Number(r.seq),
      jobId: r.job_id ?? undefined,
      event: JSON.parse(r.event_json),
    }));
  }

  // ---------- Chat messages ----------
  createChatMessage(msg: ChatMessage): void {
    this.db
      .prepare(
        "INSERT INTO chat_messages (id, run_id, job_id, agent_id, role, content, ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(msg.id, msg.runId, msg.jobId ?? null, msg.agentId, msg.role, msg.content, msg.ts);
  }

  listChatMessages(runId: string): ChatMessage[] {
    const rows = this.db
      .prepare("SELECT * FROM chat_messages WHERE run_id = ? ORDER BY ts")
      .all(runId) as any[];
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
    const rows = this.db.prepare("SELECT * FROM workflows ORDER BY name").all() as any[];
    return rows.map((r) => JSON.parse(r.def_json) as WorkflowDef);
  }

  getWorkflow(id: string): WorkflowDef | undefined {
    const r = this.db.prepare("SELECT * FROM workflows WHERE id = ?").get(id) as any;
    return r ? (JSON.parse(r.def_json) as WorkflowDef) : undefined;
  }

  saveWorkflow(def: WorkflowDef): void {
    const exists = this.db.prepare("SELECT id FROM workflows WHERE id = ?").get(def.id);
    const now = new Date().toISOString();
    if (exists) {
      this.db
        .prepare("UPDATE workflows SET name = ?, def_json = ?, updated_at = ? WHERE id = ?")
        .run(def.name, JSON.stringify(def), now, def.id);
    } else {
      this.db
        .prepare("INSERT INTO workflows (id, name, def_json, updated_at) VALUES (?, ?, ?, ?)")
        .run(def.id, def.name, JSON.stringify(def), now);
    }
  }

  deleteWorkflow(id: string): void {
    this.db.prepare("DELETE FROM workflows WHERE id = ?").run(id);
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
  // events 恒为空：需经 getJobEvents / hydrateJobEvents 填充（run_events 表按 job_id 查询）
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
