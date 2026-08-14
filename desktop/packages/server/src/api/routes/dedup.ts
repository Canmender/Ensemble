/**
 * 服务端防重复提交中间件（参考 box-im @RepeatSubmit）
 * 基于 Redis-like 内存缓存，同一用户+同一内容在窗口时间内不重复处理。
 */

const sentMessages = new Map<string, number>();
const CLEANUP_INTERVAL = 60_000; // 60 秒清理一次
const WINDOW_MS = 2_000; // 2 秒防重窗口

let lastCleanup = Date.now();

function cleanup() {
  if (Date.now() - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = Date.now();
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, ts] of sentMessages) {
    if (ts < cutoff) sentMessages.delete(key);
  }
}

/**
 * 检查消息是否重复（同一用户+同一内容+同一会话在 2 秒内）
 * @returns true = 重复，应拒绝
 */
export function isDuplicateMessage(userId: string, convId: string, content: string): boolean {
  cleanup();
  const key = `${userId}:${convId}:${content.slice(0, 100)}`;
  const now = Date.now();
  const last = sentMessages.get(key);
  if (last && now - last < WINDOW_MS) return true;
  sentMessages.set(key, now);
  return false;
}
