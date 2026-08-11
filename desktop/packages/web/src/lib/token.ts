/**
 * Session token 获取与缓存。
 *
 * 桌面版本地服务每次启动生成随机 session token：
 * - REST API 通过 `Authorization: Bearer <token>` 认证
 * - WebSocket 通过 `?token=<token>` query 认证
 * 本模块统一从 /api/ws-token 获取并缓存，供 api.ts / ws.ts 共用。
 */

let cached: Promise<string | null> | null = null;

/** 获取当前 session token（首次调用后缓存；失败返回 null 且不缓存，允许下次重试） */
export function getSessionToken(): Promise<string | null> {
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

/** 清除缓存的 token（服务重启后 token 变更，强制重新获取） */
export function resetSessionToken(): void {
  cached = null;
}
