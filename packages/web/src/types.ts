// 前端用到的轻量类型（与后端 @multiagent/shared 对齐）

export interface AgentCapabilities {
  sessionResume: boolean;
  partialStreaming: boolean;
  toolUseEvents: boolean;
  concurrent: boolean;
  cwdConfigurable: boolean;
  notes?: string[];
}

export interface Agent {
  id: string;
  name: string;
  kind: "builtin";
  description?: string;
  providerId: string;
  model: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  maxIterations?: number;
  tools: string[];
  cwd?: string;
  capabilities: AgentCapabilities;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type ProviderType = "anthropic" | "openai" | "custom";

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  apiKey?: string;
  apiKeySet?: boolean;
  models?: string[];
  defaultModel?: string;
  extraHeaders?: Record<string, string>;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AppSettings {
  workspaceRoot: string;
  searchApi?: { provider: "duckduckgo" | "serper" | "tavily"; apiKey?: string };
  codeExecutionConfirm: "ask" | "always" | "never";
  defaultProviderId?: string;
}

export type TaskMode = "single" | "workflow" | "chat";

export interface Task {
  id: string;
  title: string;
  mode: TaskMode;
  input: any;
  createdAt: string;
}

export type RunStatus = "queued" | "running" | "success" | "error" | "cancelled";

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

export interface WorkflowDef {
  id: string;
  name: string;
  nodes: Array<{ id: string; agentId: string; prompt: string }>;
  edges: Array<{ from: string; to: string; when: any }>;
}
