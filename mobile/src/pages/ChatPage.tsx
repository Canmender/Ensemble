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
  Modal,
  TextInput,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api, type Conversation, type UserInfo } from "../services/api";
import { useDeviceStore } from "../store/deviceStore";
import { useChatTarget } from "../store/chatTargetStore";
import { useUnreadStore } from "../store/unreadStore";
import { wsLink } from "../services/wslink";
import { EmptyState } from "../components/ui";
import { colors, spacing, radius, fontSize } from "../theme";
import type { AgentConfig } from "@ensemble/shared-protocol";
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
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
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
    if (res.data) {
      setConversations(res.data);
      useUnreadStore
        .getState()
        .setTotalUnread(res.data.reduce((sum, c) => sum + (c.unread || 0), 0));
    }
    setLoading(false);
    if (res.error) setError(res.error);
  }, []);

  useEffect(() => {
    void loadConversations();
    void api.getUsers().then((r) => {
      if (r.data) setUsers(r.data);
    });
    void api.getAgents().then((r) => {
      if (r.data) setAgents(r.data.filter((a) => a.enabled));
    });
  }, [loadConversations]);

  // WS 收到新消息 → 本地立即更新对应会话最后消息预览（无延迟），节流整表刷新兜底（未读等）
  useFocusEffect(
    useCallback(() => {
      wsLink.on({
        onChatMessage: (msg) => {
          const preview =
            msg.content ||
            (msg.attachment
              ? msg.attachment.type === "image"
                ? "[图片]"
                : `[文件] ${msg.attachment.name}`
              : "");
          if (preview) {
            setConversations((prev) =>
              prev.map((c) =>
                c.runId === msg.runId
                  ? {
                      ...c,
                      lastMessage: preview.slice(0, 50),
                      lastMessageTs: new Date().toISOString(),
                    }
                  : c,
              ),
            );
          }
          if (Date.now() - lastReload.current > 3000) {
            lastReload.current = Date.now();
            void loadConversations();
          }
        },
      });
    }, [loadConversations]),
  );

  // 消费联系人页选中的目标：已有 direct 会话则直接进入，无则懒创建
  const target = useChatTarget((s) => s.target);
  const clearTarget = useChatTarget((s) => s.setTarget);
  useEffect(() => {
    if (!target) return;
    clearTarget(null);
    void (async () => {
      try {
        // 查已有会话：与目标用户/agent 的 direct 会话（列表未加载完时拉一次兜底）
        const list = conversations.length > 0 ? conversations : (await api.getConversations()).data ?? [];
        const existing = list.find(
          (c) => c.type === "direct" && (c.participantIds ?? []).includes(target.id),
        );
        if (existing) {
          navigation.navigate("ChatRoom", {
            convId: existing.id,
            runId: existing.runId,
            title: convTitle(existing, usersById),
          });
          return;
        }
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
  }, [target, clearTarget, loadConversations, navigation, conversations, usersById]);

  // 创建群聊：成员多选（用户 + Agent，支持三类群：纯用户 / 纯 Agent / 混合）
  const toggleMember = (id: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createGroup = async () => {
    const ids = Array.from(selectedMembers);
    const name = groupName.trim();
    if (!name || ids.length < 2) return;
    try {
      const res = await api.createConversation({ type: "group", title: name, participantIds: ids });
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.data) {
        navigation.navigate("ChatRoom", { convId: res.data.id, runId: res.data.runId, title: name });
        void loadConversations();
      }
      setShowCreateGroup(false);
      setShowNewChat(false);
      setGroupName("");
      setSelectedMembers(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建群聊失败");
    }
  };

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
        <Text style={styles.convLast} numberOfLines={1}>
          {item.lastMessage || "开始聊天吧"}
        </Text>
        {item.unread > 0 && <Text style={styles.convUnread}>未读 {item.unread} 条</Text>}
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
          onPress={() => setShowNewChat(true)}
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
          extraData={usersById}
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

      {/* 新对话选择：单聊 / 群聊 */}
      <Modal transparent visible={showNewChat} animationType="fade" onRequestClose={() => setShowNewChat(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowNewChat(false)}>
          <View style={styles.actionSheet}>
            <TouchableOpacity
              style={styles.actionItem}
              onPress={() => {
                setShowNewChat(false);
                (navigation as any).navigate("Contacts");
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="person-add-outline" size={20} color={colors.primary} />
              <Text style={styles.actionText}>发起单聊</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionItem}
              onPress={() => setShowCreateGroup(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="chatbubbles-outline" size={20} color={colors.primary} />
              <Text style={styles.actionText}>创建群聊</Text>
            </TouchableOpacity>
            <View style={styles.actionDivider} />
            <TouchableOpacity style={styles.actionItem} onPress={() => setShowNewChat(false)} activeOpacity={0.7}>
              <Text style={[styles.actionText, styles.actionCancel]}>取消</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 创建群聊：用户 + Agent 可混合（三类群） */}
      <Modal transparent visible={showCreateGroup} animationType="slide" onRequestClose={() => setShowCreateGroup(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>创建群聊</Text>
              <TouchableOpacity onPress={() => setShowCreateGroup(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>群名称</Text>
            <TextInput
              style={styles.input}
              value={groupName}
              onChangeText={setGroupName}
              placeholder="输入群名称"
              placeholderTextColor={colors.textFaint}
              maxLength={20}
            />
            <Text style={styles.fieldLabel}>选择成员（{selectedMembers.size}）——用户 / Agent 可混合</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              {users.map((u) => (
                <TouchableOpacity key={u.id} style={styles.memberRow} onPress={() => toggleMember(u.id)} activeOpacity={0.7}>
                  <View style={[styles.memberAvatar, { backgroundColor: colors.primarySoft }]}>
                    <Text style={[styles.memberAvatarText, { color: colors.primary }]}>
                      {(u.displayName || u.username)[0]?.toUpperCase() || "?"}
                    </Text>
                  </View>
                  <Text style={styles.memberName}>{u.displayName || u.username}</Text>
                  <Ionicons
                    name={selectedMembers.has(u.id) ? "checkmark-circle" : "ellipse-outline"}
                    size={22}
                    color={selectedMembers.has(u.id) ? colors.primary : colors.textFaint}
                  />
                </TouchableOpacity>
              ))}
              {agents.map((a) => (
                <TouchableOpacity key={a.id} style={styles.memberRow} onPress={() => toggleMember(a.id)} activeOpacity={0.7}>
                  <View style={[styles.memberAvatar, { backgroundColor: colors.accent + "1A" }]}>
                    <Ionicons name={a.kind === "builtin" ? "flash" : "terminal"} size={18} color={colors.accent} />
                  </View>
                  <Text style={styles.memberName}>{a.name}</Text>
                  <Text style={styles.memberType}>Agent</Text>
                  <Ionicons
                    name={selectedMembers.has(a.id) ? "checkmark-circle" : "ellipse-outline"}
                    size={22}
                    color={selectedMembers.has(a.id) ? colors.primary : colors.textFaint}
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.sheetActions}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setShowCreateGroup(false)}>
                <Text style={[styles.btnText, { color: colors.textMuted }]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.btn,
                  styles.btnPrimary,
                  (!groupName.trim() || selectedMembers.size < 2) && { opacity: 0.5 },
                ]}
                onPress={() => void createGroup()}
                disabled={!groupName.trim() || selectedMembers.size < 2}
              >
                <Text style={[styles.btnText, { color: "#fff" }]}>创建</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  convUnread: { color: colors.danger, fontSize: fontSize.xs, marginTop: 3, fontWeight: "600" },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 48 + spacing.lg + spacing.md },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  actionSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingBottom: spacing.xl,
  },
  actionItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
  actionCancel: { color: colors.textMuted, textAlign: "center", flex: 1 },
  actionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: "85%",
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  sheetTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: "600" },
  fieldLabel: { color: colors.text, fontSize: fontSize.sm, fontWeight: "600", marginTop: spacing.sm, marginBottom: 6 },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.text,
    fontSize: fontSize.md,
    marginBottom: spacing.sm,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 8,
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  memberAvatarText: { fontSize: 14, fontWeight: "700" },
  memberName: { flex: 1, color: colors.text, fontSize: fontSize.sm },
  memberType: { color: colors.textFaint, fontSize: 10, marginRight: 4 },
  sheetActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  btn: { flex: 1, paddingVertical: 12, borderRadius: radius.md, alignItems: "center" },
  btnGhost: { backgroundColor: colors.surfaceAlt },
  btnPrimary: { backgroundColor: colors.primary },
  btnText: { fontSize: fontSize.md, fontWeight: "600" },
});
