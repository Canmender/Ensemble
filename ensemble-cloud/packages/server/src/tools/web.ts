import type { AgentTool, ToolContext } from "./types";
import { checkNetworkAllowed } from "./security";

/** SSRF 防护：本地/内网地址判断 */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h.endsWith(".local") ||
    h.startsWith("127.") ||
    h.startsWith("10.") ||
    h.startsWith("192.168.") ||
    h.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

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
    "Search the web for current or time-sensitive information (news, prices, latest docs, facts outside your knowledge). Do NOT use for general knowledge you can answer from training data. Returns title + url + snippet for up to 8 results.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "search query" } },
    required: ["query"],
  },
  async execute(input: unknown, ctx: ToolContext): Promise<string> {
    const denied = checkNetworkAllowed(ctx.appSettings?.security);
    if (denied) return denied;
    const { query } = input as { query: string };
    const searchApi = ctx.appSettings?.searchApi;
    if (searchApi?.apiKey && searchApi.provider === "serper") {
      return searchWithSerper(query, searchApi.apiKey, ctx.signal);
    }
    if (searchApi?.apiKey && searchApi.provider === "tavily") {
      return searchWithTavily(query, searchApi.apiKey, ctx.signal);
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

/** Tavily 搜索（AI 友好摘要，返回 answer + 结果列表） */
async function searchWithTavily(query: string, apiKey: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 8,
      search_depth: "basic",
      include_answer: true,
    }),
    signal,
  });
  if (!res.ok) return `search failed: HTTP ${res.status} ${await res.text().catch(() => "")}`;
  const data = (await res.json()) as any;
  const answer = data.answer ? `[Summary] ${data.answer}` : "";
  const results = (data.results ?? [])
    .map((r: any) => `- ${r.title}\n  ${r.url}\n  ${(r.content ?? "").slice(0, 500)}`)
    .join("\n");
  return [answer, results].filter(Boolean).join("\n") || "(no results)";
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
    const denied = checkNetworkAllowed(ctx.appSettings?.security);
    if (denied) return denied;
    const { url } = input as { url: string };
    if (!/^https?:\/\//.test(url)) return "error: only http(s) URLs allowed";
    // SSRF 防护：禁止访问本地/内网地址
    try {
      if (isPrivateHost(new URL(url).hostname)) return "安全围栏：禁止访问本地/内网地址";
    } catch {
      return "error: invalid url";
    }

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
