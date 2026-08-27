/**
 * Expo Push Notification 服务（P1）：
 * - 向离线用户设备发送推送通知
 * - 尽力而为：推送失败不影响消息投递（WS + 补拉兜底）
 * - 批量发送：Expo API 支持单次最多 100 条
 */
import { logger } from "../util/logger";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH_SIZE = 100;

interface PushPayload {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority?: "default" | "high";
  channelId?: string;
}

/**
 * 发送单条 Expo Push 通知
 * 失败时仅记录日志，不抛出（尽力而为语义）
 */
export async function sendExpoPush(token: string, payload: Omit<PushPayload, "to">): Promise<boolean> {
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: token,
        ...payload,
        priority: payload.priority ?? "high",
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn(`expo push failed (${res.status}): ${text.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    logger.warn(`expo push error: ${String(err)}`);
    return false;
  }
}

/**
 * 批量发送推送通知（自动分批，每批最多 100 条）
 * @param tokens 目标设备 push_token 列表
 * @param payload 通知内容（title/body/data）
 * @returns 成功发送的数量
 */
export async function sendExpoPushBatch(
  tokens: string[],
  payload: Omit<PushPayload, "to">,
): Promise<number> {
  if (tokens.length === 0) return 0;

  let sent = 0;
  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch = tokens.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((token) => sendExpoPush(token, payload)),
    );
    sent += results.filter((r) => r.status === "fulfilled" && r.value).length;
  }
  return sent;
}
