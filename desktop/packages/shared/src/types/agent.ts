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

/** agent 类型：builtin（内置 LLM+工具循环）/ local（本地命令 agent） */
export type AgentKind = "builtin" | "local";

/** 本地命令 agent 配置：快速接入本地已有的 agent CLI / 脚本 */
export interface LocalAgentConfig {
  /** 命令（如 claude -p、hermes -z、python agent.py） */
  command: string;
  /** 固定参数 */
  args?: string[];
  /** prompt 传递方式：stdin（写入 stdin）或 arg（作为最后参数，默认 arg） */
  promptMode?: "stdin" | "arg";
  cwd?: string;
  timeoutMs?: number;
}

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
  /** 启用的 skill 名列表 */
  skills?: string[];
  cwd?: string;
  /** 本地命令 agent 配置（kind=local 时） */
  local?: LocalAgentConfig;
  /** 记忆配置（默认关闭） */
  memory?: AgentMemoryConfig;
  /** 上下文压缩配置 */
  context?: AgentContextConfig;
  capabilities: AgentCapabilities;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMemoryConfig {
  enabled?: boolean;
  model?: string;
  flushMinIntervalMs?: number;
  flushMinNewTokens?: number;
  consolidateMinIntervalMs?: number;
  injectMaxChars?: number;
}

export interface AgentContextConfig {
  budgetTokens?: number;
  compactionThreshold?: number;
  keepRecentRawGroups?: number;
  toolResultOffloadChars?: number;
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
