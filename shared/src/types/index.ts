/**
 * 核心类型定义
 * 跨端共享的数据结构
 */

// ==================== Agent 事件 ====================

export type AgentStatus =
  | "queued"
  | "starting"
  | "running"
  | "thinking"
  | "success"
  | "error"
  | "cancelled";

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
}

export type AgentEvent =
  | { type: "status"; status: AgentStatus; detail?: string; ts: number }
  | { type: "output"; kind: "text" | "thinking"; text: string; ts: number }
  | { type: "tool_use"; tool: string; input: unknown; ts: number }
  | { type: "tool_result"; tool: string; output: string; ts: number }
  | { type: "error"; message: string; code?: string; ts: number }
  | {
      type: "done";
      outcome: "success" | "error" | "cancelled" | "max_turns";
      result?: string;
      usage?: Usage;
      sessionId?: string;
      ts: number;
    };

export type DoneOutcome = Extract<AgentEvent, { type: "done" }>["outcome"];

/** 把 output 事件按时间顺序拼接成一段可渲染文本 */
export function accumulateAgentText(events: readonly AgentEvent[]): string {
  return events
    .filter((e): e is Extract<AgentEvent, { type: "output" }> => e.type === "output")
    .map((e) => e.text)
    .join("");
}

// ==================== 任务 ====================

export type TaskMode = "single" | "workflow" | "chat";
export type RunStatus = "queued" | "running" | "success" | "error" | "cancelled";
export type JobStatus = "queued" | "starting" | "running" | "success" | "error" | "cancelled";

/** 任务 = 用户的意图（一次创建，可多次执行成 Run） */
export interface Task {
  id: string;
  title: string;
  mode: TaskMode;
  input: TaskInput;
  createdAt: string;
}

export type TaskInput =
  | {
      mode: "single";
      prompt: string;
      agentIds: string[];
      aggregate?: boolean;
      aggregatorAgentId?: string;
    }
  | { mode: "workflow"; workflowId: string; prompt: string }
  | { mode: "chat"; prompt: string; participantIds: string[]; maxRounds: number };

/** Run = 一次执行实例 */
export interface Run {
  id: string;
  taskId: string;
  mode: TaskMode;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  finalResult?: string;
  error?: string;
  taskTitle?: string;
}

/** Job = 一个 agent 的一次调用 */
export interface Job {
  id: string;
  runId: string;
  seq: number;
  agentId: string;
  agentName: string;
  prompt: string;
  status: JobStatus;
  events: AgentEvent[];
  result?: string;
  usage?: Usage;
  sessionId?: string;
  parentJobId?: string;
  startedAt?: string;
  endedAt?: string;
  error?: string;
}

/** DAG 工作流定义 */
export interface WorkflowDef {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowNode {
  id: string;
  agentId: string;
  prompt: string;
}

export type EdgeCondition =
  | "on_success"
  | "on_failure"
  | { type: "if_output_matches"; regex: string };

export interface WorkflowEdge {
  from: string;
  to: string;
  when: EdgeCondition;
}

/** 聊天附件（图片/视频/语音/文件） */
export interface MessageAttachment {
  type: "image" | "video" | "audio" | "file";
  name: string;
  size: number;
  mime?: string;
  url: string;
}

/** 引用的消息摘要（引用回复） */
export interface MessageReply {
  id: string;
  content: string;
  agentName?: string;
}

/** 群聊消息 */
export interface ChatMessage {
  id: string;
  runId: string;
  jobId?: string;
  agentId: string;
  role: "user" | "assistant";
  content: string;
  /** 附件（图片/文件）；无则为纯文本消息 */
  attachment?: MessageAttachment;
  /** 引用的消息摘要（引用回复） */
  replyTo?: MessageReply;
  /** 是否已撤回（撤回后内容隐藏，前端显示占位） */
  deleted?: boolean;
  /** @提及的用户 ID 列表 */
  mentions?: string[];
  ts: string;
}

// ==================== Agent 配置 ====================

/** agent 类型：builtin（内置 LLM+工具循环）/ local（本地命令 agent） */
export type AgentKind = "builtin" | "local";

/** 本地命令 agent 配置 */
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

/** Agent 能力描述 */
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

/** Agent 记忆配置 */
export interface AgentMemoryConfig {
  enabled?: boolean;
  model?: string;
  flushMinIntervalMs?: number;
  flushMinNewTokens?: number;
  consolidateMinIntervalMs?: number;
  injectMaxChars?: number;
}

/** Agent 上下文配置 */
export interface AgentContextConfig {
  budgetTokens?: number;
  compactionThreshold?: number;
  keepRecentRawGroups?: number;
  toolResultOffloadChars?: number;
}

/** Agent 配置 */
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

// ==================== 同步状态 ====================

/** 同步状态快照 */
export interface SyncSnapshot {
  /** 任务列表 */
  tasks: Task[];
  /** 运行记录 */
  runs: Run[];
  /** 任务详情 */
  jobs: Job[];
  /** Agent 配置 */
  agents: AgentConfig[];
  /** 快照时间戳 */
  ts: number;
}

/** 增量同步变更 */
export interface SyncChange {
  /** 变更类型 */
  action: "create" | "update" | "delete";
  /** 变更的实体类型 */
  entity: "task" | "run" | "job" | "agent";
  /** 变更的数据 */
  data: unknown;
  /** 变更时间戳 */
  ts: number;
}
