import type { MemoryBackend } from "./backend";
import { logger } from "../util/logger";

export interface Mem0Config {
  endpoint: string;
  apiKey?: string;
  enabled: boolean;
}

/** Mem0 外部记忆（HTTP API）：add 存储事实，search 语义检索 */
export class Mem0Backend implements MemoryBackend {
  readonly id = "mem0";
  private endpoint: string;
  private apiKey?: string;

  constructor(private opts: Mem0Config) {
    this.endpoint = opts.endpoint.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
  }

  get enabled(): boolean {
    return this.opts.enabled;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) h["authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  async add(agentId: string, text: string): Promise<void> {
    try {
      const res = await fetch(`${this.endpoint}/v1/memories/`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          user_id: agentId,
          messages: [{ role: "user", content: text }],
        }),
      });
      if (!res.ok) logger.warn(`mem0 add failed: HTTP ${res.status}`);
    } catch (err) {
      logger.warn(`mem0 add error: ${String(err)}`);
    }
  }

  async search(agentId: string, query: string, topK = 5): Promise<string[]> {
    try {
      const res = await fetch(`${this.endpoint}/v1/memories/search/`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ user_id: agentId, query, top_k: topK }),
      });
      if (!res.ok) {
        logger.warn(`mem0 search failed: HTTP ${res.status}`);
        return [];
      }
      const data = (await res.json()) as any;
      const results = data.results ?? [];
      return results.map((r: any) => r.memory ?? r.text ?? "").filter(Boolean);
    } catch (err) {
      logger.warn(`mem0 search error: ${String(err)}`);
      return [];
    }
  }
}
