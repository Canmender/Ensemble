/**
 * Session token 获取与缓存。
 *
 * 桌面版本地服务启动时生成随机 session token（REST Bearer + WS query 共用）。
 * 多用户服务器模式下，用户登录后获得用户 session token，存 localStorage。
 * 获取优先级：localStorage 用户 token → /api/ws-token bootstrap（本地模式）。
 */

const STORAGE_KEY = "ensemble.auth.token";

import { isMultiMode } from "./apiBase";

let cached: Promise<string | null> | null = null;

/** 保存用户登录 token（登录/注册成功后调用） */
export function setSessionToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    /* 存储不可用（隐私模式）时仅内存 */
  }
  cached = Promise.resolve(token);
}

/** 清除用户 token（登出 / 401） */
export function clearSessionToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  cached = null;
}

/** 兼容别名：清除 token 缓存（设备 token 在服务重启后需重新获取） */
export function resetSessionToken(): void {
  clearSessionToken();
}

/** 是否存在持久化的用户 token（区分"已登录用户"与"本地桌面模式"） */
export function hasUserToken(): boolean {
  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

/** 获取当前 token（用户 token 优先，缺省回退本地 ws-token bootstrap） */
export function getSessionToken(): Promise<string | null> {
  try {
    const local = localStorage.getItem(STORAGE_KEY);
    if (local) return Promise.resolve(local);
  } catch {
    /* ignore */
  }

  // 多端协作模式：不使用本机 ws-token（云端请求需用户 token）
  if (isMultiMode()) return Promise.resolve(null);

  if (!cached) {
    cached = (async () => {
      try {
        const res = await fetch("/api/ws-token");
        if (!res.ok) return null;
        const json = (await res.json()) as { token?: unknown } | null;
        const token = json?.token;
        return typeof token === "string" ? token : null;
      } catch {
        return null;
      }
    })().then((token) => {
      // 失败（null）不缓存：避免一次性网络失败导致后续请求永久 401
      if (token === null) cached = null;
      return token;
    });
  }
  return cached;
}
