// 轻量 API 客户端：统一 { data } / { error } 解析
// 所有请求携带 Authorization: Bearer <sessionToken>（见 token.ts）。
//
// 跨源云端请求统一走 cloudHttp（桌面端经主进程代理，浏览器版直连）。

import { getSessionToken, resetSessionToken, clearSessionToken, hasUserToken } from "./token";
import { getCloudBase } from "./apiBase";
import { cloudFetchOrDirect } from "./cloudHttp";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const token = await getSessionToken();
    const base = await getCloudBase();
    return cloudFetchOrDirect(`${base}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let res = await doFetch();
  if (res.status === 401) {
    // 用户 token 过期（服务器重启/会话失效）→ 清除并回登录页
    const hadUserToken = hasUserToken();
    clearSessionToken();
    resetSessionToken();
    if (hadUserToken && window.location.pathname !== "/login") {
      window.location.href = "/login";
      throw new Error("登录已失效，请重新登录");
    }
    // 本地桌面模式：服务重启后设备 token 变更，重试一次
    res = await doFetch();
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
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};
