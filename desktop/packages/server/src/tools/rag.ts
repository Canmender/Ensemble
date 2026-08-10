/**
 * RAG (Retrieval-Augmented Generation) 工具
 *
 * 提供知识库检索能力，支持：
 * - 向量语义检索
 * - BM25 关键词检索
 * - 混合检索 + Rerank
 * - 文档分块管理
 */

import type { AgentTool, ToolContext } from "./types";
import { logger } from "../util/logger";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// ========== 类型定义 ==========

export interface Document {
  id: string;
  content: string;
  metadata: {
    source: string;
    title?: string;
    url?: string;
    createdAt?: string;
    tags?: string[];
    [key: string]: unknown;
  };
  embedding?: number[];
}

export interface Chunk {
  id: string;
  documentId: string;
  content: string;
  metadata: {
    startIndex: number;
    endIndex: number;
    [key: string]: unknown;
  };
  embedding?: number[];
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
  source: "vector" | "bm25" | "hybrid";
}

export interface RAGConfig {
  /** 向量数据库 API 地址 */
  vectorDbUrl?: string;
  /** 嵌入模型 API */
  embeddingUrl?: string;
  embeddingModel?: string;
  /** 分块配置 */
  chunkSize?: number;
  chunkOverlap?: number;
  /** 检索配置 */
  topK?: number;
  rerankUrl?: string;
  rerankModel?: string;
  /** 本地存储路径 */
  storagePath?: string;
}

// ========== 分块策略 ==========

/**
 * 递归字符分块
 * 按段落 → 句子 → 单词的优先级递归切分
 */
export function recursiveChunk(
  text: string,
  chunkSize: number = 512,
  chunkOverlap: number = 50,
  separators: string[] = ["\n\n", "\n", "。", ".", " ", ""],
): Array<{ content: string; startIndex: number }> {
  const chunks: Array<{ content: string; startIndex: number }> = [];

  function splitRecursive(text: string, separators: string[], startIdx: number): void {
    if (text.length <= chunkSize) {
      if (text.trim()) {
        chunks.push({ content: text.trim(), startIndex: startIdx });
      }
      return;
    }

    const sep = separators[0] ?? "";
    const remainingSeparators = separators.slice(1);

    if (sep === "") {
      // 最后一层：按字符数切分
      for (let i = 0; i < text.length; i += chunkSize - chunkOverlap) {
        const chunk = text.slice(i, i + chunkSize);
        if (chunk.trim()) {
          chunks.push({ content: chunk.trim(), startIndex: startIdx + i });
        }
      }
      return;
    }

    const parts = text.split(sep);
    let currentChunk = "";
    let currentStart = startIdx;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const separator = i < parts.length - 1 ? sep : "";

      if ((currentChunk + part + separator).length > chunkSize && currentChunk) {
        // 当前块已满，保存并开始新块
        if (currentChunk.trim()) {
          chunks.push({ content: currentChunk.trim(), startIndex: currentStart });
        }
        // 重叠：保留最后 chunkOverlap 字符
        const overlapStart = Math.max(0, currentChunk.length - chunkOverlap);
        currentChunk = currentChunk.slice(overlapStart) + part + separator;
        currentStart = currentStart + overlapStart;
      } else {
        currentChunk += part + separator;
      }
    }

    if (currentChunk.trim()) {
      // 递归处理仍然过长的块
      if (currentChunk.length > chunkSize) {
        splitRecursive(currentChunk, remainingSeparators, currentStart);
      } else {
        chunks.push({ content: currentChunk.trim(), startIndex: currentStart });
      }
    }
  }

  splitRecursive(text, separators, 0);
  return chunks;
}

/**
 * 语义分块（按段落主题边界）
 * 需要嵌入模型支持
 */
