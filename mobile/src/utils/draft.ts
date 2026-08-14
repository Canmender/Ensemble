/**
 * 会话草稿管理：自动保存/恢复输入框内容
 * 使用 AsyncStorage 持久化，按 convId 存取。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const DRAFT_KEY_PREFIX = "draft_";

/** 保存草稿（输入框变化时调用） */
export async function saveDraft(convId: string, text: string): Promise<void> {
  try {
    if (text.trim()) {
      await AsyncStorage.setItem(`${DRAFT_KEY_PREFIX}${convId}`, text);
    } else {
      await AsyncStorage.removeItem(`${DRAFT_KEY_PREFIX}${convId}`);
    }
  } catch {}
}

/** 读取草稿 */
export async function loadDraft(convId: string): Promise<string> {
  try {
    return (await AsyncStorage.getItem(`${DRAFT_KEY_PREFIX}${convId}`)) || "";
  } catch {
    return "";
  }
}

/** 清除草稿（发送成功后调用） */
export async function clearDraft(convId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(`${DRAFT_KEY_PREFIX}${convId}`);
  } catch {}
}

/** 批量读取多个会话的草稿（会话列表显示「草稿」标记用） */
export async function loadDrafts(convIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  try {
    const keys = convIds.map((id) => `${DRAFT_KEY_PREFIX}${id}`);
    const pairs = await AsyncStorage.multiGet(keys);
    for (const [key, value] of pairs) {
      if (value) {
        const convId = key.replace(DRAFT_KEY_PREFIX, "");
        result.set(convId, value);
      }
    }
  } catch {}
  return result;
}
