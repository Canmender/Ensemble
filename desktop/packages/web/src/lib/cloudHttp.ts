/**
 * 跨源云端请求的统一出口：桌面端走主进程 cloudFetch IPC 代理（绕开 renderer
 * CSP/webRequest 对跨源 fetch 的拦截——Electron 43 下 CSP 白名单无法可靠放行，
 * 探针实测定位）；浏览器版无桥自动回退直连（依赖服务端 CORS）。
 */
export async function cloudFetchOrDirect(url: string, init: RequestInit = {}): Promise<Response> {
  const proxy = (window as any).desktop?.cloudFetch as
    | ((p: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; body: string }>)
    | undefined;
  // 同源/相对路径不走代理
  if (!proxy || url.startsWith("/") || url.startsWith(window.location.origin)) {
    return fetch(url, init);
  }
  const headers: Record<string, string> = {};
  if (init.headers) Object.entries(init.headers as Record<string, string>).forEach(([k, v]) => (headers[k] = v));
  const r = await proxy({ url, method: init.method ?? "GET", headers, body: (init.body as string) ?? undefined });
  return new Response(r.body, { status: r.status || 502 });
}
