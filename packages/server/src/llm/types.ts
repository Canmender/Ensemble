import type { ProviderType, Usage } from "@multiagent/shared";

/** 工具定义（JSON Schema 输入） */
export interface LLMTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LLMToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** provider 中立消息格式（对齐 Anthropic tool_calls/tool 角色） */
export type LLMMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: LLMToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  tools?: LLMTool[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export type LLMStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; call: LLMToolCall }
  | { type: "usage"; usage: Usage }
  | { type: "done" };

export interface LLMResult {
  text: string;
  toolCalls: LLMToolCall[];
  usage?: Usage;
  stopReason?: "end_turn" | "tool_use" | "max_tokens" | string;
}

export interface LLMProvider {
  readonly id: string;
  readonly type: ProviderType;
  chat(req: LLMRequest): Promise<LLMResult>;
  stream(req: LLMRequest): AsyncGenerator<LLMStreamEvent>;
  listModels(): Promise<string[]>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
}

/** 构造 provider 所需的静态配置 */
export interface ProviderRuntimeConfig {
  id: string;
  type: ProviderType;
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  extraHeaders?: Record<string, string>;
}