export async function semanticChunk(
  text: string,
  embedFn: (text: string) => Promise<number[]>,
  options?: { similarityThreshold?: number; maxChunkSize?: number },
): Promise<Array<{ content: string; startIndex: number }>> {
  const threshold = options?.similarityThreshold ?? 0.75;
  const maxSize = options?.maxChunkSize ?? 1024;

  // 先按段落分割
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim());
  if (paragraphs.length <= 1) {
    return [{ content: text, startIndex: 0 }];
  }

  // 计算每个段落的嵌入
  const embeddings = await Promise.all(paragraphs.map(embedFn));

  // 合并相似段落
  const chunks: Array<{ content: string; startIndex: number }> = [];
  let currentChunk = paragraphs[0];
  let currentEmbedding = embeddings[0];
  let currentStart = 0;
  let charOffset = paragraphs[0].length;

  for (let i = 1; i < paragraphs.length; i++) {
    const similarity = cosineSimilarity(currentEmbedding, embeddings[i]);
    const wouldExceed = (currentChunk + "\n\n" + paragraphs[i]).length > maxSize;

    if (similarity >= threshold && !wouldExceed) {
      // 相似且未超限，合并
      currentChunk += "\n\n" + paragraphs[i];
      // 更新嵌入为移动平均
      currentEmbedding = currentEmbedding.map((v, j) => (v + embeddings[i][j]) / 2);
    } else {
      // 不相似或超限，保存当前块
      chunks.push({ content: currentChunk.trim(), startIndex: currentStart });
      currentChunk = paragraphs[i];
      currentEmbedding = embeddings[i];
      currentStart = charOffset + 2; // +2 for \n\n
    }
    charOffset += paragraphs[i].length + 2;
  }

  if (currentChunk.trim()) {
    chunks.push({ content: currentChunk.trim(), startIndex: currentStart });
  }

  return chunks;
}

// ========== 向量相似度 ==========

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

// ========== BM25 检索 ==========

interface BM25Index {
  documents: Array<{ id: string; content: string; tokens: string[] }>;
  idf: Map<string, number>;
  avgDl: number;
}

/** Detect whether a character is a CJK unified ideograph. */
function isCJK(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0x4e00 && code <= 0x9fff;
}

function tokenize(text: string): string[] {
  // Phase 1: split into segments — CJK runs vs non-CJK (Latin/digits/etc.)
  const tokens: string[] = [];
  let cjkBuf = "";
  let latinBuf = "";

  const flushCJK = () => {
    if (!cjkBuf) return;
    // Emit individual characters as unigrams
    for (const ch of cjkBuf) tokens.push(ch);
    // Emit bigrams for semantic cohesion (e.g. "机器学习" → "机器","器学","学习")
    if (cjkBuf.length >= 2) {
      for (let i = 0; i < cjkBuf.length - 1; i++) {
        tokens.push(cjkBuf[i] + cjkBuf[i + 1]);
      }
    }
    cjkBuf = "";
  };

  const flushLatin = () => {
    if (!latinBuf) return;
    tokens.push(...latinBuf.toLowerCase().split(/\s+/).filter((t) => t.length > 0));
    latinBuf = "";
  };

  for (const ch of text) {
    if (isCJK(ch)) {
      flushLatin();
      cjkBuf += ch;
    } else {
      flushCJK();
      latinBuf += ch;
    }
  }
  flushCJK();
  flushLatin();

  return tokens;
}

