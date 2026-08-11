/**
 * OpenAI 兼容 Embeddings 客户端。
 * 调用 `POST {baseUrl}/embeddings`（OpenAI / OpenRouter / DeepSeek / Ollama 等均兼容），
 * 供 RAG 向量检索生成文本嵌入。
 */

import { fetchWithRetry } from "../llm/retry";

export interface EmbeddingOptions {
  baseUrl: string;
  /** 缺省时不带 Authorization 头（本地无鉴权端点，如 Ollama） */
  apiKey?: string;
  model: string;
  extraHeaders?: Record<string, string>;
}

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

/** 批量生成文本嵌入。返回与入参一一对应的向量数组。 */
export async function embedTexts(opts: EmbeddingOptions, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...opts.extraHeaders,
  };
  if (opts.apiKey) {
    headers.authorization = opts.apiKey.startsWith("Bearer ") ? opts.apiKey : `Bearer ${opts.apiKey}`;
  }

  const res = await fetchWithRetry(
    `${opts.baseUrl.replace(/\/+$/, "")}/embeddings`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ model: opts.model, input: texts }),
    },
    "openai",
  );

  const data = (await res.json()) as any;
  const rows = data?.data;
  if (!Array.isArray(rows) || rows.length !== texts.length) {
    throw new Error(
      `embedding response malformed: expected ${texts.length} rows, got ${Array.isArray(rows) ? rows.length : "none"}`,
    );
  }
  for (const row of rows) {
    if (!Array.isArray(row?.embedding)) {
      throw new Error("embedding response malformed: missing vector in row");
    }
  }
  return rows.map((r: { embedding: number[] }) => r.embedding);
}
