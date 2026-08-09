/**
 * 跨端通信消息协议
 * 基于 WebSocket 的实时双向通信
 */

import type { DeviceInfo } from "./discovery";
import type { AgentEvent, Task, Run, Job, ChatMessage, AgentConfig } from "./types";

// ==================== 消息类型定义 ====================

/** 消息基础结构 */
export interface BaseMessage {
  /** 消息唯一 ID */
  id: string;
  /** 消息类型 */
  type: string;
  /** 发送者设备 ID */
  from: string;
  /** 目标设备 ID（null 表示广播） */
  to: string | null;
  /** 时间戳 */
  ts: number;
}

// ==================== 设备管理消息 ====================

/** 设备上线通知 */
export interface DeviceOnlineMessage extends BaseMessage {
  type: "device:online";
  payload: DeviceInfo;
}

/** 设备离线通知 */
export interface DeviceOfflineMessage extends BaseMessage {
  type: "device:offline";
  payload: { deviceId: string };
}

/** 请求设备列表 */
export interface DeviceListRequest extends BaseMessage {
  type: "device:list";
  payload: {};
}

/** 设备列表响应 */
export interface DeviceListResponse extends BaseMessage {
  type: "device:list:response";
  payload: { devices: DeviceInfo[] };
}

// ==================== 任务消息 ====================

/** 创建任务（手机 → 电脑） */
export interface TaskCreateMessage extends BaseMessage {
  type: "task:create";
  payload: {
    title: string;
    mode: "single" | "workflow" | "chat";
    input: unknown;
  };
}

/** 任务创建响应 */
export interface TaskCreateResponse extends BaseMessage {
  type: "task:create:response";
  payload: {
    task: Task;
    run?: Run;
  };
}

/** 任务状态更新（电脑 → 手机） */
export interface TaskStatusMessage extends BaseMessage {
  type: "task:status";
  payload: {
    taskId: string;
    runId: string;
    status: string;
    jobs: Job[];
  };
}

/** 取消任务 */
export interface TaskCancelMessage extends BaseMessage {
  type: "task:cancel";
  payload: { taskId: string; runId?: string };
}

// ==================== Agent 事件流 ====================

/** Agent 事件（实时流式推送） */
export interface AgentEventMessage extends BaseMessage {
  type: "agent:event";
  payload: {
    runId: string;
    jobId: string;
    event: AgentEvent;
  };
}

// ==================== 聊天消息 ====================

/** 发送聊天消息 */
export interface ChatSendMessage extends BaseMessage {
  type: "chat:send";
  payload: {
    runId: string;
    content: string;
  };
}

/** 聊天消息广播 */
export interface ChatBroadcastMessage extends BaseMessage {
  type: "chat:message";
  payload: ChatMessage;
}

// ==================== 控制消息 ====================

/** 远程控制命令（手机 → 电脑） */
export interface ControlCommandMessage extends BaseMessage {
  type: "control:command";
  payload: {
    command: "pause" | "resume" | "cancel" | "retry";
    targetId: string;
    targetType: "task" | "run" | "job";
  };
}

/** 控制命令响应 */
export interface ControlResponseMessage extends BaseMessage {
  type: "control:response";
  payload: {
    success: boolean;
    error?: string;
  };
}

// ==================== 同步消息 ====================

/** 请求完整状态同步 */
export interface SyncRequestMessage extends BaseMessage {
  type: "sync:request";
  payload: {
    /** 需要同步的数据类型 */
    types: ("agents" | "tasks" | "runs" | "jobs")[];
    /** 增量同步的起始时间戳 */
    since?: number;
  };
}

/** 状态同步响应 */
export interface SyncResponseMessage extends BaseMessage {
  type: "sync:response";
  payload: {
    agents?: AgentConfig[];
    tasks?: Task[];
    runs?: Run[];
    jobs?: Job[];
  };
}

// ==================== 心跳 ====================

/** 心跳 ping */
export interface PingMessage extends BaseMessage {
  type: "ping";
  payload: {};
}

/** 心跳 pong */
export interface PongMessage extends BaseMessage {
  type: "pong";
  payload: {};
}

// ==================== 联合类型 ====================

/** 所有消息类型 */
export type EnsembleMessage =
  | DeviceOnlineMessage
  | DeviceOfflineMessage
  | DeviceListRequest
  | DeviceListResponse
  | TaskCreateMessage
  | TaskCreateResponse
  | TaskStatusMessage
  | TaskCancelMessage
  | AgentEventMessage
  | ChatSendMessage
  | ChatBroadcastMessage
  | ControlCommandMessage
  | ControlResponseMessage
  | SyncRequestMessage
  | SyncResponseMessage
  | PingMessage
  | PongMessage;

/** 消息类型映射（用于类型安全的消息处理） */
export type MessageTypeMap = {
  "device:online": DeviceOnlineMessage;
  "device:offline": DeviceOfflineMessage;
  "device:list": DeviceListRequest;
  "device:list:response": DeviceListResponse;
  "task:create": TaskCreateMessage;
  "task:create:response": TaskCreateResponse;
  "task:status": TaskStatusMessage;
  "task:cancel": TaskCancelMessage;
  "agent:event": AgentEventMessage;
  "chat:send": ChatSendMessage;
  "chat:message": ChatBroadcastMessage;
  "control:command": ControlCommandMessage;
  "control:response": ControlResponseMessage;
  "sync:request": SyncRequestMessage;
  "sync:response": SyncResponseMessage;
  "ping": PingMessage;
  "pong": PongMessage;
};

// ==================== 工具函数 ====================

/** 创建消息 */
export function createMessage<T extends keyof MessageTypeMap>(
  type: T,
  from: string,
  to: string | null,
  payload: MessageTypeMap[T]["payload"]
): MessageTypeMap[T] {
  return {
    id: generateId(),
    type,
    from,
    to,
    ts: Date.now(),
    payload,
  } as MessageTypeMap[T];
}

/** 验证消息格式 */
export function isValidMessage(data: unknown): data is EnsembleMessage {
  if (typeof data !== "object" || data === null) return false;
  const msg = data as Record<string, unknown>;
  return (
    typeof msg.id === "string" &&
    typeof msg.type === "string" &&
    typeof msg.from === "string" &&
    typeof msg.ts === "number" &&
    "payload" in msg
  );
}

/** 生成唯一 ID */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
