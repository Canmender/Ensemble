import type { AgentStatus } from "./events";

/** 一次任务执行内，单个 agent 能力的描述（前端用它渲染徽章与能力差异） */
export interface AgentCapabilities {
  /** 是否支持跨任务 session 复用 */
  sessionResume: boolean;
  /** 是否支持 token 级增量流式输出 */
  partialStreaming: boolean;
  /** 是否上报 tool_use / tool_result 事件 */
  toolUseEvents: boolean;
  /** 是否可并发多个实例 */
  concurrent: boolean;
  /** 是否可配置工作目录 */
  cwdConfigurable: boolean;
  notes?: string[];
}

/** 当前仅内置（LLM Provider + 工具循环）一种 agent 类型 */
export type AgentKind = "builtin";

export interface AgentConfig {
  id: string;
  name: string;
  kind: AgentKind;
  description?: string;
  /** 关联的 LLM Provider id */
  providerId: string;
  /** 模型名（如 claude-sonnet-4-5 / deepseek-chat） */
  model: string;
  /** 角色/系统提示词 */
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  /** 工具循环最大迭代次数（默认 10） */
  maxIterations?: number;
  /** 启用的工具名列表 */
  tools: string[];
  cwd?: string;
  capabilities: AgentCapabilities;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 提供给适配器的一次任务输入 */
export interface AgentTaskInput {
  prompt: string;
  context?: string;
  systemPrompt?: string;
  cwd?: string;
  env?: Record<string, string>;
  maxTurns?: number;
  resumeSessionId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type AgentStatusTimeline = AgentStatus;
