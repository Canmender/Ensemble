import type { AgentConfig, AgentTaskInput, AgentEvent } from "@ensemble/shared";

/** 统一 Agent 适配器契约：一次 startTask = 一个异步事件流 */
export interface AgentAdapter {
  readonly kind: AgentConfig["kind"];
  /** 由配置计算或声明的能力（供 UI 与调度决策使用） */
  readonly capabilities: AgentConfig["capabilities"];
  /** 执行单个任务，产出归一化事件流，必须以 done/error 结束 */
  startTask(input: AgentTaskInput): AsyncGenerator<AgentEvent>;
  /** 取消当前活动任务（实现由 AbortSignal 驱动，通常无需额外处理） */
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

/** Steering 消息：用户在 agent 运行中注入的消息 */
export interface SteeringMessage {
  content: string;
  timestamp: number;
}

export type { AgentConfig, AgentTaskInput, AgentEvent };
