import type { AgentEvent, AppSettings } from "@multiagent/shared";
import type { LLMMessage, LLMProvider, LLMRequest, LLMTool, LLMToolCall } from "../../llm/types";
import type { AgentTool, ToolContext } from "../../tools/types";
import type { ContextManager } from "../../context/manager";
import { OffloadStore, previewWithPointer, shouldOffload } from "../../context/offload";
import { HookManager } from "../../hooks/manager";
import type { LoopContext, LoopHook } from "../../hooks/types";

export interface LoopOptions {
  provider: LLMProvider;
  model: string;
  systemPrompt?: string;
  prompt: string;
  context?: string;
  tools: AgentTool[];
  temperature?: number;
  maxTokens?: number;
  maxIterations: number;
  ctxBudgetTokens: number;
  signal?: AbortSignal;
  workspaceRoot?: string;
  cwd?: string;
  agentId: string;
  appSettings?: AppSettings;
  askConfirm?: (tool: string, args: unknown) => Promise<boolean>;
  /** 可插拔 hooks */
  hooks?: LoopHook[];
  /** 上下文压缩器 */
  ctxManager?: ContextManager;
  /** 大工具结果 offload 目录 */
  offloadDir?: string;
  toolResultOffloadChars?: number;
}

/**
 * Agentic 工具循环（hook 驱动）：
 * preReasoning（记忆注入/压缩）→ LLM 流式 → postReasoning → 执行工具 → postToolResult → postCall。
 * 产出归一化 AgentEvent，对齐 run_events 表与前端 LogLine。
 */
