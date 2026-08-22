// 归一化 Agent 事件 —— 适配器 / 编排引擎 / 前端 / 持久化 全部统一使用这一套事件。

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
