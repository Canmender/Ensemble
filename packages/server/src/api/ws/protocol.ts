import type { AgentEvent, JobStatus, RunStatus } from "@multiagent/shared";

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
  | { type: "chat.message"; jobId: string; agentId: string; content: string }
  | { type: "run.result"; result: string }
  | { type: "run.error"; message: string }
  | { type: "heartbeat" };

/** Client → Server */
export type WsClientMsg =
  | { type: "subscribe"; runId: string }
  | { type: "unsubscribe"; runId: string }
  | { type: "cancel"; runId: string };

export function parseClientMsg(raw: string): WsClientMsg | null {
  try {
    const msg = JSON.parse(raw);
    if (msg?.type === "subscribe" && typeof msg.runId === "string") return msg;
    if (msg?.type === "unsubscribe" && typeof msg.runId === "string") return msg;
    if (msg?.type === "cancel" && typeof msg.runId === "string") return msg;
    return null;
  } catch {
    return null;
  }
}
