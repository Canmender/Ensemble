/**
 * 外部记忆后端抽象：语义/向量记忆（如 Mem0）。
 * 文件记忆（MemoryStore）是默认基础；MemoryBackend 是可选的补充。
 */
export interface MemoryBackend {
  readonly id: string;
  enabled: boolean;
  /** 存储一段事实（LLM 提取后由调用方传入） */
  add(agentId: string, text: string): Promise<void>;
  /** 语义检索相关记忆（Top-K） */
  search(agentId: string, query: string, topK?: number): Promise<string[]>;
}
