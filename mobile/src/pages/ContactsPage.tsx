/**
 * 联系人页（通讯录）
 * 参考主流 IM（微信/Telegram）设计：顶部搜索 + 分组列表 + 点击开聊。
 * - 用户（好友）：云端注册用户，点击进入用户-用户会话
 * - Agent：启用的智能体，点击进入与 Agent 的会话
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTaskStore } from "../store/taskStore";
import { api, type UserInfo } from "../services/api";
import { useChatTarget } from "../store/chatTargetStore";
import { colors, spacing, radius, fontSize } from "../theme";
import type { AgentConfig } from "@ensemble/shared-protocol";

type ContactRow =
  | { type: "contact"; key: string; kind: "user"; id: string; name: string; subtitle: string; user: UserInfo }
  | { type: "contact"; key: string; kind: "agent"; id: string; name: string; subtitle: string; agent: AgentConfig };

export default function ContactsPage({ navigation }: { navigation: any }) {
  const { agents } = useTaskStore();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const setTarget = useChatTarget((s) => s.setTarget);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getUsers();
      if (res.data) setUsers(res.data);
    } catch {
      /* 未登录/离线时忽略 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 搜索过滤
  const q = query.trim().toLowerCase();
  const userRows: ContactRow[] = users
    .filter((u) => {
      if (!q) return true;
      return (u.displayName || u.username).toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
    })
    .map((u) => ({
      type: "contact" as const,
      key: `user-${u.id}`,
      kind: "user" as const,
      id: u.id,
      name: u.displayName || u.username,
      subtitle: "用户",
      user: u,
    }));
  const agentRows: ContactRow[] = agents
    .filter((a) => a.enabled)
    .filter((a) => {
      if (!q) return true;
      return a.name.toLowerCase().includes(q);
    })
    .map((a) => ({
      type: "contact" as const,
      key: `agent-${a.id}`,
      kind: "agent" as const,
      id: a.id,
      name: a.name,
      subtitle: a.model || "Agent",
      agent: a,
    }));

  const sections: Array<{ title: string; icon: keyof typeof Ionicons.glyphMap; data: ContactRow[] }> = [
    { title: "用户", icon: "people", data: userRows },
    { title: "Agent", icon: "hardware-chip", data: agentRows },
  ];
  const flatData: Array<{ type: "header"; title: string; icon: keyof typeof Ionicons.glyphMap } | ContactRow> = [];
  for (const s of sections) {
    if (s.data.length > 0) {
      flatData.push({ type: "header", title: s.title, icon: s.icon });
      flatData.push(...s.data);
    }
  }

  const openContact = (row: ContactRow) => {
    if (row.kind === "user") {
      // 用户 → 个人资料页（下方「发信息」进入聊天）
      navigation.navigate("UserProfile", {
        userId: row.id,
        name: row.name,
        username: row.user.username,
        displayName: row.user.displayName,
      });
    } else {
      // Agent → 直接开聊
      setTarget({ kind: "agent", id: row.id, name: row.name });
      navigation.navigate("Chat");
    }
  };

  const renderItem = ({ item }: { item: (typeof flatData)[number] }) => {
    if (item.type === "header") {
      return (
        <View style={styles.sectionHeader}>
          <Ionicons name={item.icon} size={13} color={colors.textMuted} />
          <Text style={styles.sectionTitle}>{item.title}</Text>
        </View>
      );
    }
    const row = item as ContactRow;
    const isUser = row.kind === "user";
    return (
      <TouchableOpacity style={styles.row} onPress={() => openContact(row)} activeOpacity={0.7}>
        <View style={[styles.avatar, { backgroundColor: isUser ? colors.primarySoft : colors.accent + "1A" }]}>
          {isUser ? (
            <Text style={[styles.avatarText, { color: colors.primary }]}>
              {row.user.displayName?.[0] || row.user.username[0]?.toUpperCase() || "?"}
            </Text>
          ) : (
            <Ionicons name={row.agent.kind === "builtin" ? "flash" : "terminal"} size={20} color={colors.accent} />
          )}
        </View>
        <View style={styles.rowInfo}>
          <Text style={styles.rowName}>{row.name}</Text>
          <Text style={styles.rowSubtitle}>{row.subtitle}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
      </TouchableOpacity>
    );
  };

  const total = userRows.length + agentRows.length;

  return (
    <View style={styles.container}>
      {/* 搜索框 */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={colors.textFaint} />
        <TextInput
          style={styles.searchInput}
          placeholder="搜索用户或 Agent"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
        {query !== "" && (
          <TouchableOpacity onPress={() => setQuery("")} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.textFaint} />
          </TouchableOpacity>
        )}
      </View>

      {loading && users.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : total === 0 ? (
        <View style={styles.center}>
          <Ionicons name="people-outline" size={40} color={colors.textFaint} />
          <Text style={styles.emptyText}>暂无联系人{agents.length === 0 ? "（登录后可见团队用户，启动时自动连接云端）" : ""}</Text>
        </View>
      ) : (
        <FlatList
          data={flatData}
          keyExtractor={(item) => (item.type === "header" ? `h-${item.title}` : item.key)}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    height: 38,
    gap: 8,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: fontSize.sm },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 6,
  },
  sectionTitle: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    gap: spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 17, fontWeight: "700" },
  rowInfo: { flex: 1 },
  rowName: { color: colors.text, fontSize: fontSize.md, fontWeight: "500" },
  rowSubtitle: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingBottom: 60 },
  emptyText: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: "center", paddingHorizontal: 40 },
});
