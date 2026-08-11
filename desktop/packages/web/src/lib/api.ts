// 轻量 API 客户端：统一 { data } / { error } 解析
// 所有请求携带 Authorization: Bearer <sessionToken>（见 token.ts）。

import { getSessionToken, resetSessionToken } from "./token";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getSessionToken();
  const headers: Record<string, string> = {
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    // 服务重启后 token 已变更，清除缓存让下一次请求重新获取
    resetSessionToken();
  }
  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  }
  return json.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};
