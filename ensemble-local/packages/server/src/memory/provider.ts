import type { AgentConfig, AgentMemoryConfig } from "@ensemble/shared";
import { MemoryStore } from "./store";
import { MemoryLlm } from "./llm";
import type { MemorySnapshot } from "./types";
import { estimateTokens } from "../adapters/builtin/context";
import type { ProviderRegistry } from "../llm/registry";
import type { MemoryBackend } from "./backend";
import { logger } from "../util/logger";

export interface MemoryProvider {
  inject(systemPrompt: string, agentId: string): Promise<string>;
  /** 调度一次 flush（节流 + per-agent 串行），返回可 await 的链尾 promise */
  scheduleFlush(agentId: string, transcript: string, prompt: string): Promise<void>;
  snapshot(agentId: string): Promise<MemorySnapshot>;
  memoryForAgent(agentId: string): Promise<{
    file: MemorySnapshot;
    sqlEntries?: import("./backend").MemoryEntryLike[];
  }>;
  consolidate(agentId: string): Promise<void>;
  importFacts(agentId: string, facts: Array<{ content: string; category?: string }>): Promise<number>;
  clear(agentId: string): void;
  dispose(): void;
}

/** 两级记忆编排：节流 + per-agent 串行队列，LLM 调用失败静默降级 */
export class MemoryProviderImpl implements MemoryProvider {
  private store: MemoryStore;
  private chains = new Map<string, Promise<void>>();
  private lastTokens = new Map<string, number>();

  constructor(
    private memoryRoot: string,
    private getAgent: (id: string) => AgentConfig | undefined,
    private providerRegistry: ProviderRegistry,
    private externalBackend?: MemoryBackend,
  ) {
    this.store = new MemoryStore(memoryRoot);
  }

  private cfg(agentId: string): AgentMemoryConfig | undefined {
    return this.getAgent(agentId)?.memory;
  }

  private isEnabled(agentId: string): boolean {
    return !!this.cfg(agentId)?.enabled;
  }

  private getLlm(agentId: string): MemoryLlm | undefined {
    const agent = this.getAgent(agentId);
    if (!agent) return undefined;
    const provider = this.providerRegistry.get(agent.providerId);
    if (!provider) return undefined;
    return new MemoryLlm({ provider, model: this.cfg(agentId)?.model ?? agent.model });
  }

  async inject(systemPrompt: string, agentId: string): Promise<string> {
    if (!this.isEnabled(agentId)) return systemPrompt;
    const maxChars = this.cfg(agentId)?.injectMaxChars ?? 3000;

    const parts: string[] = [];

    // semantic：精选长期记忆（MEMORY.md）
    const mem = this.store.readMemoryFile(agentId);
    if (mem?.content) parts.push(mem.content.slice(0, maxChars));

    // episodic：近期日常日志（具体情境，分层记忆）
    const recentDaily = this.store
      .listDaily(agentId)
      .slice(0, 3)
      .map((d) => this.store.readDaily(agentId, d.date) ?? "")
      .filter(Boolean)
      .join("\n");
    if (recentDaily) parts.push(`## 近期情境\n${recentDaily.slice(0, maxChars)}`);

    // 相关记忆：外部后端语义/全文检索
    if (this.externalBackend?.enabled) {
      try {
        const related = await this.externalBackend.search(agentId, systemPrompt.slice(0, 200), 5);
        if (related.length) parts.push(`## 相关历史记忆\n${related.join("\n").slice(0, maxChars)}`);
      } catch (err) {
        /* 外部记忆失败静默降级 */
        logger.warn(`external memory search failed for ${agentId}: ${String(err)}`);
      }
    }

    if (!parts.length) return systemPrompt;
    return `${systemPrompt}\n\n[长期记忆]\n${parts.join("\n\n")}`;
  }

  async scheduleFlush(agentId: string, transcript: string, prompt: string): Promise<void> {
    if (!this.isEnabled(agentId)) return;
    const cfg = this.cfg(agentId)!;
    const minInterval = cfg.flushMinIntervalMs ?? 30_000;
    const minNewTokens = cfg.flushMinNewTokens ?? 1500;

    const meta = this.store.readMeta(agentId);
    if (meta.lastFlushAt && Date.now() - new Date(meta.lastFlushAt).getTime() < minInterval) return;

    const tokens = estimateTokens(transcript);
    const prev = this.lastTokens.get(agentId) ?? 0;
    if (tokens - prev < minNewTokens) return;

    // flush 成功后才推进 lastTokens（失败则下次可重试，避免记忆静默丢失）
    return this.enqueue(agentId, async () => {
      await this.flushNow(agentId, transcript, prompt);
      this.lastTokens.set(agentId, tokens);
    });
  }

