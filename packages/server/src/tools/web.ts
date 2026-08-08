import type { AgentTool, ToolContext } from "./types";

const MAX_FETCH_BYTES = 512 * 1024;

/** 网页转文本（粗略 strip 标签） */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export const webSearchTool: AgentTool = {
  name: "web_search",
  description:
    "Search the web for a query. Returns a list of results (title + url + snippet).",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "search query" } },
    required: ["query"],
  },
  async execute(input: unknown, ctx: ToolContext): Promise<string> {
    const { query } = input as { query: string };
    const apiKey = ctx.appSettings?.searchApi?.apiKey;
    if (apiKey && ctx.appSettings?.searchApi?.provider === "serper") {
      return searchWithSerper(query, apiKey, ctx.signal);
    }
    return searchDuckDuckGo(query, ctx.signal);
  },
};

async function searchDuckDuckGo(query: string, signal?: AbortSignal): Promise<string> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
  const res = await fetch(url, { signal });
  if (!res.ok) return `search failed: HTTP ${res.status}`;
  const data = (await res.json()) as any;
  const results = (data.RelatedTopics ?? [])
    .filter((r: any) => r.Text)
    .slice(0, 8)
    .map((r: any) => `- ${r.Text}${r.FirstURL ? `\n  ${r.FirstURL}` : ""}`)
    .join("\n");
  const abstract = data.AbstractText ? `${data.AbstractText}\n${data.AbstractURL ?? ""}` : "";
  return [abstract, results].filter(Boolean).join("\n") || "(no results)";
}

async function searchWithSerper(query: string, apiKey: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ q: query, num: 8 }),
    signal,
  });
  if (!res.ok) return `search failed: HTTP ${res.status}`;
  const data = (await res.json()) as any;
  return (data.organic ?? [])
    .map((r: any) => `- ${r.title}\n  ${r.link}\n  ${r.snippet ?? ""}`)
    .join("\n");
}

export const webFetchTool: AgentTool = {
  name: "web_fetch",
  description:
    "Fetch a URL and return its text content (limited to ~500KB, 15s timeout).",
  parameters: {
    type: "object",
    properties: { url: { type: "string", description: "http(s) URL to fetch" } },
    required: ["url"],
  },
  async execute(input: unknown, ctx: ToolContext): Promise<string> {
    const { url } = input as { url: string };
    if (!/^https?:\/\//.test(url)) return "error: only http(s) URLs allowed";

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    const timer = setTimeout(onAbort, 15_000);
    ctx.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return `fetch failed: HTTP ${res.status}`;
      // 流式读取并限制大小（防超大页面占满内存）
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > MAX_FETCH_BYTES) {
            chunks.push(value.slice(0, MAX_FETCH_BYTES - (total - value.length)));
            break;
          }
          chunks.push(value);
        }
      }
      const text = htmlToText(Buffer.concat(chunks).toString("utf8"));
      return text.slice(0, MAX_FETCH_BYTES) || "(empty page)";
    } catch (err) {
      return `fetch error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", onAbort);
    }
  },
};

export const webTools: AgentTool[] = [webSearchTool, webFetchTool];
