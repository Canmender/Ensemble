import type { AgentEvent, JobStatus, MessageReply, RunStatus, MessageAttachment } from "@ensemble/shared";

/** Server → Client 的每一帧（带 run 内单调 seq，用于重连去重/补拉） */
export interface WsEnvelope {
  v: 1;
  ts: number;
  runId: string;
  seq: number;
  jobId?: string;
  event: RunEvent;
}

export type RunEvent =
  | { type: "run.status"; status: RunStatus }
  | { type: "job.status"; jobId: string; agentId: string; status: JobStatus }
  | { type: "agent.event"; jobId: string; agentId: string; event: AgentEvent }
  | { type: "chat.message"; jobId: string; agentId: string; content: string; attachment?: MessageAttachment; replyTo?: MessageReply; mentions?: string[] }
  | { type: "chat.deleted"; msgId: string }
  | { type: "chat.read"; userId: string; readTs: string }
  | { type: "chat.mention"; convId: string; convTitle: string; senderId: string; senderName: string; content: string }
  | { type: "device.status"; deviceId: string; name: string; kind: string; online: boolean }
  | { type: "run.result"; result: string }
  | { type: "run.error"; message: string }
  | { type: "tool_confirm_request"; confirmId: string; tool: string; args: unknown }
  | { type: "auth.kicked"; message: string }
  | { type: "heartbeat" };

/** Client → Server */
export type WsClientMsg =
  | { type: "subscribe"; runId: string }
  | { type: "unsubscribe"; runId: string }
  | { type: "cancel"; runId: string }
  | { type: "steer"; runId: string; content: string }
  | { type: "tool_confirm"; runId: string; confirmId: string; approved: boolean };

export function parseClientMsg(raw: string): WsClientMsg | null {
  try {
    const msg = JSON.parse(raw);
    if (msg?.type === "subscribe" && typeof msg.runId === "string") return msg;
    if (msg?.type === "unsubscribe" && typeof msg.runId === "string") return msg;
    if (msg?.type === "cancel" && typeof msg.runId === "string") return msg;
    if (msg?.type === "steer" && typeof msg.runId === "string" && typeof msg.content === "string") return msg;
    if (msg?.type === "tool_confirm" && typeof msg.runId === "string" && typeof msg.confirmId === "string" && typeof msg.approved === "boolean") return msg;
    return null;
  } catch {
    return null;
  }
}
