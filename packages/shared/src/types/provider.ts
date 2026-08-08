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
}
