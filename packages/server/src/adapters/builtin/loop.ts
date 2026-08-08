import type { AgentEvent, AppSettings } from "@multiagent/shared";
import type { LLMMessage, LLMProvider, LLMRequest, LLMTool, LLMToolCall } from "../../llm/types";
import type { AgentTool, ToolContext } from "../../tools/types";
import { truncateToTokens } from "./context";

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
}

/**
 * Agentic 工具循环：LLM 流式输出 → 检测 tool_call → 执行工具 → 回填 → 继续。
 * 全部归一化为 AgentEvent（对齐 run_events 表与前端 LogLine）。
 */
export async function* runAgenticLoop(opts: LoopOptions): AsyncGenerator<AgentEvent> {
  const msgs: LLMMessage[] = [];
  if (opts.systemPrompt) msgs.push({ role: "system", content: opts.systemPrompt });
  if (opts.context) msgs.push({ role: "user", content: `[进行中的对话记录]\n${opts.context}` });
  msgs.push({ role: "user", content: opts.prompt });

  yield { type: "status", status: "starting", detail: opts.model, ts: Date.now() };

  const llmTools: LLMTool[] = opts.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  let usage;
  let finalText = "";

  for (let iter = 1; iter <= opts.maxIterations; iter++) {
    if (opts.signal?.aborted) {
      yield { type: "status", status: "cancelled", ts: Date.now() };
      yield { type: "done", outcome: "cancelled", result: "cancelled by user", ts: Date.now() };
      return;
    }

    const req: LLMRequest = {
      model: opts.model,
      messages: truncateToTokens(msgs, opts.ctxBudgetTokens),
      tools: llmTools.length ? llmTools : undefined,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      signal: opts.signal,
    };

    let text = "";
    const calls: LLMToolCall[] = [];

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
    } catch (err) {
      if (opts.signal?.aborted) {
        yield { type: "status", status: "cancelled", ts: Date.now() };
        yield { type: "done", outcome: "cancelled", result: "cancelled by user", ts: Date.now() };
      } else {
        const message = err instanceof Error ? err.message : String(err);
        yield { type: "error", message, code: (err as any)?.code, ts: Date.now() };
        yield { type: "done", outcome: "error", result: message, ts: Date.now() };
      }
      return;
    }

    msgs.push({ role: "assistant", content: text, tool_calls: calls });

    if (calls.length === 0) {
      finalText = text;
      break;
    }

    // 执行工具调用
    for (const call of calls) {
      if (opts.signal?.aborted) break;
      const tool = opts.tools.find((t) => t.name === call.name);
      if (!tool) {
        msgs.push({ role: "tool", tool_call_id: call.id, content: `unknown tool: ${call.name}` });
        continue;
      }

      if (tool.requiresConfirmation && opts.askConfirm) {
        const ok = await opts.askConfirm(tool.name, call.input);
        if (!ok) {
          msgs.push({ role: "tool", tool_call_id: call.id, content: "[user cancelled execution]" });
          continue;
        }
      }

      const ctx: ToolContext = {
        cwd: opts.cwd,
        workspaceRoot: opts.workspaceRoot,
        signal: opts.signal,
        agentId: opts.agentId,
        appSettings: opts.appSettings,
        askConfirm: opts.askConfirm,
      };

      const result = await runToolSafe(tool, call.input, ctx);
      const clipped = result.slice(0, 8000);
      msgs.push({ role: "tool", tool_call_id: call.id, content: clipped });
      yield { type: "tool_result", tool: call.name, output: clipped, ts: Date.now() };
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
