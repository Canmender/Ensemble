/**
 * 极简 SSE 解析器：从 fetch Response 的 body reader 按 \n\n 分帧，产出 { event?, data }。
 * 兼容 Anthropic / OpenAI 两种流式格式的 data 行。
 *
 * 性能优化：
 * - 缓冲区增长保护：防止畸形流导致内存溢出
 * - AbortSignal 联动：中断时立即取消 reader
 */

export interface SseFrame {
  event?: string;
  data: string;
}

const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB 缓冲区上限

export async function* parseSse(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal,
): AsyncGenerator<SseFrame> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // AbortSignal 联动：中断时立即取消 reader
  if (signal) {
    signal.addEventListener("abort", () => {
      reader.cancel().catch(() => {});
    }, { once: true });
  }

  try {
    for (;;) {
      if (signal?.aborted) throw new AbortError("stream aborted");
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 缓冲区增长保护
      if (buffer.length > MAX_BUFFER_SIZE) {
        // 尝试找到最后一个完整的帧边界
        const lastFrameEnd = buffer.lastIndexOf("\n\n");
        if (lastFrameEnd > 0) {
          // 保留最后一个不完整帧，丢弃之前的
          buffer = buffer.slice(lastFrameEnd + 2);
        } else {
          // 没有完整帧，清空缓冲区（畸形流）
          buffer = "";
        }
      }

      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const frame = parseFrame(chunk);
        if (frame) yield frame;
      }
    }
    // 尾部残留
    const frame = parseFrame(buffer);
    if (frame) yield frame;
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
}

function parseFrame(chunk: string): SseFrame | null {
  const lines = chunk.split("\n");
  let event: string | undefined;
  let data = "";
  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      // 支持多 data 行拼接（OpenAI 也只在单行）
      data += (data ? "\n" : "") + line.slice(5).trimStart();
    }
  }
  if (!data) return null;
  return { event, data };
}

export class AbortError extends Error {
  constructor(message = "aborted") {
    super(message);
    this.name = "AbortError";
  }
}

/** 把 HTTP 非 2xx 响应转成带 code 的错误 */
export async function throwOnHttpError(res: Response, context: string): Promise<void> {
  if (res.ok) return;
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 500);
  } catch {
    /* ignore */
  }
  const err = new Error(`[${context}] HTTP ${res.status}: ${detail}`) as Error & { code?: string };
  err.code = `http_${res.status}`;
  throw err;
}
