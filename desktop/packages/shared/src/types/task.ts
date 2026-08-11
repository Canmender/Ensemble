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

/** 群聊消息 */
export interface ChatMessage {
  id: string;
  runId: string;
  userId?: string;
  jobId?: string;
  agentId: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
}
