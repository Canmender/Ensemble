/**
 * 通知设置（二级页）
 * 聊天消息通知开关（本地偏好）。通知依赖实时连接触发。
 */

import React, { useState } from "react";
import { View, Text, StyleSheet, Switch } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, fontSize } from "../theme";

export default function NotificationSettingsPage() {
  const [chatNotify, setChatNotify] = useState(true);
  const [sound, setSound] = useState(false);

  const items = [
    {
      icon: "chatbubble-ellipses-outline" as const,
      title: "聊天消息通知",
      desc: "收到新消息时弹系统通知",
      value: chatNotify,
      onChange: setChatNotify,
    },
    {
      icon: "volume-high-outline" as const,
      title: "通知声音",
      desc: "消息通知是否播放声音",
      value: sound,
      onChange: setSound,
    },
  ];

  return (
    <View style={styles.container}>
      {items.map((item) => (
        <View key={item.title} style={styles.item}>
          <Ionicons name={item.icon} size={20} color={colors.primary} />
          <View style={styles.info}>
            <Text style={styles.label}>{item.title}</Text>
            <Text style={styles.desc}>{item.desc}</Text>
          </View>
          <Switch
            value={item.value}
            onValueChange={item.onChange}
            trackColor={{ false: "#d1d5db", true: colors.primary }}
            thumbColor="#fff"
          />
        </View>
      ))}
      <Text style={styles.hint}>
        通知在 app 前台 / 后台（未被杀）时通过实时连接触发。杀掉 app 后需远程推送（FCM / Expo
        push），当前自用场景暂未接入。
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  info: { flex: 1 },
  label: { color: colors.text, fontSize: fontSize.md, fontWeight: "500" },
  desc: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
  hint: {
    color: colors.textFaint,
    fontSize: fontSize.xs,
    lineHeight: 18,
    marginTop: spacing.md,
    paddingHorizontal: spacing.xs,
  },
});
