/**
 * 双记忆池系统
 *
 * 1. 显式记忆池 (Explicit Pool):
 *    - 导航栏"记忆"页可见
 *    - Agent 可通过工具读取往期记忆
 *    - 长期持久化，用户可管理
 *
 * 2. 隐式记忆池 (Implicit Pool):
 *    - 项目/Run 级别作用域
 *    - 多 Agent 共享重要上下文
 *    - 主动筛选注入，非全量上下文
 *    - 自动过期清理
 *
 * 参考: 腾讯 Agent Memory 的 L0-L3 分层
 */

import type { DatabaseSync } from "node:sqlite";
import { logger } from "../util/logger";
import { estimateTokens } from "../adapters/builtin/context";

// ========== 类型定义 ==========

export interface MemoryEntry {
  id: string;
  /** 所属 agent */
  agentId: string;
  /** 记忆类型 */
  type: "fact" | "preference" | "constraint" | "event" | "insight" | "summary";
  /** 记忆内容 */
  content: string;
  /** 重要度 (0-1) */
  importance: number;
  /** 标签 */
  tags: string[];
  /** 来源 */
  source: "explicit" | "implicit";
  /** 作用域 (explicit: global, implicit: runId/projectId) */
  scope: string;
  /** 创建时间 */
  createdAt: string;
  /** 最后访问时间 */
  lastAccessedAt: string;
  /** 访问次数 */
  accessCount: number;
  /** 过期时间 (implicit pool only) */
  expiresAt?: string;
}

export interface MemoryPoolConfig {
  /** 显式记忆池最大条目数 */
  explicitMaxEntries?: number;
  /** 隐式记忆池最大条目数 (per scope) */
  implicitMaxEntries?: number;
  /** 隐式记忆池默认 TTL (ms) */
  implicitTtlMs?: number;
  /** 注入时最大字符数 */
  injectMaxChars?: number;
  /** 重要度阈值 (低于此值不注入) */
  importanceThreshold?: number;
}

// ========== 记忆池管理器 ==========

export class MemoryPoolManager {
  private stmts!: {
    // 显式记忆池
    insertExplicit: ReturnType<DatabaseSync["prepare"]>;
    listExplicit: ReturnType<DatabaseSync["prepare"]>;
    getExplicit: ReturnType<DatabaseSync["prepare"]>;
    updateExplicit: ReturnType<DatabaseSync["prepare"]>;
    deleteExplicit: ReturnType<DatabaseSync["prepare"]>;
    searchExplicit: ReturnType<DatabaseSync["prepare"]>;

    // 隐式记忆池
    insertImplicit: ReturnType<DatabaseSync["prepare"]>;
    listImplicit: ReturnType<DatabaseSync["prepare"]>;
    getImplicitByScope: ReturnType<DatabaseSync["prepare"]>;
    deleteExpiredImplicit: ReturnType<DatabaseSync["prepare"]>;
    deleteScopeImplicit: ReturnType<DatabaseSync["prepare"]>;

    // 统计
    countByScope: ReturnType<DatabaseSync["prepare"]>;
    updateAccess: ReturnType<DatabaseSync["prepare"]>;
  };

  private config: Required<MemoryPoolConfig>;

  constructor(
    private db: DatabaseSync,
    config: MemoryPoolConfig = {},
  ) {
    this.config = {
      explicitMaxEntries: config.explicitMaxEntries ?? 1000,
      implicitMaxEntries: config.implicitMaxEntries ?? 100,
      implicitTtlMs: config.implicitTtlMs ?? 24 * 60 * 60 * 1000, // 24h
      injectMaxChars: config.injectMaxChars ?? 4000,
      importanceThreshold: config.importanceThreshold ?? 0.5,
    };

    this.initDb();
    this.prepareStmts();
  }

  private initDb(): void {
    this.db.exec(`
      -- 显式记忆池 (长期持久化)
      CREATE TABLE IF NOT EXISTS explicit_memories (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'fact',
        content TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5,
        tags TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT 'explicit',
        scope TEXT NOT NULL DEFAULT 'global',
        created_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0
      );

      -- 隐式记忆池 (项目/Run 作用域，自动过期)
      CREATE TABLE IF NOT EXISTS implicit_memories (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'insight',
        content TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5,
        tags TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT 'implicit',
        scope TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT
      );

      -- 索引
      CREATE INDEX IF NOT EXISTS idx_explicit_agent ON explicit_memories(agent_id);
      CREATE INDEX IF NOT EXISTS idx_explicit_type ON explicit_memories(type);
      CREATE INDEX IF NOT EXISTS idx_explicit_importance ON explicit_memories(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_implicit_scope ON implicit_memories(scope);
      CREATE INDEX IF NOT EXISTS idx_implicit_expires ON implicit_memories(expires_at);
      CREATE INDEX IF NOT EXISTS idx_implicit_importance ON implicit_memories(importance DESC);
    `);
  }