  private enqueue(agentId: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(agentId) ?? Promise.resolve();
    const next = prev
      .then(fn, fn)
      .catch((e) => logger.warn(`memory flush failed for ${agentId}: ${String(e)}`));
    this.chains.set(agentId, next);
    return next;
  }

  private async flushNow(agentId: string, transcript: string, prompt: string): Promise<void> {
    const llm = this.getLlm(agentId);
    if (!llm) return;
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const out = await llm.flush(transcript, prompt, now);
    this.store.appendDaily(agentId, date, out.text);
    this.recordUsage(agentId, out.usage);

    // 外部记忆（Mem0）：同步存储提取的事实
    if (this.externalBackend?.enabled) {
      await this.externalBackend.add(agentId, out.text).catch((err) =>
        logger.warn(`external memory add failed for ${agentId}: ${String(err)}`),
      );
    }

    const meta = this.store.readMeta(agentId);
    this.store.writeMeta(agentId, {
      lastFlushAt: now.toISOString(),
      flushCount: (meta.flushCount ?? 0) + 1,
    });

    // 触发 consolidate（距上次超阈值）
    const minConsolidate = this.cfg(agentId)?.consolidateMinIntervalMs ?? 12 * 3600_000;
    if (!meta.lastConsolidateAt || Date.now() - new Date(meta.lastConsolidateAt).getTime() >= minConsolidate) {
      await this.consolidate(agentId);
    }
  }

  async consolidate(agentId: string): Promise<void> {
    if (!this.isEnabled(agentId)) return;
    const llm = this.getLlm(agentId);
    if (!llm) return;
    const logs = this.store
      .listDaily(agentId)
      .slice(0, 7)
      .map((d) => this.store.readDaily(agentId, d.date) ?? "")
      .join("\n");
    const old = this.store.readMemoryFile(agentId)?.content ?? "";
    const maxChars = this.cfg(agentId)?.injectMaxChars ?? 3000;
    const out = await llm.consolidate(agentId, old, logs, maxChars);
    this.store.writeMemoryFile(agentId, out.text);
    this.recordUsage(agentId, out.usage);
    const meta = this.store.readMeta(agentId);
    this.store.writeMeta(agentId, {
      lastConsolidateAt: new Date().toISOString(),
      consolidateCount: (meta.consolidateCount ?? 0) + 1,
    });
  }

  async snapshot(agentId: string): Promise<MemorySnapshot> {
    return this.store.snapshot(agentId);
  }

  /** agent 完整记忆（文件 MEMORY.md/daily + SQL 条目），供导航记忆页 */
  async memoryForAgent(agentId: string): Promise<{
    file: MemorySnapshot;
    sqlEntries?: import("./backend").MemoryEntryLike[];
  }> {
    const file = await this.store.snapshot(agentId);
    const sqlEntries = this.externalBackend?.listByAgent
      ? this.externalBackend.listByAgent(agentId, 100)
      : undefined;
    return { file, sqlEntries };
  }

  /** 批量导入外部记忆条目（本地 agent 同步用） */
  async importFacts(agentId: string, facts: Array<{ content: string; category?: string }>): Promise<number> {
    if (!this.externalBackend?.add) return 0;
    let n = 0;
    for (const f of facts) {
      if (!f.content?.trim()) continue;
      const tag = f.category ? `[${f.category}] ` : "";
      await this.externalBackend.add(agentId, `[同步] ${tag}${f.content}`).catch((err) =>
        logger.warn(`external memory import failed for ${agentId}: ${String(err)}`),
      );
      n++;
    }
    return n;
  }

  clear(agentId: string): void {
    this.store.clear(agentId);
    this.externalBackend?.clear?.(agentId);
    this.lastTokens.delete(agentId);
  }

  /** 轮转单个 agent 的 daily 日志 */
  rotate(agentId: string, keepDays = 90): number {
    return this.store.rotate(agentId, keepDays);
  }

  private recordUsage(agentId: string, usage: { inputTokens?: number; outputTokens?: number } | undefined): void {
    if (!usage) return;
    this.store.addUsage(agentId, (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));
  }

  dispose(): void {
    this.chains.clear();
  }
}
