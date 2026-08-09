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
  createdAt: string;
  updatedAt: string;
}

export interface McpServerStatus {
  id: string;
  connected: boolean;
  error?: string;
  toolCount: number;
}

/** 工具全名：mcp__<serverId>__<tool> */
export function mcpToolFullName(serverId: string, tool: string): string {
  return `mcp__${serverId}__${tool}`;
}

export function isMcpToolName(name: string): boolean {
  return name.startsWith("mcp__");
}
