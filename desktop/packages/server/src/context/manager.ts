import type { LLMMessage } from "../llm/types";
import { estimateTokens } from "../adapters/builtin/context";
import { OffloadStore, previewWithPointer, shouldOffload } from "./offload";

export interface ContextWindowConfig {
  budgetTokens: number;
  /** 达到 budget 的多少比例触发压缩（默认 0.95，参考 OpenCode） */
  compactionThreshold: number;
  /** 保留的最近原文原子组数 */
  keepRecentRawGroups: number;
  /** 工具结果超过多少字符触发 offload */
  toolResultOffloadChars: number;
}

export interface CompactionSummary {
  messages: LLMMessage[];
  compacted: boolean;
  freedTokens?: number;
  summary?: string;
  offloaded: number;
}

export type SummarizeFn = (msgs: LLMMessage[]) => Promise<string>;

/**
 * 上下文管理器：主动压缩 + 大结果 offload + overflow 恢复。
 * 压缩只以"原子组"为单位，绝不切断 tool_call 与其 tool_result 的配对。
 */
export class ContextManager {
  private cfg: ContextWindowConfig;
  private summarize: SummarizeFn;
  private offload?: OffloadStore;

  constructor(opts: {
    config: Partial<ContextWindowConfig>;
    summarize: SummarizeFn;
    offloadDir?: string;
  }) {
    this.cfg = {
      budgetTokens: opts.config.budgetTokens ?? 80_000,
      compactionThreshold: opts.config.compactionThreshold ?? 0.95,
      keepRecentRawGroups: opts.config.keepRecentRawGroups ?? 8,
      toolResultOffloadChars: opts.config.toolResultOffloadChars ?? 8000,
    };
    this.summarize = opts.summarize;
    if (opts.offloadDir) this.offload = new OffloadStore(opts.offloadDir);
  }

  /** 每轮 LLM 调用前调用：offload 兜底 + 超阈值主动压缩 */
  async prepare(msgs: LLMMessage[], agentId: string): Promise<CompactionSummary> {
    let offloaded = 0;
    let cur = msgs;
    if (this.offload) {
      const r = this.offloadLargeToolResults(cur, agentId);
      offloaded = r.offloaded;
      cur = r.messages;
    }

    let total = cur.reduce((s, m) => s + estimateTokens(m.content), 0);
    const threshold = this.cfg.budgetTokens * this.cfg.compactionThreshold;
    if (total <= threshold) return { messages: cur, compacted: false, offloaded };

    // 原子组切分
    const groups = splitIntoAtomicGroups(cur);
    if (groups.length <= 2) return { messages: cur, compacted: false, offloaded };

    const system = groups[0];
    if (!system?.length) return { messages: cur, compacted: false, offloaded };
    const keep = Math.min(this.cfg.keepRecentRawGroups, groups.length - 1);
    const recent = groups.slice(-keep);
    const compressible = groups.slice(1, groups.length - keep);
    if (compressible.length === 0) return { messages: cur, compacted: false, offloaded };

    // LLM 结构化摘要
    let summary: string;
    try {
      summary = await this.summarize(buildSummaryPrompt(system.flat(), compressible.flat()));
    } catch {
      // 摘要失败 → 回退：只保留最近组（避免上下文爆炸）
      summary = "(上下文压缩失败，保留最近内容)";
    }

    const newMsgs: LLMMessage[] = [
      system[0],
      { role: "user", content: `[上下文摘要]\n${summary}` },
      ...recent.flat(),
    ];
    const freedTokens = total - newMsgs.reduce((s, m) => s + estimateTokens(m.content), 0);
    return { messages: newMsgs, compacted: true, freedTokens: Math.max(0, freedTokens), summary, offloaded };
  }

  /** context_length_exceeded 后的极端压缩：system + 摘要 + 末条 user prompt */
  async recoverFromOverflow(msgs: LLMMessage[], agentId: string): Promise<{ messages: LLMMessage[] }> {
    const groups = splitIntoAtomicGroups(msgs);
    if (groups.length <= 2) return { messages: msgs };
    const system = groups[0];
    const last = groups[groups.length - 1];
    const middle = groups.slice(1, -1);
    let summary: string;
    try {
      summary = await this.summarize(buildSummaryPrompt(system.flat(), middle.flat(), true));
    } catch {
      return { messages: [system[0], ...last] };
    }
    return {
      messages: [
        system[0],
        { role: "user", content: `[极端压缩摘要]\n${summary}` },
        ...last,
      ],
    };
  }

  /** 是否 overflow 错误 */
  isContextLengthError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /context_length_exceeded|context length|maximum context|ctx_len|token limit|context window/i.test(msg);
  }

  private offloadLargeToolResults(msgs: LLMMessage[], agentId: string): { messages: LLMMessage[]; offloaded: number } {
    const offload = this.offload;
    if (!offload) return { messages: msgs, offloaded: 0 };
    let offloaded = 0;
    const out = msgs.map((m) => {
      if (m.role !== "tool") return m;
      if (m.content.length <= this.cfg.toolResultOffloadChars) return m;
      const relPath = offload.store(agentId, m.content);
      offloaded++;
      return { ...m, content: previewWithPointer(m.content, relPath) };
    });
    return { messages: out, offloaded };
  }
}

/** 原子组切分：assistant(+tool_calls) + 其后全部 tool 结果 为一组 */
export function splitIntoAtomicGroups(msgs: LLMMessage[]): LLMMessage[][] {
  const groups: LLMMessage[][] = [];
  let i = 0;
  while (i < msgs.length) {
    const m = msgs[i];
    if (m.role === "assistant" && m.tool_calls?.length) {
      const g: LLMMessage[] = [m];
      i++;
      while (i < msgs.length && msgs[i].role === "tool") {
        g.push(msgs[i]);
        i++;
      }
      groups.push(g);
    } else {
      groups.push([msgs[i]]);
      i++;
    }
  }
  return groups;
}

/** 结构化摘要 prompt */
function buildSummaryPrompt(system: LLMMessage[], history: LLMMessage[], aggressive = false): LLMMessage[] {
  const sys = `你是上下文压缩器。把下列对话历史压缩成结构化摘要，只输出 markdown，不要寒暄：
## SESSION INTENT
（本会话目标，2 行内）
## SUMMARY
（关键事实、决策、路径、命令、结论，≤15 条要点）
## ARTIFACTS
（已创建/读取的文件、工作产物，含路径）
## NEXT STEPS
（未完成事项）
规则：保留可复用的精确信息；丢弃寒暄与临时噪音。${aggressive ? "这是极端压缩，只保留最关键信息。" : ""}`;

  const historyText = history
    .map((m) => {
      const role = m.role === "tool" ? "tool_result" : m.role;
      return `[${role}] ${m.content}`;
    })
    .join("\n\n")
    .slice(0, 60_000);

  const result: LLMMessage[] = [
    { role: "system", content: sys },
    { role: "user", content: `## 历史记录\n${historyText}` },
  ];
  return result;
}
