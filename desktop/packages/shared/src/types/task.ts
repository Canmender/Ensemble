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

/** 聊天附件（图片/视频/文件/插件卡片） */
export interface MessageAttachment {
  type: "image" | "video" | "file" | "audio" | "plugin-card";
  name: string;
  size: number;
  mime?: string;
  url: string;
  /** 缩略图 URL（图片上传时自动生成） */
  thumbnailUrl?: string;
  /** 插件卡片载荷（type="plugin-card" 时必填；协议见 plugin-card.ts） */
  card?: import("./plugin-card").PluginCardPayload;
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
  /** 会话内单调递增序号（服务端分配）：可靠排序与断线补拉游标 */
  seq?: number;
  userId?: string;
  jobId?: string;
  agentId: string;
  role: "user" | "assistant";
  content: string;
  /** 附件（图片/文件）；无则为纯文本消息 */
  attachment?: MessageAttachment;
  /** 引用的消息摘要（引用回复） */
  replyTo?: MessageReply;
  /** 被@的用户/Agent ID 列表 */
  mentions?: string[];
  /** 是否已撤回（撤回后内容隐藏，前端显示占位）。v0.8.34+ 请读 status 字段，此字段保留向后兼容 */
  deleted?: boolean;
  /** 消息状态：1=正常 2=已撤回 3=已编辑（v0.8.34+ 服务端落库字段） */
  status?: 1 | 2 | 3;
  /** 已送达时间（服务端回执：对方已接收但未读） */
  deliveredAt?: string;
  /** 最后编辑时间（status=3 时有值） */
  editedAt?: string;
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
  /** 静音（不弹通知） */
  muted?: boolean;
  /** 置顶（排最前） */
  pinned?: boolean;
  /** 群公告 */
  announcement?: string;
  /** 群禁言（全体禁言） */
  groupMuted?: boolean;
  /** 群主 ID */
  groupOwner?: string;
  /** 管理员 ID 列表 */
  groupAdmins?: string[];
  createdAt: string;
  updatedAt: string;
}
