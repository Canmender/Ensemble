import type { AgentEvent, AppSettings } from "@ensemble/shared";
import type { SteeringMessage } from "../types";
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
  /**
   * Steering 消息队列（参考 OpenClaw）：
   * 用户在 agent 执行中发送的消息会进入此队列，
   * 在每个迭代检查点（工具执行前）注入上下文。
   * agent 会在下一轮 LLM 调用中看到这些消息。
   */
  steeringQueue?: SteeringMessage[];
}

/** 工具调用签名（用于循环检测） */
function toolCallSignature(call: LLMToolCall): string {
  return `${call.name}:${JSON.stringify(call.input)}`;
}

/**
 * Agentic 工具循环（hook 驱动）：
 * preReasoning（记忆注入/压缩）→ LLM 流式 → postReasoning → 执行工具 → postToolResult → postCall。
 * 产出归一化 AgentEvent，对齐 run_events 表与前端 LogLine。
 *
 * 增强（参考 OpenClaw）：
 * - 工具循环检测：相同工具+参数连续调用 3 次 → 自动终止
 * - 上下文自动压缩：token 使用达阈值时触发
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

  // 工具循环检测状态（参考 OpenClaw toolLoopRecovery）
  // 改进：检查窗口内的重复模式，而非仅连续重复
  const toolLoopState = {
    recentSignatures: [] as string[],
    maxWindowSize: 12,     // 检查最近 12 个签名
    maxDuplicates: 3,      // 同一签名出现 3 次视为循环
    terminated: false,
  };

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

    // Steering 消息检查（参考 OpenClaw steering messages）
    // 用户在 agent 执行中发送的消息在此注入，LLM 下一轮可见
    if (opts.steeringQueue && opts.steeringQueue.length > 0) {
      const steering = opts.steeringQueue.splice(0, opts.steeringQueue.length);
      for (const msg of steering) {
        ctx.msgs.push({ role: "user", content: `[用户追加] ${msg.content}` });
        yield { type: "status", status: "running", detail: `已注入用户消息: ${msg.content.slice(0, 50)}...`, ts: Date.now() };
      }
    }

    // 工具循环检测（参考 OpenClaw toolLoopRecovery，改进：窗口内重复检测）
    // 检测同一工具+参数在窗口内重复出现，防止死循环浪费 token
    for (const call of calls) {
      const sig = toolCallSignature(call);
      toolLoopState.recentSignatures.push(sig);
      // 维护滑动窗口
      if (toolLoopState.recentSignatures.length > toolLoopState.maxWindowSize) {
        toolLoopState.recentSignatures.shift();
      }
    }

    // 检查窗口内是否有签名重复超过阈值
    const sigCounts = new Map<string, number>();
    for (const sig of toolLoopState.recentSignatures) {
      sigCounts.set(sig, (sigCounts.get(sig) ?? 0) + 1);
    }
    const maxEntry = [...sigCounts.entries()].reduce(
      (max, entry) => entry[1] > max[1] ? entry : max,
      ["", 0],
    );

    if (maxEntry[1] >= toolLoopState.maxDuplicates) {
      toolLoopState.terminated = true;
      const loopTool = calls[0]?.name ?? "unknown";
      const message = `工具循环检测：${loopTool} 在最近 ${toolLoopState.maxWindowSize} 次调用中重复 ${maxEntry[1]} 次相同参数，自动终止以避免浪费。`;
      yield { type: "status", status: "running", detail: message, ts: Date.now() };
      yield { type: "tool_result", tool: "loop_detector", output: message, ts: Date.now() };
      // 注入一条系统消息告知 LLM 循环已终止
      ctx.msgs.push({ role: "user", content: `[系统] ${message} 请换一种方法或直接给出结论。` });
      toolLoopState.recentSignatures = [];
      continue; // 给 LLM 一次机会调整策略
    }

    // 执行工具调用（并行：独立工具同时执行，3-5× 加速；结果按调用顺序回填）
    if (calls.length > 0 && !opts.signal?.aborted) {
      // 1) 确认（串行，yield 等待状态）
      const confirmOk = new Map<string, boolean>();
      for (const call of calls) {
        const tool = opts.tools.find((t) => t.name === call.name);
        if (tool?.requiresConfirmation && opts.askConfirm) {
          // HITL：发出等待状态（前端 run/看板显示"等待输入"）
          yield { type: "status", status: "thinking", detail: `等待用户确认执行 ${tool.name}`, ts: Date.now() };
          // abort 时不再等待确认弹窗（避免取消被阻塞）
          confirmOk.set(call.id, await Promise.race([
            opts.askConfirm(tool.name, call.input),
            abortPromise(opts.signal).then(() => false),
          ]));
        }
      }

      // 2) 并行执行独立工具（abort 时不等待慢工具，回填为空 → 下轮取消）
      const results = await Promise.race([
        Promise.all(
          calls.map(async (call) => {
          const tool = opts.tools.find((t) => t.name === call.name);
          if (!tool) {
            return { call, toolName: call.name, content: `unknown tool: ${call.name}`, offloaded: false };
          }
          if (confirmOk.get(call.id) === false) {
            return { call, toolName: tool.name, content: "[user cancelled execution]", offloaded: false };
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

          // 插入时 offload：大结果写盘 + 预览 + read_file 指针（完整路径，工作区内可读）
          if (offload && shouldOffload(tool.name, result.length, offloadChars)) {
            const relPath = offload.store(opts.agentId, result);
            const readPath = opts.offloadDir ? `${opts.offloadDir}/${relPath}` : relPath;
            return { call, toolName: tool.name, content: previewWithPointer(result, readPath), offloaded: true };
          }
          return { call, toolName: tool.name, content: result.slice(0, offloadChars), offloaded: false };
        }),
        ),
        abortPromise(opts.signal).then(() => [] as any[]),
      ]);

      // 3) 按调用顺序回填 tool 消息 + 事件
      for (const r of results) {
        if (opts.signal?.aborted) break;
        if (r.offloaded) {
          yield { type: "status", status: "running", detail: `tool result offloaded (${r.toolName})`, ts: Date.now() };
        }
        ctx.msgs.push({ role: "tool", tool_call_id: r.call.id, content: r.content });
        yield { type: "tool_result", tool: r.toolName, output: r.content, ts: Date.now() };
        await hooks.run("postToolResult", ctx, r.toolName, r.content);
      }
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

/** abort 时 resolve（用于确认弹窗/慢工具的取消竞速） */
function abortPromise(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    signal?.addEventListener("abort", () => resolve(), { once: true });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
