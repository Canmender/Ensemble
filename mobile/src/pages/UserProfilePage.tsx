/**
 * 用户个人资料页（联系人点击进入）
 * 展示头像 / 昵称 / 用户名 / 用户 ID；下方「发信息」按钮 → 已有会话直接进入，无则新建。
 */

import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api } from "../services/api";
import { colors, spacing, radius, fontSize } from "../theme";
import type { RootStackParamList } from "../App";

type Props = NativeStackScreenProps<RootStackParamList, "UserProfile">;

export default function UserProfilePage({ route, navigation }: Props) {
  const { userId, name, username, displayName } = route.params;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = displayName || username || name;

  /** 已有会话直接进入，无则新建 */
  const handleSendMessage = async () => {
    setSending(true);
    setError(null);
    try {
      const list = (await api.getConversations()).data ?? [];
      const existing = list.find(
        (c) => c.type === "direct" && (c.participantIds ?? []).includes(userId),
      );
      if (existing) {
        navigation.navigate("ChatRoom", {
          convId: existing.id,
          runId: existing.runId,
          title,
        });
        return;
      }
      const res = await api.createConversation({ type: "direct", participantIds: [userId] });
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.data) {
        navigation.navigate("ChatRoom", {
          convId: res.data.id,
          runId: res.data.runId,
          title,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(title || "?")[0]?.toUpperCase()}</Text>
        </View>
        <Text style={styles.name}>{title}</Text>
        <Text style={styles.username}>@{username}</Text>
      </View>

      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.label}>用户 ID</Text>
          <Text style={[styles.value, styles.idValue]} numberOfLines={1}>
            {userId}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.label}>角色</Text>
          <Text style={styles.value}>用户</Text>
        </View>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.sendBtn, sending && { opacity: 0.7 }]}
          onPress={() => void handleSendMessage()}
          disabled={sending}
          activeOpacity={0.8}
        >
          {sending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="chatbubble-ellipses" size={18} color="#fff" />
              <Text style={styles.sendBtnText}>发信息</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { alignItems: "center", marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.primary, fontSize: 32, fontWeight: "700" },
  name: { color: colors.text, fontSize: fontSize.xl, fontWeight: "700", marginTop: spacing.md },
  username: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: 2 },
  infoCard: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  label: { color: colors.textMuted, fontSize: fontSize.sm },
  value: { color: colors.text, fontSize: fontSize.sm, maxWidth: "65%" },
  idValue: { fontSize: 11 },
  error: {
    color: colors.danger,
    fontSize: fontSize.xs,
    textAlign: "center",
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  footer: { flex: 1, justifyContent: "flex-end", padding: spacing.lg },
  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: 14,
  },
  sendBtnText: { color: "#fff", fontSize: fontSize.md, fontWeight: "600" },
});