  private prepareStmts(): void {
    this.stmts = {
      // 显式记忆池
      insertExplicit: this.db.prepare(
        "INSERT INTO explicit_memories (id, agent_id, type, content, importance, tags, source, scope, created_at, last_accessed_at, access_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)"
      ),
      listExplicit: this.db.prepare(
        "SELECT * FROM explicit_memories WHERE agent_id = ? ORDER BY importance DESC, created_at DESC LIMIT ?"
      ),
      getExplicit: this.db.prepare(
        "SELECT * FROM explicit_memories WHERE id = ?"
      ),
      updateExplicit: this.db.prepare(
        "UPDATE explicit_memories SET content = ?, type = ?, importance = ?, tags = ?, last_accessed_at = ? WHERE id = ?"
      ),
      deleteExplicit: this.db.prepare(
        "DELETE FROM explicit_memories WHERE id = ?"
      ),
      searchExplicit: this.db.prepare(
        "SELECT * FROM explicit_memories WHERE agent_id = ? AND (content LIKE ? OR tags LIKE ?) ORDER BY importance DESC LIMIT ?"
      ),

      // 隐式记忆池
      insertImplicit: this.db.prepare(
        "INSERT INTO implicit_memories (id, agent_id, type, content, importance, tags, source, scope, created_at, last_accessed_at, access_count, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)"
      ),
      listImplicit: this.db.prepare(
        "SELECT * FROM implicit_memories WHERE scope = ? AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY importance DESC LIMIT ?"
      ),
      getImplicitByScope: this.db.prepare(
        "SELECT * FROM implicit_memories WHERE scope = ? AND agent_id = ? AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY importance DESC"
      ),
      deleteExpiredImplicit: this.db.prepare(
        "DELETE FROM implicit_memories WHERE expires_at IS NOT NULL AND expires_at < datetime('now')"
      ),
      deleteScopeImplicit: this.db.prepare(
        "DELETE FROM implicit_memories WHERE scope = ?"
      ),

      // 统计
      countByScope: this.db.prepare(
        "SELECT COUNT(*) as cnt FROM implicit_memories WHERE scope = ?"
      ),
      updateAccess: this.db.prepare(
        "UPDATE explicit_memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?"
      ),
    };
  }

  // ========== 显式记忆池 API ==========

  /** 添加显式记忆 */
  addExplicit(entry: Omit<MemoryEntry, "id" | "source" | "createdAt" | "lastAccessedAt" | "accessCount">): MemoryEntry {
    const id = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    this.stmts.insertExplicit.run(
      id,
      entry.agentId,
      entry.type,
      entry.content,
      entry.importance,
      JSON.stringify(entry.tags),
      "explicit",
      entry.scope ?? "global",
      now,
      now,
    );

    // 清理超限条目
    this.cleanupExplicit(entry.agentId);

    return this.rowToEntry(this.stmts.getExplicit.get(id));
  }

  /** 列出显式记忆 */
  listExplicit(agentId: string, limit = 50): MemoryEntry[] {
    return (this.stmts.listExplicit.all(agentId, limit) as any[]).map((r: any) => this.rowToEntry(r));
  }

  /** 搜索显式记忆 */
  searchExplicit(agentId: string, query: string, limit = 10): MemoryEntry[] {
    const pattern = `%${query}%`;
    return (this.stmts.searchExplicit.all(agentId, pattern, pattern, limit) as any[]).map((r: any) => this.rowToEntry(r));
  }

  /** 更新显式记忆 */
  updateExplicit(id: string, updates: Partial<Pick<MemoryEntry, "content" | "type" | "importance" | "tags">>): void {
    const existing = this.stmts.getExplicit.get(id) as any;
    if (!existing) return;

    this.stmts.updateExplicit.run(
      updates.content ?? existing.content,
      updates.type ?? existing.type,
      updates.importance ?? existing.importance,
      JSON.stringify(updates.tags ?? JSON.parse(existing.tags)),
      new Date().toISOString(),
      id,
    );
  }

  /** 删除显式记忆 */
  deleteExplicit(id: string): void {
    this.stmts.deleteExplicit.run(id);
  }

  /** 记录访问 */
  recordAccess(id: string): void {
    this.stmts.updateAccess.run(new Date().toISOString(), id);
  }

  // ========== 隐式记忆池 API ==========

