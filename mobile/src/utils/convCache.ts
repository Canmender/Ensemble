/**
 * 会话列表本地缓存：AsyncStorage 持久化，打开聊天页秒加载。
 * 服务端数据仍会拉取并覆盖本地缓存，缓存仅用于首屏加载加速。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_KEY = "conversations_cache";
const CACHE_TS_KEY = "conversations_cache_ts";
const CACHE_TTL = 60 * 1000; // 60 秒内认为缓存有效

/** 保存会话列表缓存 */
export async function cacheConversations(conversations: any[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(conversations));
    await AsyncStorage.setItem(CACHE_TS_KEY, String(Date.now()));
  } catch {}
}

/** 读取会话列表缓存（超过 TTL 返回 null，触发刷新） */
export async function getCachedConversations(): Promise<any[] | null> {
  try {
    const ts = await AsyncStorage.getItem(CACHE_TS_KEY);
    if (!ts || Date.now() - Number(ts) > CACHE_TTL) return null;
    const data = await AsyncStorage.getItem(CACHE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}
