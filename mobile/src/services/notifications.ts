/**
 * 通知服务（应用内 + 系统通知）
 * - WS 收到新消息（非当前打开会话）→ 弹系统通知 + 未读计数 +1
 * - @提及通知：被@时始终弹通知（高优先级），不受当前会话限制
 * - Android 需要通知 channel；Android 13+ 需运行时请求通知权限
 *
 * 局限：依赖 WS 连接（app 前台/后台未杀时），app 被杀后需远程推送（FCM/Expo push，当前自用场景未接）。
 */
import * as Notifications from "expo-notifications";
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
      content: { title: "新消息", body: previewOf(msg), sound: false, channelId: "messages" },
      trigger: null,
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
        channelId: "messages",
      },
      trigger: null,
    }).catch(() => {});
  });
}