export async function* runAgenticLoop(opts: LoopOptions): AsyncGenerator<AgentEvent> {
  const msgs: LLMMessage[] = [];
  if (opts.systemPrompt) msgs.push({ role: "system", content: opts.systemPrompt });
  if (opts.context) msgs.push({ role: "user", content: `[进行中的对话记录]\n${opts.context}` });
  msgs.push({ role: "user", content: opts.prompt });

  const llmTools: LLMTool[] = opts.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  const ctx: LoopContext = {
    provider: opts.provider,
    model: opts.model,
    agentId: opts.agentId,
    msgs,
    llmTools,
    ctxManager: opts.ctxManager,
    signal: opts.signal,
    vars: { prompt: opts.prompt, pendingFlushes: [] as Promise<void>[] },
  };
  const hooks = new HookManager();
  for (const h of opts.hooks ?? []) hooks.add(h);

  const offload = opts.offloadDir ? new OffloadStore(opts.offloadDir) : undefined;
  const offloadChars = opts.toolResultOffloadChars ?? 8000;

  yield { type: "status", status: "starting", detail: opts.model, ts: Date.now() };

  let usage;
  let finalText = "";

  for (let iter = 1; iter <= opts.maxIterations; iter++) {
    if (opts.signal?.aborted) {
      yield { type: "status", status: "cancelled", ts: Date.now() };
      yield { type: "done", outcome: "cancelled", result: "cancelled by user", ts: Date.now() };
      return;
    }

    // preReasoning：记忆注入 + 上下文压缩
    await hooks.run("preReasoning", ctx);
    if (ctx.ctxManager) {
      const r = await ctx.ctxManager.prepare(ctx.msgs, opts.agentId);
      ctx.msgs = r.messages;
      if (r.compacted) {
        yield { type: "status", status: "running", detail: `context compacted (freed ~${r.freedTokens ?? 0} tokens)`, ts: Date.now() };
      }
      if (r.offloaded > 0) {
        yield { type: "status", status: "running", detail: `offloaded ${r.offloaded} large tool result(s)`, ts: Date.now() };
      }
    }

    // LLM 调用（overflow 恢复重试）
    let text = "";
    const calls: LLMToolCall[] = [];
    let retried = false;

    for (;;) {
      const req: LLMRequest = {
        model: opts.model,
        messages: ctx.msgs,
        tools: llmTools.length ? llmTools : undefined,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        signal: opts.signal,
      };
      try {
        for await (const ev of opts.provider.stream(req)) {
          switch (ev.type) {
            case "text_delta":
              text += ev.text;
              yield { type: "output", kind: "text", text: ev.text, ts: Date.now() };
              break;
            case "thinking_delta":
              yield { type: "output", kind: "thinking", text: ev.text, ts: Date.now() };
              break;
            case "tool_call":
              calls.push(ev.call);
              yield { type: "tool_use", tool: ev.call.name, input: ev.call.input, ts: Date.now() };
              break;
            case "usage":
              usage = ev.usage;
              break;
          }
        }
        break;
      } catch (err) {
        if (opts.signal?.aborted) {
          yield { type: "status", status: "cancelled", ts: Date.now() };
          yield { type: "done", outcome: "cancelled", result: "cancelled by user", ts: Date.now() };
          return;
        }
        // 内置 overflow 恢复（无需 hook）：极端压缩 + 重试一次
        if (!retried && ctx.ctxManager?.isContextLengthError(err)) {
          retried = true;
          const recovered = await ctx.ctxManager.recoverFromOverflow(ctx.msgs, opts.agentId);
          ctx.msgs = recovered.messages;
          yield { type: "status", status: "running", detail: "context overflow recovered, retrying", ts: Date.now() };
          continue;
        }
        const res = await hooks.runError(ctx, err);
        if (res?.retry && !retried) {
          retried = true;
          if (res.messages) ctx.msgs = res.messages;
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        yield { type: "error", message, code: (err as any)?.code, ts: Date.now() };
        yield { type: "done", outcome: "error", result: message, ts: Date.now() };
        return;
      }
    }

    ctx.msgs.push({ role: "assistant", content: text, tool_calls: calls });
    await hooks.run("postReasoning", ctx);

    if (calls.length === 0) {
      finalText = text;
      // 最终轮也触发 postCall（记忆 flush），随后 await pendingFlushes
      await hooks.run("postCall", ctx);
      break;
    }

    // 执行工具调用
    for (const call of calls) {
      if (opts.signal?.aborted) break;
      const tool = opts.tools.find((t) => t.name === call.name);
      if (!tool) {
        ctx.msgs.push({ role: "tool", tool_call_id: call.id, content: `unknown tool: ${call.name}` });
        continue;
      }

      if (tool.requiresConfirmation && opts.askConfirm) {
        const ok = await opts.askConfirm(tool.name, call.input);
        if (!ok) {
          ctx.msgs.push({ role: "tool", tool_call_id: call.id, content: "[user cancelled execution]" });
          continue;
        }
      }

      const toolCtx: ToolContext = {
        cwd: opts.cwd,
        workspaceRoot: opts.workspaceRoot,
        signal: opts.signal,
        agentId: opts.agentId,
        appSettings: opts.appSettings,
        askConfirm: opts.askConfirm,
      };

      const result = await runToolSafe(tool, call.input, toolCtx);

      // 插入时 offload：大结果写盘 + 预览 + read_file 指针
      let clipped = result;
      if (offload && shouldOffload(call.name, result.length, offloadChars)) {
        const relPath = offload.store(opts.agentId, result);
        clipped = previewWithPointer(result, relPath);
        yield { type: "status", status: "running", detail: `tool result offloaded (${call.name})`, ts: Date.now() };
      } else {
        clipped = result.slice(0, offloadChars);
      }

      ctx.msgs.push({ role: "tool", tool_call_id: call.id, content: clipped });
      yield { type: "tool_result", tool: call.name, output: clipped, ts: Date.now() };
      await hooks.run("postToolResult", ctx, call.name, clipped);
    }

    await hooks.run("postCall", ctx);
  }

  // done 前等待挂起的记忆 flush（≤5s 超时，不阻塞）
  const pending = ctx.vars.pendingFlushes as Promise<void>[] | undefined;
  if (pending?.length) {
    try {
      await Promise.race([Promise.all(pending), sleep(5000)]);
    } catch {
      /* flush 失败不阻塞完成 */
    }
  }

  if (finalText) {
    yield { type: "status", status: "success", ts: Date.now() };
    yield { type: "done", outcome: "success", result: finalText, usage, ts: Date.now() };
  } else if (!opts.signal?.aborted) {
    yield { type: "done", outcome: "max_turns", result: "reached max iterations without final answer", usage, ts: Date.now() };
  }
}

async function runToolSafe(tool: AgentTool, input: unknown, ctx: ToolContext): Promise<string> {
  try {
    return await tool.execute(input, ctx);
  } catch (err) {
    return `tool error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
