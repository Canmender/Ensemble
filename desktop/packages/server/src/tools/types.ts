import type { LLMTool } from "../llm/types";
import type { AppSettings } from "@ensemble/shared";

export interface ToolContext {
  cwd?: string;
  workspaceRoot?: string;
  signal?: AbortSignal;
  agentId: string;
  appSettings?: AppSettings;
  /** 需要用户确认的工具回调（WS 弹窗；CLI/headless 返回 false） */
  askConfirm?: (tool: string, args: unknown, runId?: string) => Promise<boolean>;
}

/** 可插拔 Agent 工具 */
export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema（object） */
  parameters: Record<string, unknown>;
  requiresConfirmation?: boolean;
  execute(input: unknown, ctx: ToolContext): Promise<string>;
}

export class ToolRegistry {
  private map = new Map<string, AgentTool>();

  register(t: AgentTool): void {
    this.map.set(t.name, t);
  }

  unregister(name: string): void {
    this.map.delete(name);
  }

  list(): AgentTool[] {
    return [...this.map.values()];
  }

  /** 按 agent 配置过滤 */
  forNames(names: string[]): AgentTool[] {
    return names
      .map((n) => this.map.get(n))
      .filter((t): t is AgentTool => !!t);
  }

  /** 转成 LLM 工具定义 */
  toLLMTools(tools: AgentTool[]): LLMTool[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  /** 可用工具名列表（供前端渲染） */
  names(): string[] {
    return [...this.map.keys()];
  }
}
