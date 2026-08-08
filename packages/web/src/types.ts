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
  skills?: string[];
  cwd?: string;
  memory?: AgentMemoryConfig;
  context?: AgentContextConfig;
  capabilities: AgentCapabilities;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AgentMemoryConfig {
  enabled?: boolean;
  model?: string;
  flushMinIntervalMs?: number;
  flushMinNewTokens?: number;
  consolidateMinIntervalMs?: number;
  injectMaxChars?: number;
}

export interface AgentContextConfig {
  budgetTokens?: number;
  compactionThreshold?: number;
  keepRecentRawGroups?: number;
  toolResultOffloadChars?: number;
}

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  maxTools?: number;
  toolDescriptionCap?: number;
  autoApprove?: string[];
  connectTimeoutMs?: number;
  createdAt?: string;
  updatedAt?: string;
  status?: { id: string; connected: boolean; error?: string; toolCount: number };
}

export interface SkillDef {
  name: string;
  description: string;
  body: string;
  location: string;
  updatedAt: string;
  hasReferences: boolean;
}

export interface MemorySnapshot {
  agentId: string;
  memoryFile?: { content: string; updatedAt: string; sizeBytes: number };
  dailyLogs: Array<{ date: string; sizeBytes: number; lineCount: number; updatedAt: string }>;
  stats: { lastFlushAt?: string; lastConsolidateAt?: string; flushCount: number; consolidateCount: number };
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
  mem0?: { endpoint: string; apiKey?: string; enabled: boolean };
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
