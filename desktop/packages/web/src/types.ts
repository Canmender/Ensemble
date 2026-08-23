// 前端用到的轻量类型（与后端 @ensemble/shared 对齐）

export interface AgentCapabilities {
  sessionResume: boolean;
  partialStreaming: boolean;
  toolUseEvents: boolean;
  concurrent: boolean;
  cwdConfigurable: boolean;
  notes?: string[];
}

export interface LocalAgentConfig {
  command: string;
  args?: string[];
  promptMode?: "stdin" | "arg";
  cwd?: string;
  timeoutMs?: number;
}

export interface Agent {
  id: string;
  name: string;
  kind: "builtin" | "local";
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
  local?: LocalAgentConfig;
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

export interface DetectedAgent {
  type: string;
  name: string;
  headless: string;
  promptMode: "arg" | "stdin";
  cmd: string;
  version?: string;
  configPath?: string;
  memoryDbPath?: string;
  skills: Array<{ name: string; sourcePath: string }>;
  memoryCount: number;
}

export interface SyncResult {
  type: string;
  importedSkills: string[];
  importedMemory: number;
  createdAgent?: string;
  errors: string[];
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
  security?: {
    allowNetwork?: boolean;
    allowFileRead?: boolean;
    allowFileWrite?: boolean;
    allowedCommands?: string[];
    blockedCommands?: string[];
    allowDangerousCommands?: boolean;
  };
  relay?: { url?: string; key?: string };
  cloudHost?: string;
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

// ---------- 插件卡片协议（U1；与 shared/src/types/plugin-card.ts 对齐——双端契约） ----------

export interface CardAction {
  id: string;
  label: string;
  style?: "primary" | "normal" | "danger";
  /** 相对插件 actions 根，形如 "/vote"——勿带 /actions 前缀（拼接端已含） */
  endpoint: string;
  payload?: Record<string, unknown>;
}

export interface PluginCardPayload {
  cardType: "poll" | "form" | "list" | "stats" | "progress" | "rich" | (string & {});
  cardVersion: 1;
  title?: string;
  state: Record<string, unknown>;
  actions: CardAction[];
}

/** 类型守卫：消息附件是否携带合法的 v1 插件卡片（与 shared 同名函数对齐） */
export function isPluginCard(att: unknown): att is { type: "plugin-card"; name: string; size: number; url: string; card: PluginCardPayload } {
  if (typeof att !== "object" || att === null) return false;
  const a = att as Record<string, unknown>;
  return (
    a.type === "plugin-card" &&
    typeof a.card === "object" && a.card !== null &&
    (a.card as PluginCardPayload).cardVersion === 1 &&
    Array.isArray((a.card as PluginCardPayload).actions)
  );
}
