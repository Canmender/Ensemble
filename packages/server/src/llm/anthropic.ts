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
import type { Usage } from "@jungle/shared";

const ANTHROPIC_DEFAULT_MODELS = [
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
];

/** Anthropic Messages API provider（SSE 流式） */
export class AnthropicProvider implements LLMProvider {
  readonly id: string;
  readonly type = "anthropic" as const;
  private baseUrl: string;
  private apiKey?: string;

  constructor(cfg: ProviderRuntimeConfig) {
    this.id = cfg.id;
    this.baseUrl = (cfg.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
    this.apiKey = cfg.apiKey;
  }

  private headers() {
    const h: Record<string, string> = {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (this.apiKey) h["x-api-key"] = this.apiKey;
    return h;
  }

  private buildBody(req: LLMRequest, stream: boolean): Record<string, unknown> {
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const messages = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => mapMessage(m));

    return {
      model: req.model,
      ...(system ? { system } : {}),
      messages,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.7,
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })) } : {}),
      stream,
    };
  }

  async chat(req: LLMRequest): Promise<LLMResult> {
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(req, false)),
      signal: req.signal,
    });
    await throwOnHttpError(res, "anthropic");
    const data = (await res.json()) as any;

    const text = (data.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    const toolCalls: LLMToolCall[] = (data.content ?? [])
      .filter((b: any) => b.type === "tool_use")
      .map((b: any) => ({ id: b.id, name: b.name, input: b.input }));

    return {
      text,
      toolCalls,
      usage: data.usage ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens } : undefined,
      stopReason: data.stop_reason,
    };
  }

  async *stream(req: LLMRequest): AsyncGenerator<LLMStreamEvent> {
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(req, true)),
      signal: req.signal,
    });
    await throwOnHttpError(res, "anthropic");

    // tool call 累积：index → { id, name, inputJson }
    const toolBuf = new Map<number, { id: string; name: string; inputJson: string }>();
    let usage: Usage = {};

    for await (const frame of parseSse(res.body, req.signal)) {
      if (frame.data === "[DONE]") continue;
      let ev: any;
      try {
        ev = JSON.parse(frame.data);
      } catch {
        continue;
      }
      switch (ev.type) {
        case "message_start":
          if (ev.message?.usage) {
            usage.inputTokens = ev.message.usage.input_tokens;
          }
          break;
        case "content_block_start": {
          const cb = ev.content_block;
          if (cb?.type === "tool_use") {
            toolBuf.set(ev.index, { id: cb.id, name: cb.name, inputJson: "" });
          }
          break;
        }
        case "content_block_delta": {
          const d = ev.delta;
          if (d?.type === "text_delta") yield { type: "text_delta", text: d.text };
          else if (d?.type === "thinking_delta") yield { type: "thinking_delta", text: d.thinking };
          else if (d?.type === "input_json_delta") {
            const buf = toolBuf.get(ev.index);
            if (buf) buf.inputJson += d.partial_json ?? "";
          }
          break;
        }
        case "content_block_stop": {
          const buf = toolBuf.get(ev.index);
          if (buf) {
            toolBuf.delete(ev.index);
            let input: unknown;
            try {
              input = JSON.parse(buf.inputJson || "{}");
            } catch {
              input = {};
            }
            yield { type: "tool_call", call: { id: buf.id, name: buf.name, input } };
          }
          break;
        }
        case "message_delta":
          if (ev.usage?.output_tokens !== undefined) usage.outputTokens = ev.usage.output_tokens;
          break;
        case "message_stop":
          yield { type: "usage", usage };
          yield { type: "done" };
          return;
      }
    }
    // 流意外结束
    yield { type: "usage", usage };
    yield { type: "done" };
  }

  async listModels(): Promise<string[]> {
    return [...ANTHROPIC_DEFAULT_MODELS];
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.chat({
        model: "claude-haiku-4-5",
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
  if (m.role === "user") return { role: "user", content: m.content };
  if (m.role === "tool") {
    return { role: "user", content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content }] };
  }
  // assistant
  const asst = m as Extract<LLMMessage, { role: "assistant" }>;
  const content: unknown[] = asst.content ? [{ type: "text", text: asst.content }] : [];
  for (const call of asst.tool_calls ?? []) {
    content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
  }
  return { role: "assistant", content };
}
