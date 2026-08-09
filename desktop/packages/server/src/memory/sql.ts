import type { DatabaseSync } from "node:sqlite";
import { newId } from "../util/id";
import type { MemoryBackend } from "./backend";
import { logger } from "../util/logger";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_entries_agent ON memory_entries(agent_id);
`;

/** FTS5 索引（trigram 支持中文）—— 若 SQLite 编译未含 FTS5 则静默跳过，search 回退 LIKE */
const FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(content, content='memory_entries', content_rowid='rowid', tokenize='trigram');
CREATE TRIGGER IF NOT EXISTS memory_fts_ai AFTER INSERT ON memory_entries BEGIN
  INSERT INTO memory_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS memory_fts_ad AFTER DELETE ON memory_entries BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
`;

export interface MemoryEntry {
  id: string;
  agentId: string;
  content: string;
  createdAt: string;
}

/**
 * 本地 SQL 外部记忆：SQLite 存结构化记忆条目 + FTS5 全文搜索（替代/补充文件记忆的语义检索）。
 * 无需外部服务、免费、本地持久化。
 */
export class SqliteMemoryBackend implements MemoryBackend {
  readonly id = "sql";
  private ftsAvailable: boolean;

  constructor(
    private db: DatabaseSync,
    private enabledFlag = true,
  ) {
    this.db.exec(SCHEMA);
    this.ftsAvailable = this.initFts();
  }

  get enabled(): boolean {
    return this.enabledFlag;
  }

  private initFts(): boolean {
    try {
      this.db.exec(FTS_SCHEMA);
      return true;
    } catch (err) {
      logger.warn(`FTS5 unavailable, memory search falls back to LIKE: ${String(err)}`);
      return false;
    }
  }

  async add(agentId: string, text: string): Promise<void> {
    this.db
      .prepare("INSERT INTO memory_entries (id, agent_id, content, created_at) VALUES (?, ?, ?, ?)")
      .run(newId("mem"), agentId, text, new Date().toISOString());
  }

  async search(agentId: string, query: string, topK = 5): Promise<string[]> {
    const safe = query.replace(/"/g, '""').trim();
    if (!safe) return [];

    if (this.ftsAvailable) {
      try {
        const rows = this.db
          .prepare(
            `SELECT e.content FROM memory_entries e
             JOIN memory_fts f ON f.rowid = e.rowid
             WHERE e.agent_id = ? AND memory_fts MATCH ?
             ORDER BY bm25(memory_fts)
             LIMIT ?`,
          )
          .all(agentId, `"${safe}"`, topK) as any[];
        return rows.map((r) => r.content as string);
      } catch {
        /* 匹配失败回退 LIKE */
      }
    }

    const rows = this.db
      .prepare(
        "SELECT content FROM memory_entries WHERE agent_id = ? AND content LIKE ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(agentId, `%${safe}%`, topK) as any[];
    return rows.map((r) => r.content as string);
  }

  listByAgent(agentId: string, limit = 100): MemoryEntry[] {
    const rows = this.db
      .prepare(
        "SELECT id, agent_id, content, created_at FROM memory_entries WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(agentId, limit) as any[];
    return rows.map(rowToEntry);
  }

  /** 有记忆条目的所有 agent（导航记忆页用） */
  listAllAgents(): Array<{ agentId: string; count: number; updatedAt: string }> {
    const rows = this.db
      .prepare(
        `SELECT agent_id, COUNT(*) AS cnt, MAX(created_at) AS updated
         FROM memory_entries GROUP BY agent_id ORDER BY updated DESC`,
      )
      .all() as any[];
    return rows.map((r) => ({
      agentId: r.agent_id as string,
      count: Number(r.cnt),
      updatedAt: r.updated as string,
    }));
  }

  clear(agentId: string): void {
    this.db.prepare("DELETE FROM memory_entries WHERE agent_id = ?").run(agentId);
  }
}

function rowToEntry(r: any): MemoryEntry {
  return {
    id: r.id,
    agentId: r.agent_id,
    content: r.content,
    createdAt: r.created_at,
  };
}
