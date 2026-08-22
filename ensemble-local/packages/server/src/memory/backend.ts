/**
 * 外部记忆后端抽象：语义/向量记忆（如 Mem0）。
 * 文件记忆（MemoryStore）是默认基础；MemoryBackend 是可选的补充。
 */
export interface MemoryEntryLike {
  id: string;
  agentId: string;
  content: string;
  createdAt: string;
}

export interface MemoryBackend {
  readonly id: string;
  enabled: boolean;
  /** 存储一段事实（LLM 提取后由调用方传入） */
  add(agentId: string, text: string): Promise<void>;
  /** 语义检索相关记忆（Top-K） */
  search(agentId: string, query: string, topK?: number): Promise<string[]>;
  /** 按 agent 列出记忆条目（导航记忆页用；可选实现） */
  listByAgent?(agentId: string, limit?: number): MemoryEntryLike[];
  /** 有记忆条目的所有 agent（可选实现） */
  listAllAgents?(): Array<{ agentId: string; count: number; updatedAt: string }>;
  /** 清空某 agent 的记忆（可选实现） */
  clear?(agentId: string): void;
}
