import { describe, it, expect } from "vitest";
import { RAGStore, recursiveChunk, cosineSimilarity } from "./rag";
import type { EmbedFn } from "./embedding";

/**
 * RAG 向量检索测试。
 * 用确定性的字符 hash 嵌入模拟 embedFn，验证：
 * - addDocument 为分块计算向量
 * - vector 检索按语义相似度命中相关文档
 * - hybrid 融合（RRF）包含向量命中
 * - 无 embedFn 时向量检索退化为空、hybrid 退化为 BM25
 * - 嵌入失败不阻断入库
 */

/** 确定性字符 hash 向量（128 维，归一化）—— 共享字符多的文本相似度高 */
function hashEmbed(text: string): number[] {
  const vec = new Array(128).fill(0) as number[];
  for (let i = 0; i < text.length; i++) {
    vec[text.charCodeAt(i) % 128] += 1;
  }
  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
  return vec.map((v) => v / norm);
}

const fakeEmbedFn: EmbedFn = (texts) => Promise.resolve(texts.map(hashEmbed));

// ── cosineSimilarity ────────────────────────────────────────────────────────

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns 0 when dimensions mismatch", () => {
    expect(cosineSimilarity([1, 0], [1])).toBe(0);
  });
});

// ── 分块 ────────────────────────────────────────────────────────────────────

describe("recursiveChunk", () => {
  it("keeps short text as a single chunk", () => {
    const chunks = recursiveChunk("短文本", 512, 50);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("短文本");
  });

  it("splits long text by chunk size", () => {
    const text = "段落一。\n\n段落二。\n\n段落三。".repeat(20);
    const chunks = recursiveChunk(text, 100, 10);
    expect(chunks.length).toBeGreaterThan(1);
    // 每个分块不超过 chunkSize
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(100 + 10); // 允许 overlap 略超
    }
  });
});

// ── 向量检索 ────────────────────────────────────────────────────────────────

describe("RAGStore vector search", () => {
  it("embeds chunks on add and finds semantically related documents", async () => {
    const store = new RAGStore({
      chunkSize: 100,
      chunkOverlap: 20,
      topK: 3,
      embedFn: fakeEmbedFn,
    });

    await store.addDocument({
      id: "doc-ml",
      content: "机器学习是人工智能的核心领域，研究算法与统计模型。",
      metadata: { source: "manual", title: "机器学习" },
    });
    await store.addDocument({
      id: "doc-web",
      content: "Web 开发涉及 HTML、CSS 与 JavaScript 语言。",
      metadata: { source: "manual", title: "Web 开发" },
    });

    const results = await store.search("机器学习算法", { method: "vector" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("vector");
    expect(results[0].chunk.documentId).toBe("doc-ml");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("hybrid search fuses vector and BM25 results", async () => {
    const store = new RAGStore({
      chunkSize: 100,
      chunkOverlap: 20,
      topK: 3,
      embedFn: fakeEmbedFn,
    });

    await store.addDocument({
      id: "doc-ml",
      content: "机器学习是人工智能的核心领域，研究算法与统计模型。",
      metadata: { source: "manual" },
    });
    await store.addDocument({
      id: "doc-web",
      content: "Web 开发涉及 HTML、CSS 与 JavaScript 语言。",
      metadata: { source: "manual" },
    });

    const results = await store.search("机器学习", { method: "hybrid" });
    expect(results.length).toBeGreaterThan(0);
    // hybrid 至少应命中相关文档
    expect(results.some((r) => r.chunk.documentId === "doc-ml")).toBe(true);
  });

  it("returns empty for vector search without embedFn", async () => {
    const store = new RAGStore({});
    await store.addDocument({
      id: "doc-a",
      content: "内容 A",
      metadata: { source: "manual" },
    });
    const results = await store.search("内容", { method: "vector" });
    expect(results).toHaveLength(0);
  });

  it("hybrid without embedFn degrades to BM25", async () => {
    const store = new RAGStore({});
    await store.addDocument({
      id: "doc-a",
      content: "机器学习基础概念介绍",
      metadata: { source: "manual" },
    });
    const results = await store.search("机器学习", { method: "hybrid" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("bm25");
  });

  it("continues to support pure BM25 search", async () => {
    const store = new RAGStore({ embedFn: fakeEmbedFn });
    await store.addDocument({
      id: "doc-a",
      content: "机器学习基础概念介绍",
      metadata: { source: "manual" },
    });
    const results = await store.search("机器学习", { method: "bm25" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("bm25");
  });

  it("does not fail ingestion when embedding throws", async () => {
    const failing: EmbedFn = () => Promise.reject(new Error("embedding down"));
    const store = new RAGStore({ embedFn: failing });

    await store.addDocument({
      id: "doc-a",
      content: "内容 A",
      metadata: { source: "manual" },
    });

    // 文档仍入库（可 BM25 检索）
    const stats = store.getStats();
    expect(stats.documents).toBe(1);

    // 向量检索返回空，不抛错
    const results = await store.search("内容", { method: "vector" });
    expect(results).toHaveLength(0);
  });

  it("applies source filters to vector results", async () => {
    const store = new RAGStore({ embedFn: fakeEmbedFn });
    await store.addDocument({
      id: "doc-a",
      content: "机器学习相关内容",
      metadata: { source: "book" },
    });
    await store.addDocument({
      id: "doc-b",
      content: "机器学习相关内容二",
      metadata: { source: "web" },
    });

    const results = await store.search("机器学习", {
      method: "vector",
      filters: { source: "book" },
    });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.chunk.metadata.source).toBe("book");
    }
  });
});

// ── 持久化（含向量） ────────────────────────────────────────────────────────

describe("RAGStore persistence with embeddings", () => {
  it("persists and reloads chunk embeddings", async () => {
    const storagePath = `.tmp-rag-${Math.random().toString(36).slice(2, 8)}.json`;
    try {
      const store = new RAGStore({ embedFn: fakeEmbedFn, storagePath });
      await store.addDocument({
        id: "doc-a",
        content: "机器学习基础概念介绍",
        metadata: { source: "manual" },
      });
      store.persist();

      // 重新加载
      const reloaded = new RAGStore({ embedFn: fakeEmbedFn, storagePath });
      const results = await reloaded.search("机器学习", { method: "vector" });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].chunk.embedding).toBeDefined();
    } finally {
      const { existsSync, rmSync } = await import("node:fs");
      if (existsSync(storagePath)) rmSync(storagePath);
    }
  });
});
