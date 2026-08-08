import type { AgentConfig } from "@ensemble/shared";
import type { LoopContext, LoopHook } from "./types";
import type { MemoryProvider } from "../memory/provider";

/** 记忆 hook：preReasoning 注入 MEMORY.md；postCall 调度 flush（异步） */
export class MemoryHook implements LoopHook {
  readonly name = "memory";

  constructor(
    private provider: MemoryProvider,
    private cfg: AgentConfig,
  ) {}

  async preReasoning(ctx: LoopContext): Promise<void> {
    // 仅首轮注入一次（用 vars 标记，避免多轮重复累积记忆）
    if (ctx.vars.memoryInjected) return;
    if (ctx.msgs[0]?.role === "system") {
      const injected = await this.provider.inject(ctx.msgs[0].content, ctx.agentId);
      if (injected !== ctx.msgs[0].content) {
        ctx.msgs[0] = { ...ctx.msgs[0], content: injected };
      }
    }
    ctx.vars.memoryInjected = true;
  }

  async postCall(ctx: LoopContext): Promise<void> {
    // 字符串快照（防 compaction 并发改写），异步 flush 入队
    const transcript = ctx.msgs.map((m) => `[${m.role}] ${m.content}`).join("\n");
    const prompt = String(ctx.vars.prompt ?? "");
    const flushPromise = this.provider.scheduleFlush(ctx.agentId, transcript, prompt);
    if (flushPromise) {
      const pending = ctx.vars.pendingFlushes as Promise<void>[] | undefined;
      pending?.push(flushPromise);
    }
  }
}
