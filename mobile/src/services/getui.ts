/**
 * 个推(GeTui)推送入口（Android）
 *
 * 原生层在 Application.onCreate 已初始化个推 SDK，并在 GeTuiIntentService
 * 中接收 cid / 透传 / 通知点击 后通过 DeviceEventEmitter 发送给 JS。
 *
 * 计划：
 * - getui:clientId → 报给服务端绑定 alias（用户 id），供服务端按用户推送
 * - getui:message → 透传消息（套件），可触发上线后提示
 *
 * 注意：公司基奡用个推通知模板（NotificationTemplate）时，
 * 系统通知由 SDK 自动展示，JS 不需要手动展示。
 */
import { Platform, DeviceEventEmitter } from "react-native";

let ready = false;

/** 当前获取的 cid（个推设备标识） */
let cid: string | null = null;

/** 设置 cid（生态时存储，供用户管理页展示） */
async function persistCid(id: string): Promise<void> {
  try {
    const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
    await AsyncStorage.setItem("@ensemble/getui_cid", id);
  } catch { /* ignore */ }
}

/** 存储上一条透传消息（用于点击/上线后报给 JS 业务） */
async function storeLastMessage(payload: string): Promise<void> {
  try {
    const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
    await AsyncStorage.setItem("@ensemble/getui_last_msg", payload);
  } catch { /* ignore */ }
}

export type GetuiMessageHandler = (payload: string) => void;

/** 激活个推 JS 监听：收 cid / 透传，应在 App 启动时调用一次 */
export function initGetui(handlers?: {
  onClientId?: (cid: string) => void;
  onMessage?: GetuiMessageHandler;
  onNotificationClicked?: (payload: string) => void;
}): void {
  if (!ready || Platform.OS !== "android") {
    if (Platform.OS !== "android") return;
    ready = true;
    // 接受原生个推事件
    DeviceEventEmitter.addListener("getui:clientId", (id: string) => {
      cid = id;
      void persistCid(id);
      handlers?.onClientId?.(id);
    });
    DeviceEventEmitter.addListener("getui:message", (payload: string) => {
      void storeLastMessage(payload);
      handlers?.onMessage?.(payload);
    });
    DeviceEventEmitter.addListener("getui:notificationClicked", (payload: string) => {
      handlers?.onNotificationClicked?.(payload);
    });
  }
}

/** 获取已缓存的 cid（需要 JS 已激活且原生已回调） */
export function getCid(): string | null {
  return cid;
}