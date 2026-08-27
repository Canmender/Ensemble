/**
 * 服务端防重复提交中间件（参考 box-im @RepeatSubmit）
 * 基于 Redis-like 内存缓存，同一用户+同一内容在窗口时间内不重复处理。
 */

const sentMessages = new Map<string, number>();
const DEFAULT_CLEANUP_INTERVAL = 60_000;
const DEFAULT_WINDOW_MS = 2_000;

let lastCleanup = Date.now();

function cleanup(windowMs: number) {
  if (Date.now() - lastCleanup < DEFAULT_CLEANUP_INTERVAL) return;
  lastCleanup = Date.now();
  const cutoff = Date.now() - windowMs;
  for (const [key, ts] of sentMessages) {
    if (ts < cutoff) sentMessages.delete(key);
  }
}

/**
 * 检查消息是否重复（同一用户+同一内容+同一会话在窗口时间内）
 * @param windowMs 防重窗口（毫秒），默认 2000
 * @returns true = 重复，应拒绝
 */
export function isDuplicateMessage(userId: string, convId: string, content: string, windowMs = DEFAULT_WINDOW_MS): boolean {
  cleanup(windowMs);
  const key = `${userId}:${convId}:${content.slice(0, 100)}`;
  const now = Date.now();
  const last = sentMessages.get(key);
  if (last && now - last < windowMs) return true;
  sentMessages.set(key, now);
  return false;
}
