import type { LLMMessage, LLMProvider, LLMTool } from "../llm/types";
import type { ContextManager } from "../context/manager";

/** 循环上下文：hook 间共享，msgs 可变（hook 可注入/裁剪/压缩） */
export interface LoopContext {
  provider: LLMProvider;
  model: string;
  agentId: string;
  msgs: LLMMessage[];
  llmTools: LLMTool[];
  ctxManager?: ContextManager;
  signal?: AbortSignal;
  /** hook 间共享状态（usage 累计、flush 标记等） */
  vars: Record<string, unknown>;
}

export interface OnErrorResult {
  /** true → 调用方用 messages 重新发一次 LLM 请求 */
  retry: boolean;
  messages?: LLMMessage[];
  reason?: string;
}

/**
 * 可插拔 loop hook（对齐 AG2/AgentScope 事件模型）：
 * - preReasoning：每轮 LLM 调用前（记忆注入 / 上下文压缩）
 * - postReasoning：LLM 流结束、assistant 消息已入 msgs 后（会话持久化）
 * - postToolResult：每条工具结果回填后（offload 复查 / 记忆提取）
 * - postCall：每轮结束（记忆 flush 触发）
 * - onError：LLM 异常（overflow 恢复 / 归一化）
 */
export interface LoopHook {
  name: string;
  preReasoning?(ctx: LoopContext): Promise<void> | void;
  postReasoning?(ctx: LoopContext): Promise<void> | void;
  postToolResult?(ctx: LoopContext, tool: string, result: string): Promise<void> | void;
  postCall?(ctx: LoopContext): Promise<void> | void;
  onError?(ctx: LoopContext, err: unknown): Promise<OnErrorResult | void> | OnErrorResult | void;
}
