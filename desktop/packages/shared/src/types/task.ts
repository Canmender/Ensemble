import type { AgentEvent, Usage } from "./events";

export type TaskMode = "single" | "workflow" | "chat" | "plan" | "adversarial";
export type RunStatus = "queued" | "running" | "success" | "error" | "cancelled";
export type JobStatus = "queued" | "starting" | "running" | "success" | "error" | "cancelled";

/** 任务 = 用户的意图（一次创建，可多次执行成 Run） */
export interface Task {
  id: string;
  title: string;
  mode: TaskMode;
  input: TaskInput;
  /** 归属用户 ID（多用户隔离；空 = 本地/共享） */
  userId?: string;
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
  | { mode: "chat"; prompt: string; participantIds: string[]; maxRounds: number }
  | {
      mode: "plan";
      prompt: string;
      agentId: string;
      maxIterations?: number;
      qualityThreshold?: number;
    }
  | {
      mode: "adversarial";
      prompt: string;
      language: string;
      coderAgentId: string;
      testerAgentId: string;
      maxIterations?: number;
      coverageThreshold?: number;
    };

/** Run = 一次执行实例 */
export interface Run {
  id: string;
  taskId: string;
  mode: TaskMode;
  status: RunStatus;
  userId?: string;
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
  userId?: string;
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

/** 聊天附件（图片/视频/文件） */
export interface MessageAttachment {
  type: "image" | "video" | "file";
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
  userId?: string;
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
  ts: string;
}

/** 会话（企业级 IM）：direct = 用户与单个 agent；group = 多 agent 群聊 */
export interface Conversation {
  id: string;
  /** 归属用户（空 = 本地/共享） */
  userId?: string;
  type: "direct" | "group";
  title?: string;
  participantIds: string[];
  /** 关联的 run（群聊 = chat run；个体 = 持续 single run） */
  runId: string;
  lastMessage?: string;
  lastMessageTs?: string;
  unread: number;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}
