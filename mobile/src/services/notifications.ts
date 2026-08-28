/**
 * 通知服务（应用内 + 系统通知 + 推送 token 注册）
 * - WS 收到新消息（非当前打开会话）→ 弹系统通知 + 未读计数 +1
 * - @提及通知：被@时始终弹通知（高优先级），不受当前会话限制
 * - Android 需要通知 channel；Android 13+ 需运行时请求通知权限
 * - 推送 token 注册：app 启动时获取 expo push token 并 POST 到服务端
 */
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CLOUD_SERVER } from "./connection";
import { wsLink, type ChatWsMessage, type MentionEvent } from "./wslink";
import { useUnreadStore } from "../store/unreadStore";
import { useDeviceStore } from "../store/deviceStore";

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

/** 注册推送 token：获取 expo push token 并 POST 到服务端（需在登录后调用） */
export async function registerPushToken(): Promise<void> {
  console.warn("[push] step 1: checking permissions");
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  console.warn("[push] step 2: permission status =", finalStatus);
  if (finalStatus !== "granted") return;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }

  console.warn("[push] step 3: getting expo push token");
  const token = (
    await Notifications.getExpoPushTokenAsync({
      projectId: "51970ac4-af3c-4345-bed2-b1ac8bee96bb",
    })
  ).data;
  console.warn("[push] step 4: got token =", token);

  try {
    const baseUrl = `http://${CLOUD_SERVER.host}:${CLOUD_SERVER.port}`;
    const authToken = await AsyncStorage.getItem("@ensemble/auth_token");
    console.warn("[push] step 5: authToken =", authToken ? "exists" : "null", "baseUrl =", baseUrl);

    if (!authToken) {
      console.warn("[push] step 5b: no authToken, returning");
      return;
    }

    const { connectedDevice } = useDeviceStore.getState();
    const deviceId = connectedDevice?.id || "mobile-" + Date.now();
    console.warn("[push] step 6: calling API with deviceId =", deviceId);

    const res = await fetch(`${baseUrl}/api/devices/push-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ deviceId, token, platform: Platform.OS }),
    });
    const json = await res.json();
    console.warn("[push] step 7: API response =", JSON.stringify(json));
  } catch (e) {
    console.warn("[push] ERROR:", e);
  }
}

/** 初始化通知：推送 token 注册 + Android channel + 全局 WS 监听 + 通知点击处理 */
export function initNotifications(): void {
  if (initialized) return;
  initialized = true;
  console.warn("[push] initNotifications called");

  void Notifications.setNotificationChannelAsync("messages", {
    name: "消息",
    importance: Notifications.AndroidImportance.HIGH,
    sound: null,
  }).catch(() => {});

  // 推送 token 注册（改为在登录成功后调用，不在这里调用）

  // 通知点击处理：跳转到对应会话
  try {
    Notifications.addNotificationResponseListener((response) => {
      const convId = response.notification.request.content.data?.convId;
      if (convId) {
        const { lastActiveConvId } = useUnreadStore.getState();
        if (lastActiveConvId !== convId) {
          useUnreadStore.getState().setLastActiveConvId(convId);
        }
      }
    });
  } catch {
    /* 通知响应监听器注册失败不影响主流程 */
  }

  wsLink.onGlobalChatMessage((msg) => {
    const { lastActiveConvId, mutedRunIds, addUnread } = useUnreadStore.getState();
    // 当前正在看的会话不弹通知、不计未读
    if (msg.runId === lastActiveConvId) return;
    // 静音会话不弹通知、不计未读
    if (mutedRunIds.has(msg.runId)) return;
    addUnread();
    void Notifications.scheduleNotificationAsync({
      content: {
        title: "新消息",
        body: previewOf(msg),
        sound: false,
        data: { convId: msg.runId },
      },
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
        data: { convId: ev.convId },
      },
      trigger: { channelId: "messages" },
    }).catch(() => {});
  });
}
