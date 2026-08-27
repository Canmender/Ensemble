import type { DatabaseSync } from "node:sqlite";
import type {
  AgentEvent,
  ChatMessage,
  Conversation,
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
    nextChatSeq: ReturnType<DatabaseSync["prepare"]>;
    listChatMessages: ReturnType<DatabaseSync["prepare"]>;
    deleteChatMessage: ReturnType<DatabaseSync["prepare"]>;
    // Workflows
    listWorkflows: ReturnType<DatabaseSync["prepare"]>;
    getWorkflow: ReturnType<DatabaseSync["prepare"]>;
    deleteWorkflow: ReturnType<DatabaseSync["prepare"]>;
    // Conversations
    createConversation: ReturnType<DatabaseSync["prepare"]>;
    getConversation: ReturnType<DatabaseSync["prepare"]>;
    listConversations: ReturnType<DatabaseSync["prepare"]>;
    deleteConversation: ReturnType<DatabaseSync["prepare"]>;
    updateConvMeta: ReturnType<DatabaseSync["prepare"]>;
    incrementUnread: ReturnType<DatabaseSync["prepare"]>;
    markRead: ReturnType<DatabaseSync["prepare"]>;
    upsertUnread: ReturnType<DatabaseSync["prepare"]>;
    touchRead: ReturnType<DatabaseSync["prepare"]>;
    listConversationReads: ReturnType<DatabaseSync["prepare"]>;
    setConversationArchived: ReturnType<DatabaseSync["prepare"]>;
    setConversationMuted: ReturnType<DatabaseSync["prepare"]>;
    setConversationPinned: ReturnType<DatabaseSync["prepare"]>;
    upsertDevice: ReturnType<DatabaseSync["prepare"]>;
    deleteDevice: ReturnType<DatabaseSync["prepare"]>;
    listDevices: ReturnType<DatabaseSync["prepare"]>;
  };

  constructor(private db: DatabaseSync) {
    // 一次性 prepare 所有固定 SQL（动态 SQL 如 updateRun/updateJob 仍需即时 prepare）
    this.stmts = {
      // Tasks
      createTask: db.prepare("INSERT INTO tasks (id, title, mode, input_json, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)"),
      listTasks: db.prepare("SELECT * FROM tasks ORDER BY created_at DESC"),
      getTask: db.prepare("SELECT * FROM tasks WHERE id = ?"),
      deleteTask: db.prepare("DELETE FROM tasks WHERE id = ?"),
      // Runs
      createRun: db.prepare("INSERT INTO runs (id, task_id, mode, status, task_title, user_id, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
      getRun: db.prepare("SELECT * FROM runs WHERE id = ?"),
      // Jobs
      createJob: db.prepare("INSERT INTO jobs (id, run_id, seq, agent_id, agent_name, prompt, status, user_id, parent_job_id, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
      getJob: db.prepare("SELECT * FROM jobs WHERE id = ?"),
      getJobs: db.prepare("SELECT * FROM jobs WHERE run_id = ? ORDER BY seq"),
      getJobEvents: db.prepare("SELECT event_json FROM run_events WHERE run_id = ? AND job_id = ? ORDER BY seq"),
      getLatestJobForAgent: db.prepare("SELECT * FROM jobs WHERE run_id = ? AND agent_id = ? ORDER BY seq DESC LIMIT 1"),
      // Run events
      nextEventSeq: db.prepare("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM run_events WHERE run_id = ?"),
      nextJobSeq: db.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM jobs WHERE run_id = ?"),
      insertRunEvent: db.prepare("INSERT INTO run_events (run_id, seq, job_id, user_id, event_json, ts) VALUES (?, ?, ?, ?, ?, ?)"),
      getRunEvents: db.prepare("SELECT seq, job_id, event_json FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq"),
      // Chat messages（INSERT OR IGNORE：clientMsgId 幂等投递；seq 由服务端按会话分配）
      createChatMessage: db.prepare("INSERT OR IGNORE INTO chat_messages (id, run_id, job_id, agent_id, role, user_id, content, attachment, reply_to, mentions, deleted, ts, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
      nextChatSeq: db.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM chat_messages WHERE run_id = ?"),
      listChatMessages: db.prepare("SELECT * FROM chat_messages WHERE run_id = ? AND status != 2 ORDER BY COALESCE(seq, rowid)"),
      deleteChatMessage: db.prepare("UPDATE chat_messages SET deleted = 1 WHERE id = ?"),
      // Workflows
      listWorkflows: db.prepare("SELECT * FROM workflows ORDER BY name"),
      getWorkflow: db.prepare("SELECT * FROM workflows WHERE id = ?"),
      deleteWorkflow: db.prepare("DELETE FROM workflows WHERE id = ?"),
      // Conversations
      createConversation: db.prepare("INSERT INTO conversations (id, user_id, type, title, participant_ids, run_id, last_message, last_message_ts, unread, archived, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"),
      setConversationArchived: db.prepare("UPDATE conversations SET archived = ?, updated_at = ? WHERE id = ?"),
      setConversationMuted: db.prepare("UPDATE conversations SET muted = ?, updated_at = ? WHERE id = ?"),
      setConversationPinned: db.prepare("UPDATE conversations SET pinned = ?, updated_at = ? WHERE id = ?"),
      getConversation: db.prepare("SELECT * FROM conversations WHERE id = ?"),
      listConversations: db.prepare("SELECT * FROM conversations ORDER BY pinned DESC, updated_at DESC"),
      deleteConversation: db.prepare("DELETE FROM conversations WHERE id = ?"),
      updateConvMeta: db.prepare("UPDATE conversations SET last_message = ?, last_message_ts = ?, updated_at = ? WHERE id = ?"),
      incrementUnread: db.prepare("UPDATE conversations SET unread = unread + 1, updated_at = ? WHERE id = ?"),
      markRead: db.prepare("UPDATE conversations SET unread = 0 WHERE id = ?"),
      upsertUnread: db.prepare("INSERT INTO conversation_reads (conv_id, user_id, unread) VALUES (?, ?, 1) ON CONFLICT(conv_id, user_id) DO UPDATE SET unread = unread + 1"),
      touchRead: db.prepare("INSERT INTO conversation_reads (conv_id, user_id, unread, read_ts) VALUES (?, ?, 0, ?) ON CONFLICT(conv_id, user_id) DO UPDATE SET unread = 0, read_ts = excluded.read_ts"),
      listConversationReads: db.prepare("SELECT user_id, read_ts FROM conversation_reads WHERE conv_id = ? AND read_ts IS NOT NULL"),
      upsertDevice: db.prepare("INSERT INTO devices (id, user_id, name, type, push_token, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, push_token = COALESCE(excluded.push_token, devices.push_token), last_seen_at = excluded.last_seen_at"),
      deleteDevice: db.prepare("DELETE FROM devices WHERE user_id = ? AND id = ?"),
      listDevices: db.prepare("SELECT * FROM devices WHERE user_id = ? ORDER BY created_at ASC"),
    };
  }

  /** 查找用户（@提及解析用） */
  getUser(id: string): { id: string; username: string; displayName?: string } | undefined {
    const r = this.db.prepare("SELECT id, username, display_name FROM users WHERE id = ?").get(id) as any;
    return r ? { id: r.id, username: r.username, displayName: r.display_name ?? undefined } : undefined;
  }

  // ---------- Tasks ----------
  createTask(task: Task): void {
    this.stmts.createTask.run(task.id, task.title, task.mode, JSON.stringify(task.input), task.userId ?? '', task.createdAt);
  }

  listTasks(userId?: string): Task[] {
    const rows = userId
      ? (this.db.prepare("SELECT * FROM tasks WHERE user_id = ? OR user_id = '' ORDER BY created_at DESC").all(userId) as any[])
      : (this.stmts.listTasks.all() as any[]);
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
    this.stmts.createRun.run(run.id, run.taskId, run.mode, run.status, run.taskTitle ?? null, run.userId ?? '', run.startedAt);
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

  listRuns(filter?: { taskId?: string; mode?: string; status?: string }, userId?: string): Run[] {
    const where: string[] = [];
    const vals: any[] = [];
    if (userId) { where.push("(user_id = ? OR user_id = '')"); vals.push(userId); }
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
      job.status, job.userId ?? '', job.parentJobId ?? null, job.startedAt ?? new Date().toISOString(),
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
  appendRunEvent(runId: string, jobId: string | undefined, event: AgentEvent, userId?: string): number {
    const seq = this.nextEventSeq(runId);
    this.stmts.insertRunEvent.run(runId, seq, jobId ?? null, userId ?? '', JSON.stringify(event), new Date(event.ts).toISOString());
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
  /**
   * 落库一条群聊消息：服务端分配会话内单调 seq；INSERT OR IGNORE 幂等。
   * @returns 分配的 seq；id 重复（clientMsgId 幂等命中）时返回 null，调用方应跳过推送
   */
  createChatMessage(msg: ChatMessage): number | null {
    const seq = (this.stmts.nextChatSeq.get(msg.runId) as { s: number }).s + 1;
    const info = this.stmts.createChatMessage.run(msg.id, msg.runId, msg.jobId ?? null, msg.agentId, msg.role, msg.userId ?? '', msg.content, msg.attachment ? JSON.stringify(msg.attachment) : null, msg.replyTo ? JSON.stringify(msg.replyTo) : null, msg.mentions && msg.mentions.length > 0 ? JSON.stringify(msg.mentions) : null, msg.deleted ? 2 : (msg.status ?? 1), msg.ts, seq);
    return info.changes > 0 ? seq : null;
  }

  /** 撤回消息（v0.8.33 后 status=2，保留旧 deleted=1 兼容） */
  deleteChatMessage(id: string): void {
    this.db.prepare("UPDATE chat_messages SET deleted = 1, status = 2 WHERE id = ?").run(id);
  }

  /** 编辑消息内容（新字段：edited_at + content 更新） */
  editChatMessage(id: string, newContent: string): boolean {
    const info = this.db
      .prepare("UPDATE chat_messages SET content = ?, status = 3, edited_at = ? WHERE id = ? AND deleted = 0")
      .run(newContent, new Date().toISOString(), id);
    return info.changes > 0;
  }

  /** 标记已送达（WS 收到后调用；比已读更轻量的确认） */
  markDelivered(ids: string[]): void {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare("UPDATE chat_messages SET delivered_at = ? WHERE delivered_at IS NULL AND id = ?");
    for (const id of ids) stmt.run(now, id);
  }

  /** 拉取会话消息（按 seq 升序）。afterSeq：仅返回 seq 大于该值的消息（增量补拉，服务端裁剪） */
  listChatMessages(runId: string, userId?: string, afterSeq?: number): ChatMessage[] {
    const after = typeof afterSeq === "number" && Number.isFinite(afterSeq) && afterSeq >= 0 ? afterSeq : null;
    const rows = userId
      ? after !== null
        ? (this.db.prepare("SELECT * FROM chat_messages WHERE run_id = ? AND (user_id = ? OR user_id = '') AND COALESCE(seq, 0) > ? ORDER BY COALESCE(seq, rowid)").all(runId, userId, after) as any[])
        : (this.db.prepare("SELECT * FROM chat_messages WHERE run_id = ? AND (user_id = ? OR user_id = '') ORDER BY COALESCE(seq, rowid)").all(runId, userId) as any[])
      : after !== null
        ? (this.db.prepare("SELECT * FROM chat_messages WHERE run_id = ? AND COALESCE(seq, 0) > ? ORDER BY COALESCE(seq, rowid)").all(runId, after) as any[])
        : (this.stmts.listChatMessages.all(runId) as any[]);
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      jobId: r.job_id ?? undefined,
      seq: r.seq ?? undefined,
      agentId: r.agent_id,
      role: r.role,
      content: r.content,
      attachment: r.attachment ? (JSON.parse(r.attachment) as ChatMessage["attachment"]) : undefined,
      replyTo: r.reply_to ? (JSON.parse(r.reply_to) as ChatMessage["replyTo"]) : undefined,
      mentions: r.mentions ? (JSON.parse(r.mentions) as string[]) : undefined,
      status: (r.status ?? (r.deleted ? 2 : 1)) as ChatMessage["status"],
      deleted: !!r.deleted,
      editedAt: r.edited_at ?? undefined,
      deliveredAt: r.delivered_at ?? undefined,
      ts: r.ts,
    }));
  }

  // ---------- 消息表情回应（P2） ----------

  /** 添加回应：每人每条消息每种 emoji 最多一个 */
  addReaction(messageId: string, userId: string, emoji: string): boolean {
    try {
      this.db
        .prepare("INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)")
        .run(messageId, userId, emoji, new Date().toISOString());
      return true;
    } catch {
      return false; // 已存在
    }
  }

  /** 取消回应 */
  removeReaction(messageId: string, userId: string, emoji: string): boolean {
    const info = this.db
      .prepare("DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?")
      .run(messageId, userId, emoji);
    return info.changes > 0;
  }

  /** 获取消息的所有回应（emoji → userIds） */
  getReactions(messageId: string): Record<string, string[]> {
    const rows = this.db
      .prepare("SELECT emoji, user_id FROM message_reactions WHERE message_id = ?")
      .all(messageId) as Array<{ emoji: string; user_id: string }>;
    const out: Record<string, string[]> = {};
    for (const r of rows) {
      if (!out[r.emoji]) out[r.emoji] = [];
      out[r.emoji].push(r.user_id);
    }
    return out;
  }

  /** 批量获取多条消息的回应（聊天历史用） */
  batchGetReactions(messageIds: string[]): Record<string, Record<string, string[]>> {
    if (messageIds.length === 0) return {};
    const placeholders = messageIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT message_id, emoji, user_id FROM message_reactions WHERE message_id IN (${placeholders})`)
      .all(...messageIds) as Array<{ message_id: string; emoji: string; user_id: string }>;
    const out: Record<string, Record<string, string[]>> = {};
    for (const r of rows) {
      if (!out[r.message_id]) out[r.message_id] = {};
      if (!out[r.message_id][r.emoji]) out[r.message_id][r.emoji] = [];
      out[r.message_id][r.emoji].push(r.user_id);
    }
    return out;
  }

  // ---------- E2EE 密钥目录（服务器只见公钥；协议见 desktop/docs/E2E-PROTOCOL.md） ----------

  upsertE2eIdentity(
    userId: string,
    data: {
      identityKey: string;
      signedPreKeyId: number;
      signedPreKeyPublic: string;
      signedPreKeySignature: string;
      oneTimePreKeys?: Array<{ id: number; key: string }>;
    },
  ): void {
    this.db
      .prepare("INSERT OR REPLACE INTO e2e_identities (user_id, identity_key, spk_id, spk_public, spk_signature, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(userId, data.identityKey, data.signedPreKeyId, data.signedPreKeyPublic, data.signedPreKeySignature, new Date().toISOString());
    // 轮换身份 = 旧一次性预密钥全部作废
    this.db.prepare("DELETE FROM e2e_one_time_prekeys WHERE user_id = ?").run(userId);
    const ins = this.db.prepare("INSERT INTO e2e_one_time_prekeys (user_id, prekey_id, public_key) VALUES (?, ?, ?)");
    for (const k of data.oneTimePreKeys ?? []) {
      ins.run(userId, k.id, k.key);
    }
  }

  /** 取对端密钥包；其中一次性预密钥取走即删（X3DH 一次性语义） */
  getE2eBundle(userId: string):
    | {
        identityKey: string;
        signedPreKeyId: number;
        signedPreKey: string;
        signedPreKeySignature: string;
        oneTimePreKey?: { id: number; key: string };
      }
    | undefined {
    const idRow = this.db
      .prepare("SELECT identity_key, spk_id, spk_public, spk_signature FROM e2e_identities WHERE user_id = ?")
      .get(userId) as any;
    if (!idRow) return undefined;
    let oneTimePreKey: { id: number; key: string } | undefined;
    const opk = this.db
      .prepare("SELECT id, prekey_id, public_key FROM e2e_one_time_prekeys WHERE user_id = ? ORDER BY id LIMIT 1")
      .get(userId) as any;
    if (opk) {
      this.db.prepare("DELETE FROM e2e_one_time_prekeys WHERE id = ?").run(opk.id);
      oneTimePreKey = { id: opk.prekey_id, key: opk.public_key };
    }
    return {
      identityKey: idRow.identity_key,
      signedPreKeyId: idRow.spk_id,
      signedPreKey: idRow.spk_public,
      signedPreKeySignature: idRow.spk_signature,
      ...(oneTimePreKey ? { oneTimePreKey } : {}),
    };
  }

  countE2eOpks(userId: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM e2e_one_time_prekeys WHERE user_id = ?").get(userId) as { n: number }).n;
  }

  addE2eOpks(userId: string, keys: Array<{ id: number; key: string }>): void {
    const ins = this.db.prepare("INSERT INTO e2e_one_time_prekeys (user_id, prekey_id, public_key) VALUES (?, ?, ?)");
    for (const k of keys) ins.run(userId, k.id, k.key);
  }

  hasE2eIdentity(userId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM e2e_identities WHERE user_id = ?").get(userId);
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

  // ---------- Conversations ----------
  createConversation(c: Conversation): void {
    this.stmts.createConversation.run(
      c.id, c.userId ?? '', c.type, c.title ?? null,
      JSON.stringify(c.participantIds), c.runId,
      c.lastMessage ?? null, c.lastMessageTs ?? null,
      c.unread, c.archived ? 1 : 0, c.createdAt, c.updatedAt,
    );
  }

  getConversation(id: string): Conversation | undefined {
    const r = this.stmts.getConversation.get(id) as any;
    return r ? rowToConversation(r) : undefined;
  }

  /** 通过关联的 run_id 反查会话（broadcastChatMessage 更新会话元数据用） */
  getConversationByRunId(runId: string): Conversation | undefined {
    const r = this.db.prepare("SELECT * FROM conversations WHERE run_id = ?").get(runId) as any;
    return r ? rowToConversation(r) : undefined;
  }

  listConversations(userId?: string, opts?: { archived?: boolean }): Conversation[] {
    const archived = opts?.archived ?? false;
    const rows = userId
      ? (this.db
          .prepare(`
            SELECT c.*, COALESCE(cr.unread, c.unread, 0) AS unread
            FROM conversations c
            LEFT JOIN conversation_reads cr ON cr.conv_id = c.id AND cr.user_id = ?
            WHERE c.archived = ? AND (c.user_id = ? OR c.user_id = '' OR c.participant_ids LIKE ?)
            ORDER BY c.pinned DESC, c.updated_at DESC
          `)
          .all(userId, archived ? 1 : 0, userId, `%${JSON.stringify(userId)}%`) as any[])
      : (this.db.prepare("SELECT * FROM conversations WHERE archived = ? ORDER BY pinned DESC, updated_at DESC").all(archived ? 1 : 0) as any[]);
    return rows.map(rowToConversation);
  }

  /** 归档 / 恢复会话 */
  setConversationArchived(id: string, archived: boolean): void {
    this.stmts.setConversationArchived.run(archived ? 1 : 0, new Date().toISOString(), id);
  }

  setConversationMuted(id: string, muted: boolean): void {
    this.stmts.setConversationMuted.run(muted ? 1 : 0, new Date().toISOString(), id);
  }

  setConversationPinned(id: string, pinned: boolean): void {
    this.stmts.setConversationPinned.run(pinned ? 1 : 0, new Date().toISOString(), id);
  }

  /** 更新会话版本号（成员/设置变更时调用） */
  bumpConversationVersion(id: string): number {
    const row = this.db.prepare("UPDATE conversations SET version = version + 1, updated_at = ? WHERE id = ? RETURNING version").get(new Date().toISOString(), id) as { version: number } | undefined;
    return row?.version ?? 0;
  }

  /** 更新入群方式 */
  setJoinType(id: string, joinType: 0 | 1 | 2): void {
    this.db.prepare("UPDATE conversations SET join_type = ?, updated_at = ? WHERE id = ?").run(joinType, new Date().toISOString(), id);
    this.bumpConversationVersion(id);
  }

  /** 更新群公告 */
  setAnnouncement(id: string, text: string | null): void {
    this.db.prepare("UPDATE conversations SET announcement = ?, updated_at = ? WHERE id = ?").run(text, new Date().toISOString(), id);
    this.bumpConversationVersion(id);
  }

  // ---------- 群成员管理（group_members 表）----------

  addGroupMember(groupId: string, userId: string, role: 1 | 2 | 3 = 3): void {
    this.db
      .prepare("INSERT INTO group_members (group_id, user_id, role, status, joined_at) VALUES (?, ?, ?, 1, ?)")
      .run(groupId, userId, role, new Date().toISOString());
    this.bumpConversationVersion(groupId);
  }

  removeGroupMember(groupId: string, userId: string, status: 2 | 3 = 3): void {
    this.db.prepare("UPDATE group_members SET status = ? WHERE group_id = ? AND user_id = ?").run(status, groupId, userId);
    this.bumpConversationVersion(groupId);
  }

  getGroupMember(groupId: string, userId: string): { role: number; status: number } | undefined {
    return this.db.prepare("SELECT role, status FROM group_members WHERE group_id = ? AND user_id = ?").get(groupId, userId) as any;
  }

  setGroupMemberRole(groupId: string, userId: string, role: 1 | 2 | 3): void {
    this.db.prepare("UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?").run(role, groupId, userId);
    this.bumpConversationVersion(groupId);
  }

  listGroupMembers(groupId: string): Array<{ userId: string; role: number; status: number; joinedAt: string }> {
    return this.db
      .prepare("SELECT user_id, role, status, joined_at FROM group_members WHERE group_id = ? AND status = 1 ORDER BY role, joined_at")
      .all(groupId) as any[];
  }

  /** 按 username/display_name 模糊搜索已启用用户 */
  searchUsers(query: string, limit: number = 20): Array<{ id: string; username: string; displayName?: string }> {
    const pattern = `%${query}%`;
    return this.db
      .prepare("SELECT id, username, display_name FROM users WHERE username LIKE ? OR display_name LIKE ? ORDER BY username LIMIT ?")
      .all(pattern, pattern, limit) as any[];
  }

  /** FTS5 消息搜索：全文检索 + snippet 高亮片段 */
  searchMessagesFts(query: string, runId?: string, limit: number = 20): Array<{ id: string; runId: string; content: string; snippet: string }> {
    try {
      let sql: string;
      let params: any[];
      if (runId) {
        sql = "SELECT id, run_id, content, snippet(chat_messages_fts, 2, '<mark>', '</mark>', '...', 20) AS snippet FROM chat_messages_fts WHERE content MATCH ? AND run_id = ? ORDER BY rank LIMIT ?";
        params = [query, runId, limit];
      } else {
        sql = "SELECT id, run_id, content, snippet(chat_messages_fts, 2, '<mark>', '</mark>', '...', 20) AS snippet FROM chat_messages_fts WHERE content MATCH ? ORDER BY rank LIMIT ?";
        params = [query, limit];
      }
      return this.db.prepare(sql).all(...params) as any[];
    } catch {
      return [];
    }
  }

  // ---------- O1 组织权限 ----------

  initOrganization(name: string): boolean {
    const existing = this.db.prepare("SELECT id FROM organization LIMIT 1").get() as any;
    if (existing) return false;
    this.db.prepare("INSERT INTO organization (id, name, settings_json, created_at) VALUES (?, ?, '{}', ?)")
      .run(`org_${Date.now()}`, name, new Date().toISOString());
    return true;
  }

  createDepartment(name: string, parentId?: string, sortOrder: number = 0): string {
    const id = `dept_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.db.prepare("INSERT INTO departments (id, name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, name, parentId ?? null, sortOrder, new Date().toISOString());
    return id;
  }

  listDepartments(): Array<{ id: string; name: string; parentId: string | null; sortOrder: number }> {
    return this.db.prepare("SELECT id, name, parent_id, sort_order FROM departments ORDER BY sort_order").all() as any[];
  }

  deleteDepartment(id: string): boolean {
    const info = this.db.prepare("DELETE FROM departments WHERE id = ?").run(id);
    return info.changes > 0;
  }

  updateUserRole(userId: string, role: string): boolean {
    const info = this.db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
    return info.changes > 0;
  }

  updateUserStatus(userId: string, status: string): boolean {
    const info = this.db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, userId);
    return info.changes > 0;
  }

  updateUserDepts(userId: string, deptIds: string[]): boolean {
    const info = this.db.prepare("UPDATE users SET dept_ids = ? WHERE id = ?").run(JSON.stringify(deptIds), userId);
    return info.changes > 0;
  }

  updateUserTitle(userId: string, title: string): boolean {
    const info = this.db.prepare("UPDATE users SET title = ? WHERE id = ?").run(title, userId);
    return info.changes > 0;
  }

  listMembers(filters?: { deptId?: string; status?: string }): Array<{ id: string; username: string; displayName?: string; role: string; deptIds: string[]; title: string; status: string }> {
    let sql = "SELECT id, username, display_name, role, dept_ids, title, status FROM users WHERE status = ?";
    const params: any[] = [filters?.status ?? "active"];
    // dept_ids 过滤需要 JSON 检索，简单实现：应用层过滤
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      role: r.role,
      deptIds: r.dept_ids ? JSON.parse(r.dept_ids) : [],
      title: r.title ?? "",
      status: r.status,
    })).filter((u) => !filters?.deptId || u.deptIds.includes(filters.deptId));
  }

  /** 修改群名 */
  updateConversationTitle(id: string, title: string): void {
    this.db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?")
      .run(title, new Date().toISOString(), id);
  }

  /** 修改群成员列表 */
  updateConversationParticipants(id: string, participantIds: string[]): void {
    this.db.prepare("UPDATE conversations SET participant_ids = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(participantIds), new Date().toISOString(), id);
  }

  /** 修改群公告 */
  updateConversationAnnouncement(id: string, announcement: string): void {
    this.db.prepare("UPDATE conversations SET announcement = ?, updated_at = ? WHERE id = ?")
      .run(announcement, new Date().toISOString(), id);
  }

  /** 群禁言 / 解禁 */
  setConversationGroupMuted(id: string, muted: boolean): void {
    this.db.prepare("UPDATE conversations SET group_muted = ?, updated_at = ? WHERE id = ?")
      .run(muted ? 1 : 0, new Date().toISOString(), id);
  }

  /** 设置群主 */
  setConversationGroupOwner(id: string, ownerId: string): void {
    this.db.prepare("UPDATE conversations SET group_owner = ?, updated_at = ? WHERE id = ?")
      .run(ownerId, new Date().toISOString(), id);
  }

  /** 设置管理员列表 */
  setConversationGroupAdmins(id: string, adminIds: string[]): void {
    this.db.prepare("UPDATE conversations SET group_admins = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(adminIds), new Date().toISOString(), id);
  }

  /** 消息搜索：在指定会话中按关键词检索消息内容（支持日期范围筛选） */
  searchChatMessages(runId: string, query: string, opts?: { before?: string; after?: string }): ChatMessage[] {
    let sql = "SELECT * FROM chat_messages WHERE run_id = ? AND content LIKE ?";
    const params: any[] = [runId, `%${query}%`];
    if (opts?.before) { sql += " AND ts < ?"; params.push(opts.before); }
    if (opts?.after) { sql += " AND ts > ?"; params.push(opts.after); }
    sql += " ORDER BY ts DESC LIMIT 50";
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      jobId: r.job_id ?? undefined,
      agentId: r.agent_id,
      role: r.role,
      content: r.content,
      attachment: r.attachment ? (JSON.parse(r.attachment) as ChatMessage["attachment"]) : undefined,
      replyTo: r.reply_to ? (JSON.parse(r.reply_to) as ChatMessage["replyTo"]) : undefined,
      mentions: r.mentions ? (JSON.parse(r.mentions) as string[]) : undefined,
      deleted: !!r.deleted,
      ts: r.ts,
    }));
  }

  updateConversationMeta(id: string, lastMessage: string, lastMessageTs: string): void {
    this.stmts.updateConvMeta.run(lastMessage, lastMessageTs, new Date().toISOString(), id);
  }

  /**
   * 未读 +1。userId 提供时计入该用户的 conversation_reads（用户-用户会话 per-user 未读）；
   * 缺省回退 conversations.unread 共享计数（agent/群聊会话按归属）。
   */
  incrementUnread(id: string, userId?: string): void {
    if (userId) {
      this.stmts.upsertUnread.run(id, userId);
    } else {
      this.stmts.incrementUnread.run(new Date().toISOString(), id);
    }
  }

  /** 清零未读。userId 提供时只清该用户（per-user），并记录已读时间（已读回执用）；缺省清共享计数。 */
  markRead(id: string, userId?: string): void {
    if (userId) {
      this.stmts.touchRead.run(id, userId, new Date().toISOString());
    } else {
      this.stmts.markRead.run(id);
    }
  }

  /** 会话各参与者的最后已读时间（已读回执：发送者据此判断对方是否已读） */
  getConversationReads(convId: string): Array<{ userId: string; readTs?: string }> {
    const rows = this.stmts.listConversationReads.all(convId) as any[];
    return rows.map((r) => ({ userId: r.user_id, readTs: r.read_ts ?? undefined }));
  }

  deleteConversation(id: string): void {
    this.stmts.deleteConversation.run(id);
    this.db.prepare("DELETE FROM conversation_reads WHERE conv_id = ?").run(id);
  }

  /** 注册 / 更新设备（WS 连接时上报；last_seen_at 更新） */
  upsertDevice(device: { id: string; userId: string; name: string; type: string; pushToken?: string }): void {
    this.stmts.upsertDevice.run(
      device.id,
      device.userId,
      device.name,
      device.type,
      device.pushToken ?? null,
      new Date().toISOString(),
      new Date().toISOString(),
    );
  }

  /** 获取用户所有设备的 push_token（推送通知用） */
  getPushTokens(userId: string): string[] {
    const rows = this.db.prepare("SELECT push_token FROM devices WHERE user_id = ? AND push_token IS NOT NULL AND push_token != ''").all(userId) as Array<{ push_token: string }>;
    return rows.map((r) => r.push_token);
  }

  /** 当前用户的所有设备（含离线的，在线状态由 hub 实时判定） */
  listDevices(userId: string): Array<{ id: string; userId: string; name: string; type: string; lastSeenAt?: string }> {
    const rows = this.stmts.listDevices.all(userId) as any[];
    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      name: String(r.name),
      type: String(r.type),
      lastSeenAt: r.last_seen_at ? String(r.last_seen_at) : undefined,
    }));
  }

  /** 清理同类型同名称的离线旧设备（重装后设备 ID 变化产生的"我的手机"残留） */
  cleanupDuplicateDevices(userId: string, keepDeviceId: string, name: string, type: string, onlineIds: Set<string>): void {
    for (const d of this.listDevices(userId)) {
      if (d.id === keepDeviceId) continue;
      if (d.type !== type || d.name !== name) continue;
      if (onlineIds.has(d.id)) continue; // 在线设备保留
      this.stmts.deleteDevice.run(userId, d.id);
    }
  }
}

function rowToRun(r: any): Run {
  return {
    id: r.id,
    taskId: r.task_id,
    mode: r.mode,
    status: r.status,
    userId: r.user_id ?? undefined,
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
    userId: r.user_id ?? undefined,
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

function rowToConversation(r: any): Conversation {
  return {
    id: r.id,
    userId: r.user_id ?? undefined,
    type: r.type,
    title: r.title ?? undefined,
    participantIds: JSON.parse(r.participant_ids ?? "[]"),
    runId: r.run_id,
    lastMessage: r.last_message ?? undefined,
    lastMessageTs: r.last_message_ts ?? undefined,
    unread: Number(r.unread ?? 0),
    archived: Boolean(r.archived),
    muted: Boolean(r.muted),
    pinned: Boolean(r.pinned),
    announcement: r.announcement ?? undefined,
    groupMuted: Boolean(r.group_muted),
    groupOwner: r.group_owner ?? undefined,
    groupAdmins: r.group_admins ? JSON.parse(r.group_admins) : undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
