/**
 * 任务与消息类型（Task / Run / Job / ChatMessage）
 * 字段与根 shared/src/types/index.ts 同源，保持跨端一致
 */

import type { AgentEvent, Usage } from "./events";

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