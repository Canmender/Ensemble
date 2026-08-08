import type { AgentConfig, AgentTaskInput, AgentEvent } from "@multiagent/shared";
import type { AgentAdapter } from "../types";
import { runAgenticLoop } from "./loop";
import type { ProviderRegistry } from "../../llm/registry";
import type { ToolRegistry } from "../../tools/types";
import type { AppSettings } from "@multiagent/shared";

export interface BuiltinAdapterDeps {
  providerRegistry: ProviderRegistry;
  toolRegistry: ToolRegistry;
  appSettings: () => AppSettings;
  /** 工具确认回调（桌面 IPC 弹窗；缺省自动允许） */
  askConfirm?: (tool: string, args: unknown) => Promise<boolean>;
}

/**
 * 内置 Agent 执行器：实现统一的 AgentAdapter 契约，
 * 使现有编排引擎三种模式（single/workflow/chat）零改动复用。
 * 内部走 LLM Provider + 工具循环。
 */
export class BuiltinAgentExecutor implements AgentAdapter {
  readonly kind = "builtin" as const;
  private cfg: AgentConfig;
  private deps: BuiltinAdapterDeps;

  constructor(cfg: AgentConfig, deps: BuiltinAdapterDeps) {
    this.cfg = cfg;
    this.deps = deps;
  }

  get capabilities() {
    return this.cfg.capabilities;
  }

  async *startTask(input: AgentTaskInput): AsyncGenerator<AgentEvent> {
    const provider = this.deps.providerRegistry.get(this.cfg.providerId);
    if (!provider) {
      yield { type: "error", message: `provider not configured: ${this.cfg.providerId}`, code: "provider_missing", ts: Date.now() };
      yield { type: "done", outcome: "error", result: "provider_missing", ts: Date.now() };
      return;
    }
    if (!this.cfg.model) {
      yield { type: "error", message: "agent has no model configured", code: "model_missing", ts: Date.now() };
      yield { type: "done", outcome: "error", result: "model_missing", ts: Date.now() };
      return;
    }

    const tools = this.deps.toolRegistry.forNames(this.cfg.tools);

    yield* runAgenticLoop({
      provider,
      model: this.cfg.model,
      systemPrompt: this.cfg.systemPrompt,
      prompt: input.prompt,
      context: input.context,
      tools,
      temperature: this.cfg.temperature,
      maxTokens: this.cfg.maxTokens,
      maxIterations: this.cfg.maxIterations ?? 10,
      ctxBudgetTokens: 80_000,
      signal: input.signal,
      workspaceRoot: this.deps.appSettings().workspaceRoot || this.cfg.cwd || undefined,
      cwd: this.cfg.cwd,
      agentId: this.cfg.id,
      appSettings: this.deps.appSettings(),
      askConfirm: this.deps.askConfirm,
    });
  }

  async cancel(): Promise<void> {
    /* 由 AbortSignal 驱动 */
  }

  async dispose(): Promise<void> {
    /* 无资源 */
  }
}
