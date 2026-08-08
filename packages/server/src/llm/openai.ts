import type {
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResult,
  LLMStreamEvent,
  LLMToolCall,
  ProviderRuntimeConfig,
} from "./types";
import { parseSse, throwOnHttpError } from "./sse";
import type { Usage } from "@ensemble/shared";

/**
 * OpenAI 兼容 Chat Completions provider（OpenRouter / DeepSeek / Ollama / 自定义端点）。
 * type 为 "openai" 或 "custom"（自定义端点 = 兼容特例，可覆盖 Authorization 头）。
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string;
  readonly type: "openai" | "custom";
  private baseUrl: string;
  private apiKey?: string;
  private extraHeaders?: Record<string, string>;
  private defaultModel?: string;

  constructor(cfg: ProviderRuntimeConfig) {
    this.id = cfg.id;
    this.type = cfg.type === "custom" ? "custom" : "openai";
    this.baseUrl = (cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.apiKey = cfg.apiKey;
    this.extraHeaders = cfg.extraHeaders;
    this.defaultModel = cfg.defaultModel;
  }

  private headers() {
    const h: Record<string, string> = {
      "content-type": "application/json",
      ...this.extraHeaders,
    };
    if (this.apiKey) {
      h["authorization"] = this.apiKey.startsWith("Bearer ") ? this.apiKey : `Bearer ${this.apiKey}`;
    }
    return h;
  }

  private buildBody(req: LLMRequest, stream: boolean): Record<string, unknown> {
    return {
      model: req.model,
      messages: req.messages.map((m) => mapMessage(m)),
      temperature: req.temperature ?? 0.7,
      ...(req.tools?.length
        ? {
            tools: req.tools.map((t) => ({
              type: "function" as const,
              function: { name: t.name, description: t.description, parameters: t.input_schema },
            })),
            tool_choice: "auto",
          }
        : {}),
      stream,
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
    };
  }

  async chat(req: LLMRequest): Promise<LLMResult> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(req, false)),
      signal: req.signal,
    });
    await throwOnHttpError(res, "openai");
    const data = (await res.json()) as any;
    const choice = data.choices?.[0];
    const msg = choice?.message;

    return {
      text: typeof msg?.content === "string" ? msg.content : "",
      toolCalls: (msg?.tool_calls ?? []).map((tc: any) => ({
        id: tc.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
        name: tc.function?.name ?? "unknown",
        input: parseArgs(tc.function?.arguments),
      })),
      usage: data.usage ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens } : undefined,
      stopReason: choice?.finish_reason,
    };
  }

  async *stream(req: LLMRequest): AsyncGenerator<LLMStreamEvent> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(req, true)),
      signal: req.signal,
    });
    await throwOnHttpError(res, "openai");

    // tool call 累积：index → { id, name, argsJson }
    const toolBuf = new Map<number, { id: string; name: string; argsJson: string }>();
    let usage: Usage = {};

    for await (const frame of parseSse(res.body, req.signal)) {
      if (frame.data === "[DONE]") break;
      let ev: any;
      try {
        ev = JSON.parse(frame.data);
      } catch {
        continue;
      }
      const choice = ev.choices?.[0];
      const delta = choice?.delta ?? {};

      if (typeof delta.reasoning_content === "string") {
        yield { type: "thinking_delta", text: delta.reasoning_content };
      }
      if (typeof delta.content === "string") {
        yield { type: "text_delta", text: delta.content };
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const buf = toolBuf.get(idx) ?? { id: "", name: "", argsJson: "" };
          if (tc.id) buf.id = tc.id;
          if (tc.function?.name) buf.name += tc.function.name;
          if (tc.function?.arguments) buf.argsJson += tc.function.arguments;
          toolBuf.set(idx, buf);
        }
      }
      if (choice?.finish_reason === "tool_calls") {
        for (const [, buf] of toolBuf) {
          yield {
            type: "tool_call",
            call: {
              id: buf.id || `call_${Math.random().toString(36).slice(2, 10)}`,
              name: buf.name || "unknown",
              input: parseArgs(buf.argsJson),
            },
          };
        }
        toolBuf.clear();
      }
      if (ev.usage) {
        usage = { inputTokens: ev.usage.prompt_tokens, outputTokens: ev.usage.completion_tokens };
      }
    }

    // 流结束但未通过 finish_reason 发出 tool_call（异常场景）
    if (toolBuf.size) {
      for (const [, buf] of toolBuf) {
        yield {
          type: "tool_call",
          call: {
            id: buf.id || `call_${Math.random().toString(36).slice(2, 10)}`,
            name: buf.name || "unknown",
            input: parseArgs(buf.argsJson),
          },
        };
      }
    }
    yield { type: "usage", usage };
    yield { type: "done" };
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as any;
      return (data.data ?? []).map((m: any) => m.id).slice(0, 200);
    } catch {
      return [];
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const models = await this.listModels();
      if (models.length) return { ok: true, message: `ok · ${models.length} models` };
      // 部分端点无 /models，改用最小 chat 验证
      await this.chat({
        model: this.defaultModel ?? "gpt-4o-mini",
        messages: [{ role: "user", content: "Reply with: ok" }],
        maxTokens: 8,
      });
      return { ok: true, message: "connection ok" };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}

function mapMessage(m: LLMMessage): Record<string, unknown> {
  if (m.role === "system" || m.role === "user") return { role: m.role, content: m.content };
  if (m.role === "tool") return { role: "tool", tool_call_id: m.tool_call_id, content: m.content };
  const asst = m as Extract<LLMMessage, { role: "assistant" }>;
  return {
    role: "assistant",
    content: asst.content || null,
    ...(asst.tool_calls?.length
      ? {
          tool_calls: asst.tool_calls.map((c) => ({
            id: c.id,
            type: "function" as const,
            function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
          })),
        }
      : {}),
  };
}

function parseArgs(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