  /** 添加隐式记忆 (自动筛选重要度) */
  addImplicit(entry: Omit<MemoryEntry, "id" | "source" | "createdAt" | "lastAccessedAt" | "accessCount" | "expiresAt">): MemoryEntry | null {
    // 重要度过滤
    if (entry.importance < this.config.importanceThreshold) {
      return null;
    }

    const id = `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + this.config.implicitTtlMs).toISOString();

    // 检查 scope 容量
    const count = (this.stmts.countByScope.get(entry.scope) as any)?.cnt ?? 0;
    if (count >= this.config.implicitMaxEntries) {
      // 删除最旧的低重要度条目
      this.db.prepare(
        "DELETE FROM implicit_memories WHERE scope = ? AND id IN (SELECT id FROM implicit_memories WHERE scope = ? ORDER BY importance ASC, created_at ASC LIMIT ?)"
      ).run(entry.scope, entry.scope, Math.max(1, count - this.config.implicitMaxEntries + 1));
    }

    this.stmts.insertImplicit.run(
      id,
      entry.agentId,
      entry.type,
      entry.content,
      entry.importance,
      JSON.stringify(entry.tags),
      "implicit",
      entry.scope,
      now,
      now,
      expiresAt,
    );

    return {
      id,
      ...entry,
      source: "implicit",
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      expiresAt,
    };
  }

  /** 列出隐式记忆 (按 scope) */
  listImplicit(scope: string, limit = 50): MemoryEntry[] {
    return (this.stmts.listImplicit.all(scope, limit) as any[]).map((r: any) => this.rowToEntry(r));
  }

  /** 获取 scope 内某 agent 的隐式记忆 */
  getImplicitForAgent(scope: string, agentId: string): MemoryEntry[] {
    return (this.stmts.getImplicitByScope.all(scope, agentId) as any[]).map((r: any) => this.rowToEntry(r));
  }

  /** 清理过期隐式记忆 */
  cleanupExpired(): number {
    const result = this.stmts.deleteExpiredImplicit.run();
    return Number(result.changes);
  }

  /** 删除整个 scope 的隐式记忆 */
  clearScope(scope: string): void {
    this.stmts.deleteScopeImplicit.run(scope);
  }

  // ========== 注入 API ==========

  /** 注入显式记忆到系统提示 */
  injectExplicit(agentId: string, systemPrompt: string): string {
    const memories = this.listExplicit(agentId, 20);
    if (memories.length === 0) return systemPrompt;

    const memoryText = memories
      .map((m) => {
        const tags = m.tags.length ? ` [${m.tags.join(", ")}]` : "";
        return `- [${m.type}]${tags} ${m.content}`;
      })
      .join("\n")
      .slice(0, this.config.injectMaxChars);

    return `${systemPrompt}\n\n[显式记忆池 - 往期记忆]\n${memoryText}`;
  }

  /** 注入隐式记忆到系统提示 (项目内共享上下文) */
  injectImplicit(scope: string, agentId: string, systemPrompt: string): string {
    const memories = this.listImplicit(scope, 20);
    if (memories.length === 0) return systemPrompt;

    // 按重要度排序，取 top N
    const topMemories = memories
      .filter((m) => m.importance >= this.config.importanceThreshold)
      .slice(0, 10);

    if (topMemories.length === 0) return systemPrompt;

    const memoryText = topMemories
      .map((m) => {
        const from = m.agentId !== agentId ? ` (来自 ${m.agentId})` : " (你自己)";
        return `- [${m.type}]${from}: ${m.content}`;
      })
      .join("\n")
      .slice(0, this.config.injectMaxChars);

    return `${systemPrompt}\n\n[隐式记忆池 - 项目共享上下文]\n${memoryText}`;
  }

  /** 评估内容重要度 (基于关键词和长度) */
  static evaluateImportance(content: string): number {
    let score = 0.5; // 基础分

    // 长度因子 (重要内容通常较长)
    if (content.length > 200) score += 0.1;
    if (content.length > 500) score += 0.1;

    // 关键词因子
    const importantKeywords = [
      "重要", "关键", "核心", "决定", "结论", "发现", "问题", "解决",
      "important", "critical", "key", "decision", "conclusion", "finding",
      "bug", "fix", "error", "solution", "architecture", "design",
    ];
    const lowerContent = content.toLowerCase();
    for (const keyword of importantKeywords) {
      if (lowerContent.includes(keyword)) {
        score += 0.05;
      }
    }

    // 结构化因子 (有列表、代码块等)
    if (content.includes("```") || content.includes("- ") || content.includes("1.")) {
      score += 0.1;
    }

    return Math.min(1, Math.max(0, score));
  }

  // ========== 内部方法 ==========

  private rowToEntry(row: any): MemoryEntry {
    if (!row) throw new Error("Row is undefined");
    return {
      id: row.id,
      agentId: row.agent_id,
      type: row.type,
      content: row.content,
      importance: row.importance,
      tags: JSON.parse(row.tags ?? "[]"),
      source: row.source,
      scope: row.scope,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
      accessCount: row.access_count,
      expiresAt: row.expires_at ?? undefined,
    };
  }

  private cleanupExplicit(agentId: string): void {
    const count = (this.db.prepare(
      "SELECT COUNT(*) as cnt FROM explicit_memories WHERE agent_id = ?"
    ).get(agentId) as any)?.cnt ?? 0;

    if (count > this.config.explicitMaxEntries) {
      // 删除最旧的低重要度条目
      this.db.prepare(
        "DELETE FROM explicit_memories WHERE agent_id = ? AND id IN (SELECT id FROM explicit_memories WHERE agent_id = ? ORDER BY importance ASC, created_at ASC LIMIT ?)"
      ).run(agentId, agentId, count - this.config.explicitMaxEntries);
    }
  }
}
