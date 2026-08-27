export type ProviderType = "anthropic" | "openai" | "custom";

/**
 * LLM Provider 配置。apiKey 永不写入此配置（存 KeyStore），
 * apiKeySet 是响应专用标记（是否已配置 key）。
 */
export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  apiKey?: string; // 仅创建/更新请求传入；GET 响应恒为 undefined
  apiKeySet?: boolean; // 响应专用
  models?: string[];
  defaultModel?: string;
  extraHeaders?: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  workspaceRoot: string;
  searchApi?: { provider: "duckduckgo" | "serper" | "tavily"; apiKey?: string };
  codeExecutionConfirm: "ask" | "always" | "never";
  defaultProviderId?: string;
  /** 外部记忆（Mem0）可选配置 */
  mem0?: { endpoint: string; apiKey?: string; enabled: boolean };
  /** RAG 知识库配置 */
  rag?: {
    enabled: boolean;
    vectorDbUrl?: string;
    embeddingUrl?: string;
    embeddingModel?: string;
    chunkSize?: number;
    chunkOverlap?: number;
    topK?: number;
    rerankUrl?: string;
    rerankModel?: string;
    storagePath?: string;
  };
  /** 安全围栏：约束 Agent 的工具执行边界 */
  /** 中继连接配置（多端协作模式） */
  relay?: { url?: string; key?: string };
  /** 云端服务器地址（多端协作登录用，如 your-server:8787） */
  cloudHost?: string;
  security?: {
    /** 是否允许联网（web_search/web_fetch） */
    allowNetwork?: boolean;
    /** 是否允许读文件 */
    allowFileRead?: boolean;
    /** 是否允许写文件 */
    allowFileWrite?: boolean;
    /** 命令白名单（前缀匹配；空 = 全允许） */
    allowedCommands?: string[];
    /** 命令黑名单（子串匹配） */
    blockedCommands?: string[];
    /** 危险命令开关（rm -rf / format / shutdown 等） */
    allowDangerousCommands?: boolean;
  };
  /** IM / 平台运行时配置（不设时行为与硬编码默认值一致） */
  im?: {
    dedupWindowMs?: number;           // 默认 2000
    dedupCleanupIntervalMs?: number;  // 默认 60000
    sessionTtlDays?: number;          // 默认 30
    maxUploadMb?: number;             // 默认 100
    toolConfirmTimeoutMin?: number;   // 默认 5
    maxTokens?: number;               // 默认 1024
    maintenanceIntervalH?: number;    // 默认 24
    rateLimit?: { windowMs?: number; max?: number };
    ws?: { maxPayloadMb?: number; pingIntervalS?: number; batchIntervalMs?: number };
  };
}