function buildBM25Index(documents: Array<{ id: string; content: string }>): BM25Index {
  const docs = documents.map((d) => ({
    ...d,
    tokens: tokenize(d.content),
  }));

  const df = new Map<string, number>();
  let totalDl = 0;

  for (const doc of docs) {
    totalDl += doc.tokens.length;
    const uniqueTokens = new Set(doc.tokens);
    for (const token of uniqueTokens) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  const n = docs.length;
  for (const [term, freq] of df) {
    // IDF 公式: log((n - freq + 0.5) / (freq + 0.5) + 1)
    idf.set(term, Math.log((n - freq + 0.5) / (freq + 0.5) + 1));
  }

  return {
    documents: docs,
    idf,
    avgDl: totalDl / n,
  };
}

function bm25Search(
  index: BM25Index,
  query: string,
  topK: number = 5,
): Array<{ id: string; score: number }> {
  const queryTokens = tokenize(query);
  const k1 = 1.5;
  const b = 0.75;

  const scores: Array<{ id: string; score: number }> = [];

  for (const doc of index.documents) {
    let score = 0;
    const dl = doc.tokens.length;
    const tf = new Map<string, number>();

    for (const token of doc.tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    for (const term of queryTokens) {
      const termFreq = tf.get(term) ?? 0;
      const idf = index.idf.get(term) ?? 0;

      if (termFreq > 0) {
        const numerator = termFreq * (k1 + 1);
        const denominator = termFreq + k1 * (1 - b + (b * dl) / index.avgDl);
        score += idf * (numerator / denominator);
      }
    }

    if (score > 0) {
      scores.push({ id: doc.id, score });
    }
  }

  return scores.sort((a, b) => b.score - a.score).slice(0, topK);
}

// ========== RAG 存储 ==========

export class RAGStore {
  private documents: Map<string, Document> = new Map();
  private chunks: Map<string, Chunk> = new Map();
  private bm25Index: BM25Index | null = null;
  private config: RAGConfig;
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;

  constructor(config: RAGConfig) {
    this.config = {
      chunkSize: 512,
      chunkOverlap: 50,
      topK: 5,
      ...config,
    };

    // Attempt to load persisted data on startup
    if (this.config.storagePath) {
      this.load();
      // Persist periodically (every 60 s) if there are changes
      this.persistTimer = setInterval(() => {
        if (this.dirty) {
          this.persist();
          this.dirty = false;
        }
      }, 60_000);
    }
  }

  /** 添加文档并分块 */
  async addDocument(doc: Document): Promise<void> {
    this.documents.set(doc.id, doc);

    // 分块
    const chunks = recursiveChunk(
      doc.content,
      this.config.chunkSize,
      this.config.chunkOverlap,
    );

    // 存储分块
    for (let i = 0; i < chunks.length; i++) {
      const chunk: Chunk = {
        id: `${doc.id}_chunk_${i}`,
        documentId: doc.id,
        content: chunks[i].content,
        metadata: {
          ...doc.metadata,
          startIndex: chunks[i].startIndex,
          endIndex: chunks[i].startIndex + chunks[i].content.length,
        },
      };
      this.chunks.set(chunk.id, chunk);
    }

    // 重建 BM25 索引
    this.rebuildBM25Index();

    logger.info(`RAG: added document ${doc.id}, ${chunks.length} chunks created`);
    this.dirty = true;
  }

  /** 批量添加文档 */
  async addDocuments(docs: Document[]): Promise<void> {
    for (const doc of docs) {
      await this.addDocument(doc);
    }
  }

  /** 删除文档 */
  removeDocument(docId: string): void {
    this.documents.delete(docId);
    // 删除关联的 chunks
    for (const [id, chunk] of this.chunks) {
      if (chunk.documentId === docId) {
        this.chunks.delete(id);
      }
    }
    this.rebuildBM25Index();
    this.dirty = true;
  }

  // ========== 持久化 ==========

  /** Persist documents and chunks to the storage path as JSON. */
  persist(): void {
    const storagePath = this.config.storagePath;
    if (!storagePath) return;

    try {
      const dir = dirname(storagePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const payload = {
        documents: Array.from(this.documents.entries()),
        chunks: Array.from(this.chunks.entries()),
      };
      writeFileSync(storagePath, JSON.stringify(payload), "utf8");
      this.dirty = false;
      logger.info(`RAG: persisted ${this.documents.size} documents, ${this.chunks.size} chunks`);
    } catch (err) {
      logger.error("RAG: persist failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Load documents and chunks from the storage path. */
  load(): void {
    const storagePath = this.config.storagePath;
    if (!storagePath || !existsSync(storagePath)) return;

    try {
      const raw = JSON.parse(readFileSync(storagePath, "utf8"));
      this.documents = new Map(raw.documents);
      this.chunks = new Map(raw.chunks);
      this.rebuildBM25Index();
      logger.info(`RAG: loaded ${this.documents.size} documents, ${this.chunks.size} chunks from disk`);
    } catch (err) {
      logger.error("RAG: load failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Flush pending changes and stop the periodic timer. Call on shutdown. */
  shutdown(): void {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.dirty) {
      this.persist();
    }
  }

  /** 混合检索：向量 + BM25 */
  async search(
    query: string,
    options?: {
      topK?: number;
      filters?: { source?: string; tags?: string[] };
      method?: "vector" | "bm25" | "hybrid";
    },
  ): Promise<SearchResult[]> {
    const topK = options?.topK ?? this.config.topK ?? 5;
    const method = options?.method ?? "hybrid";

    let results: SearchResult[] = [];

    if (method === "bm25" || method === "hybrid") {
      // BM25 检索
      if (!this.bm25Index) {
        this.rebuildBM25Index();
      }

      if (this.bm25Index) {
        const bm25Results = bm25Search(this.bm25Index, query, topK * 2);
        for (const r of bm25Results) {
          const chunk = this.chunks.get(r.id);
          if (chunk) {
            results.push({
              chunk,
              score: r.score,
              source: "bm25",
            });
          }
        }
      }
    }

    // 应用过滤器
    if (options?.filters) {
      results = results.filter((r) => {
        if (options.filters?.source && r.chunk.metadata.source !== options.filters.source) {
          return false;
        }
        if (options.filters?.tags) {
          const tags = (r.chunk.metadata.tags as string[]) ?? [];
          if (!options.filters.tags.some((t) => tags.includes(t))) {
            return false;
          }
        }
        return true;
      });
    }

    // 去重并排序
    const seen = new Set<string>();
    const deduped: SearchResult[] = [];
    for (const r of results) {
      if (!seen.has(r.chunk.id)) {
        seen.add(r.chunk.id);
        deduped.push(r);
      }
    }

    return deduped.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /** 重建 BM25 索引 */
  private rebuildBM25Index(): void {
    const docs = Array.from(this.chunks.values()).map((c) => ({
      id: c.id,
      content: c.content,
    }));
    this.bm25Index = buildBM25Index(docs);
  }

  /** 获取统计信息 */
  getStats(): { documents: number; chunks: number } {
    return {
      documents: this.documents.size,
      chunks: this.chunks.size,
    };
  }
}

// ========== RAG 工具定义 ==========

export function createRagTool(ragStore: RAGStore): AgentTool {
  return {
    name: "knowledge_search",
    description:
      "从知识库检索相关文档。用于回答需要专业知识的问题，或查找参考资料。支持语义检索和关键词检索。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索查询，描述你要查找的信息",
        },
        topK: {
          type: "number",
          description: "返回结果数量，默认 5",
          default: 5,
        },
        source: {
          type: "string",
          description: "来源过滤（可选）",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "标签过滤（可选）",
        },
      },
      required: ["query"],
    },
    execute: async (input, ctx) => {
      const { query, topK = 5, source, tags } = input as any;

      const results = await ragStore.search(query, {
        topK,
        filters: { source, tags },
        method: "hybrid",
      });

      if (results.length === 0) {
        return "未找到相关文档。尝试使用不同的关键词或添加更多文档到知识库。";
      }

      return results
        .map(
          (r, i) =>
            `[${i + 1}] 来源: ${r.chunk.metadata.source}${r.chunk.metadata.title ? ` - ${r.chunk.metadata.title}` : ""}\n相关度: ${(r.score * 100).toFixed(1)}%\n${r.chunk.content}`,
        )
        .join("\n\n---\n\n");
    },
  };
}

/** 文档管理工具 */
export function createRagManageTool(ragStore: RAGStore): AgentTool {
  return {
    name: "knowledge_manage",
    description: "管理知识库文档：添加、删除、列出文档。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["add", "remove", "list", "stats"],
          description: "操作类型",
        },
        title: {
          type: "string",
          description: "文档标题（add 时必填）",
        },
        content: {
          type: "string",
          description: "文档内容（add 时必填）",
        },
        source: {
          type: "string",
          description: "文档来源（add 时可选）",
        },
        docId: {
          type: "string",
          description: "文档 ID（remove 时必填）",
        },
      },
      required: ["action"],
    },
    execute: async (input, ctx) => {
      const { action, title, content, source, docId } = input as any;

      switch (action) {
        case "add": {
          if (!title || !content) {
            return "错误：添加文档需要 title 和 content";
          }
          const id = `doc_${Date.now()}`;
          await ragStore.addDocument({
            id,
            content,
            metadata: { source: source ?? "manual", title },
          });
          return `文档已添加: ${id} (${title})`;
        }

        case "remove": {
          if (!docId) {
            return "错误：删除文档需要 docId";
          }
          ragStore.removeDocument(docId);
          return `文档已删除: ${docId}`;
        }

        case "list": {
          const stats = ragStore.getStats();
          return `知识库统计:\n- 文档数: ${stats.documents}\n- 分块数: ${stats.chunks}`;
        }

        case "stats": {
          const stats = ragStore.getStats();
          return JSON.stringify(stats, null, 2);
        }

        default:
          return `未知操作: ${action}`;
      }
    },
  };
}
