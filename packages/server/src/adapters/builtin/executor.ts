import { join } from "node:path";
import type { AgentConfig, AgentTaskInput, AgentEvent } from "@jungle/shared";
import type { AgentAdapter } from "../types";
import { runAgenticLoop } from "./loop";
import type { ProviderRegistry } from "../../llm/registry";
import type { ToolRegistry } from "../../tools/types";
import type { AppSettings } from "@jungle/shared";
import { ContextManager } from "../../context/manager";
import type { LoopHook } from "../../hooks/types";

export interface BuiltinAdapterDeps {
  providerRegistry: ProviderRegistry;
  toolRegistry: ToolRegistry;
  appSettings: () => AppSettings;
  /** 工具确认回调（桌面 IPC 弹窗；缺省自动允许） */
  askConfirm?: (tool: string, args: unknown) => Promise<boolean>;
  /** 大工具结果 offload 基础目录（<dataDir>/offload） */
  offloadBaseDir?: string;
  /** 记忆 provider（P2；未注入则跳过记忆 hook） */
  memoryProvider?: import("../../memory/provider").MemoryProvider;
  /** skill 池（S2；未注入则跳过 skill 注入） */
  skillStore?: import("../../skills").SkillStore;
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

    // 组装 system prompt：基础角色 + 启用的 skill（全量注入 SKILL.md 正文）
    let systemPrompt = this.cfg.systemPrompt ?? "";
    if (this.deps.skillStore && this.cfg.skills?.length) {
      const skills = this.deps.skillStore.forNames(this.cfg.skills);
      if (skills.length) {
        const skillBlock = skills
          .map((s) => `## Skill: ${s.name}\n${s.description}\n\n${s.body}`)
          .join("\n\n---\n\n");
        systemPrompt = `${systemPrompt ? systemPrompt + "\n\n" : ""}以下是你可用的技能，任务相关时按技能方法执行：\n\n${skillBlock}`;
      }
    }

    // offload 目录：仅当工作区存在时写入工作区内（模型可用 read_file 读取全量）；
    // 无工作区时禁用 offload（避免写入模型不可读的目录，大结果直接截断）
    const wsRoot = this.deps.appSettings().workspaceRoot || this.cfg.cwd || undefined;
    const offloadDir = wsRoot ? join(wsRoot, ".jungle-system-offload") : undefined;

    // 上下文压缩器（主动压缩 + 大结果 offload + overflow 恢复）
    const ctxManager = new ContextManager({
      config: this.cfg.context ?? {},
      summarize: async (msgs) => {
        const r = await provider.chat({
          model: this.cfg.memory?.model ?? this.cfg.model,
          messages: msgs,
          maxTokens: 1024,
        });
        return r.text;
      },
      offloadDir,
    });

    // hooks：记忆注入（P2）
    const hooks: LoopHook[] = [];
    if (this.cfg.memory?.enabled && this.deps.memoryProvider) {
      const { MemoryHook } = await import("../../hooks/memory");
      hooks.push(new MemoryHook(this.deps.memoryProvider, this.cfg));
    }

    // 超时支持：组合外部 signal 与 timeout（超时 → aborted → cancelled）
    let signal = input.signal;
    if (input.timeoutMs) {
      const base = signal ?? new AbortController().signal;
      signal = AbortSignal.any([base, AbortSignal.timeout(input.timeoutMs)]);
    }

    yield* runAgenticLoop({
      provider,
      model: this.cfg.model,
      systemPrompt,
      prompt: input.prompt,
      context: input.context,
      tools,
      temperature: this.cfg.temperature,
      maxTokens: this.cfg.maxTokens,
      maxIterations: this.cfg.maxIterations ?? 10,
      ctxBudgetTokens: this.cfg.context?.budgetTokens ?? 80_000,
      signal,
      workspaceRoot: this.deps.appSettings().workspaceRoot || this.cfg.cwd || undefined,
      cwd: this.cfg.cwd,
      agentId: this.cfg.id,
      appSettings: this.deps.appSettings(),
      askConfirm: this.deps.askConfirm,
      ctxManager,
      hooks,
      offloadDir,
      toolResultOffloadChars: this.cfg.context?.toolResultOffloadChars,
    });
  }

  async cancel(): Promise<void> {
    /* 由 AbortSignal 驱动 */
  }

  async dispose(): Promise<void> {
    /* 无资源 */
  }
}
