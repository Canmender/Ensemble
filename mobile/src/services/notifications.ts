/**
 * 通知服务（应用内 + 系统通知 + ntfy 推送）
 * - WS 收到新消息（非当前打开会话）→ 弹系统通知 + 未读计数 + 1
 * - @提及通知：被@时始终弹通知（高优先级），不受当前会话限制
 * - Android 需要通知 channel；Android 13+ 需运行时请求通知权限
 * - ntfy 推送：App 被杀后由 ntfy App 接收通知
 *
 * 局限：依赖 WS 连接（app 前台/后台未杀时），app 被杀后需远程推送（ntfy）。
 */
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { wsLink, type ChatWsMessage, type MentionEvent } from "./wslink";
import { useUnreadStore } from "../store/unreadStore";

// 前台也展示横幅/列表（iOS 默认前台不弹，需显式设置）
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

let initialized = false;
let ntfySubscriptionActive = false;

// ntfy 服务器配置
const NTFY_SERVER = "47.98.126.83";
const NTFY_PORT = 80;

/** 消息预览（附件显示占位） */
function previewOf(msg: ChatWsMessage): string {
  if (msg.content) return msg.content.slice(0, 60);
  if (msg.attachment) {
    return msg.attachment.type === "image" ? "[图片]" : `[文件] ${msg.attachment.name}`;
  }
  return "新消息";
}

/** 初始化通知：Android channel + 全局 WS 监听（弹通知/未读红点），需在 App 启动时调用一次 */
export function initNotifications(): void {
  if (initialized) return;
  initialized = true;

  void Notifications.setNotificationChannelAsync("messages", {
    name: "消息",
    importance: Notifications.AndroidImportance.HIGH,
    sound: null,
  }).catch(() => {});

  // Android 13+ 运行时通知权限：先查状态再请求（已拒绝时系统不再弹窗，需手动开启）
  void (async () => {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== "granted") {
        await Notifications.requestPermissionsAsync();
      }
    } catch {
      /* 权限请求失败不影响 WS 连接 */
    }
  })();

  wsLink.onGlobalChatMessage((msg) => {
    const { lastActiveConvId, mutedRunIds, addUnread } = useUnreadStore.getState();
    // 当前正在看的会话不弹通知、不计未读
    if (msg.runId === lastActiveConvId) return;
    // 静音会话不弹通知、不计未读
    if (mutedRunIds.has(msg.runId)) return;
    addUnread();
    void Notifications.scheduleNotificationAsync({
      content: { title: "新消息", body: previewOf(msg), sound: false },
      // 显式指定 HIGH 重要度 channel（messages），保证 heads-up 横幅弹出
      trigger: { channelId: "messages" },
    }).catch(() => {});
  });

  // @提及通知：被@时弹通知（高优先级），但静音会话仍不弹
  wsLink.onGlobalMention((ev) => {
    const { mutedRunIds, addUnread } = useUnreadStore.getState();
    // 静音会话：即使被@也不弹通知
    if (mutedRunIds.has(ev.convId)) return;
    addUnread();
    void Notifications.scheduleNotificationAsync({
      content: {
        title: `${ev.senderName} 提到了你`,
        body: ev.content || "提到了你",
        sound: true,
      },
      trigger: { channelId: "messages" },
    }).catch(() => {});
  });

  // 启动 ntfy topic 订阅（App 在前台时接收推送）
  void initNtfySubscription();
}

/** 初始化 ntfy topic 订阅（可选，用于 App 内通知） */
async function initNtfySubscription(): Promise<void> {
  if (ntfySubscriptionActive) return;

  try {
    const userId = await AsyncStorage.getItem("@ensemble/user_id");
    if (!userId) {
      console.log("[ntfy] 未找到 userId，跳过订阅");
      return;
    }

    const topic = `ensemble-${userId}`;
    console.log("[ntfy] 启动 topic 订阅:", topic);

    // 订阅 ntfy topic（长轮询）
    await subscribeNtfy(topic);
  } catch (err) {
    console.error("[ntfy] 订阅初始化失败:", err);
  }
}

/** 订阅 ntfy topic（长轮询） */
async function subscribeNtfy(topic: string): Promise<void> {
  try {
    const url = `http://${NTFY_SERVER}:${NTFY_PORT}/${topic}/json?poll=1`;
    console.log("[ntfy] 连接到:", url);

    const response = await fetch(url, {
      headers: { Accept: "text/event-stream" },
    });

    if (!response.ok) {
      console.error("[ntfy] 订阅失败:", response.status);
      return;
    }

    ntfySubscriptionActive = true;
    console.log("[ntfy] 订阅成功，等待推送...");

    // 读取响应流（长轮询会在收到消息后返回）
    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      console.log("[ntfy] 收到推送:", text);

      // 解析 ntfy 消息格式
      try {
        const lines = text.split("\n");
        let eventData = "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            eventData = line.slice(6);
          }
        }

        if (eventData) {
          const notification = JSON.parse(eventData);
          console.log("[ntfy] 解析通知:", notification);

          // 弹出本地通知
          void Notifications.scheduleNotificationAsync({
            content: {
              title: notification.title || "新消息",
              body: notification.message || "您有新消息",
              sound: true,
            },
            trigger: { channelId: "messages" },
          }).catch(() => {});
        }
      } catch (parseErr) {
        console.error("[ntfy] 解析消息失败:", parseErr);
      }
    }

    // 长轮询结束后重新订阅
    ntfySubscriptionActive = false;
    void subscribeNtfy(topic);
  } catch (err) {
    console.error("[ntfy] 订阅异常:", err);
    ntfySubscriptionActive = false;

    // 5 秒后重试
    setTimeout(() => {
      void subscribeNtfy(topic);
    }, 5000);
  }
}
