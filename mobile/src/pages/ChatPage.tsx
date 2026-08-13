/**
 * 聊天列表页（微信式会话卡片）
 * 每个聊天一条卡片（头像/名称/最后消息/时间/未读角标），点击卡片进入 ChatRoom。
 * 新建对话通过联系人页发起（chatTarget 联动）。
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api, type Conversation, type UserInfo } from "../services/api";
import { useDeviceStore } from "../store/deviceStore";
import { useChatTarget } from "../store/chatTargetStore";
import { wsLink } from "../services/wslink";
import { Badge, EmptyState } from "../components/ui";
import { colors, spacing, radius, fontSize } from "../theme";
import type { RootStackParamList } from "../App";

function convTitle(c: Conversation, usersById: Map<string, UserInfo>): string {
  // 用户-用户会话（runId 以 conv_ 开头）：title 存的是对方 user id，改用参与者昵称
  if (c.runId.startsWith("conv_")) {
    const names = (c.participantIds ?? []).map((pid) => {
      const u = usersById.get(pid);
      return u ? u.displayName || u.username || pid : pid;
    });
    return names.join(", ") || "会话";
  }
  return c.title || (c.participantIds ?? []).join(", ") || "会话";
}

function convIcon(c: Conversation): React.ComponentProps<typeof Ionicons>["name"] {
  if (c.runId.startsWith("conv_")) return "person";
  if (c.type === "group") return "people";
  return "flash";
}

/** 最后消息时间：当天显示 HH:MM，否则 MM/DD */
function timeStr(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function ChatPage() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { connectionState } = useDeviceStore();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const lastReload = useRef(0);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const isConnected = connectionState === "connected";

  const connMap: Record<string, { text: string; color: string }> = {
    connected: { text: "已连接云端", color: "#10b981" },
    connecting: { text: "连接中…", color: "#f59e0b" },
    reconnecting: { text: "重连中…", color: "#f59e0b" },
    disconnected: { text: "未连接", color: "#9ca3af" },
    error: { text: "连接错误", color: "#ef4444" },
  };
  const conn = connMap[connectionState] ?? connMap.disconnected;

  const loadConversations = useCallback(async () => {
    const res = await api.getConversations();
    if (res.data) setConversations(res.data);
    setLoading(false);
    if (res.error) setError(res.error);
  }, []);

  useEffect(() => {
    void loadConversations();
    void api.getUsers().then((r) => {
      if (r.data) setUsers(r.data);
    });
  }, [loadConversations]);

  // WS 收到新消息 → 节流刷新列表（未读 / 最后消息实时更新）
  useFocusEffect(
    useCallback(() => {
      wsLink.on({
        onChatMessage: () => {
          if (Date.now() - lastReload.current > 2000) {
            lastReload.current = Date.now();
            void loadConversations();
          }
        },
      });
    }, [loadConversations]),
  );

  // 消费联系人页选中的目标：懒创建 direct 会话后进入聊天
  const target = useChatTarget((s) => s.target);
  const clearTarget = useChatTarget((s) => s.setTarget);
  useEffect(() => {
    if (!target) return;
    clearTarget(null);
    void (async () => {
      try {
        const res = await api.createConversation({ type: "direct", participantIds: [target.id] });
        if (res.error) {
          setError(res.error);
          return;
        }
        const conv = res.data!;
        navigation.navigate("ChatRoom", { convId: conv.id, runId: conv.runId, title: convTitle(conv, usersById) });
        void loadConversations();
      } catch (err) {
        setError(err instanceof Error ? err.message : "创建会话失败");
      }
    })();
  }, [target, clearTarget, loadConversations, navigation]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  const openConv = (c: Conversation) => {
    navigation.navigate("ChatRoom", { convId: c.id, runId: c.runId, title: convTitle(c, usersById) });
  };

  const renderItem = ({ item }: { item: Conversation }) => (
    <TouchableOpacity style={styles.convCard} onPress={() => openConv(item)} activeOpacity={0.7}>
      <View style={styles.avatar}>
        <Ionicons name={convIcon(item)} size={22} color={colors.primary} />
      </View>
      <View style={styles.convBody}>
        <View style={styles.convRow}>
          <Text style={styles.convTitle} numberOfLines={1}>
            {convTitle(item, usersById)}
          </Text>
          <Text style={styles.convTime}>{timeStr(item.lastMessageTs)}</Text>
        </View>
        <View style={styles.convRow}>
          <Text style={styles.convLast} numberOfLines={1}>
            {item.lastMessage || "开始聊天吧"}
          </Text>
          {item.unread > 0 && <Badge count={item.unread} />}
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* 连接状态条 + 新对话入口 */}
      <View style={styles.connBar}>
        <View style={[styles.connDot, { backgroundColor: conn.color }]} />
        <Text style={styles.connText}>{conn.text}</Text>
        <TouchableOpacity
          style={styles.newBtn}
          onPress={() => (navigation as any).navigate("Contacts")}
          activeOpacity={0.7}
        >
          <Ionicons name="add" size={18} color={colors.primary} />
          <Text style={styles.newBtnText}>新对话</Text>
        </TouchableOpacity>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={14} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={
            <EmptyState
              icon={<Ionicons name="chatbubbles-outline" size={28} color={colors.textFaint} />}
              title="暂无会话"
              subtitle="点击右上角「新对话」，或在联系人页选择用户 / Agent 开始聊天"
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  connBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 6,
  },
  connDot: { width: 8, height: 8, borderRadius: 4 },
  connText: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: "600" },
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginLeft: "auto",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
  },
  newBtnText: { color: colors.primary, fontSize: fontSize.xs, fontWeight: "600" },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  errorText: { color: colors.danger, fontSize: fontSize.sm, flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingVertical: spacing.sm },
  convCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  convBody: { flex: 1, minWidth: 0 },
  convRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  convTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: "600", flex: 1 },
  convTime: { color: colors.textFaint, fontSize: 10 },
  convLast: { color: colors.textMuted, fontSize: fontSize.xs, flex: 1, marginTop: 2 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 48 + spacing.lg + spacing.md },
});
