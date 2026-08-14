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
  Alert,
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
import { Avatar } from "../components/Avatar";
import { timeAgo } from "../utils/timeAgo";
import { loadDrafts } from "../utils/draft";
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
  // 搜索
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<Conversation[]>([]);
  const [searching, setSearching] = useState(false);
  // 长按操作菜单
  const [menuConv, setMenuConv] = useState<Conversation | null>(null);
  // 会话草稿
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());

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
      // 同步静音会话列表到 unreadStore（通知判断用）
      useUnreadStore.getState().setMutedRunIds(
        new Set(res.data.filter((c) => c.muted).map((c) => c.runId)),
      );
      // 加载草稿
      const draftMap = await loadDrafts(res.data.map((c) => c.id));
      setDrafts(draftMap);
    }
    setLoading(false);
    if (res.error) setError(res.error);
  }, []);

  useEffect(() => {
    void loadConversations();
    void api.getUsers().then((r) => {
      if (r.data) setUsers(r.data);
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

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  const openConv = (c: Conversation) => {
    navigation.navigate("ChatRoom", { convId: c.id, runId: c.runId, title: convTitle(c, usersById) });
  };

  // 会话内消息搜索
  const doSearch = useCallback(async (q: string) => {
    setSearchText(q);
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    try {
      // 搜索所有会话的消息，返回匹配的会话列表
      const results: Conversation[] = [];
      for (const c of conversations) {
        const res = await api.searchMessages(c.id, q.trim());
        if (res.data && res.data.total > 0 && !results.find((r) => r.id === c.id)) {
          results.push(c);
        }
      }
      setSearchResults(results);
    } catch {} finally { setSearching(false); }
  }, [conversations]);

  // 静音 / 取消静音
  const toggleMute = useCallback(async (conv: Conversation) => {
    setMenuConv(null);
    const newMuted = !conv.muted;
    const res = await api.muteConversation(conv.id, newMuted);
    if (!res.error) {
      setConversations((prev) => prev.map((c) => c.id === conv.id ? { ...c, muted: newMuted } : c));
      // 刷新 mutedRunIds
      useUnreadStore.getState().setMutedRunIds(
        new Set(conversations.map((c) => c.id === conv.id ? { ...c, muted: newMuted } : c).filter((c) => c.muted).map((c) => c.runId)),
      );
    }
  }, [conversations]);

  // 置顶 / 取消置顶
  const togglePin = useCallback(async (conv: Conversation) => {
    setMenuConv(null);
    const newPinned = !conv.pinned;
    const res = await api.pinConversation(conv.id, newPinned);
    if (!res.error) {
      setConversations((prev) => {
        const updated = prev.map((c) => c.id === conv.id ? { ...c, pinned: newPinned } : c);
        // 置顶排前面
        return [...updated].sort((a, b) => (a.pinned ? 0 : 1) - (b.pinned ? 0 : 1) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      });
    }
  }, []);

  // 删除会话
  const deleteConv = useCallback((conv: Conversation) => {
    setMenuConv(null);
    Alert.alert("删除会话", `确定删除与「${convTitle(conv, usersById)}」的会话？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除", style: "destructive",
        onPress: async () => {
          const res = await api.request("DELETE", `/api/conversations/${conv.id}`);
          if (!res.error) {
            setConversations((prev) => prev.filter((c) => c.id !== conv.id));
          } else {
            setError(res.error);
          }
        },
      },
    ]);
  }, [usersById]);

  // 搜索结果或全部会话
  const displayConversations = searchText.trim() ? searchResults : conversations;

  // 获取会话头像 URL（用户-用户会话取对方头像，群聊暂无群头像）
  const convAvatarUrl = (c: Conversation): string | undefined => {
    if (c.runId.startsWith("conv_")) {
      const otherId = c.participantIds.find((pid) => pid !== useDeviceStore.getState().connectedDevice?.id);
      return otherId ? usersById.get(otherId)?.avatarUrl : undefined;
    }
    return undefined;
  };

  const renderItem = ({ item }: { item: Conversation }) => (
    <TouchableOpacity
      style={[styles.convCard, item.muted && styles.convCardMuted]}
      onPress={() => openConv(item)}
      onLongPress={() => setMenuConv(item)}
      activeOpacity={0.7}
    >
      <View style={styles.avatarWrap}>
        <Avatar name={convTitle(item, usersById)} avatarUrl={convAvatarUrl(item)} size={48} />
        {item.pinned && (
          <View style={styles.pinBadge}>
            <Ionicons name="pin" size={10} color="#fff" />
          </View>
        )}
      </View>
      <View style={styles.convBody}>
        <View style={styles.convRow}>
          <Text style={styles.convTitle} numberOfLines={1}>
            {convTitle(item, usersById)}
          </Text>
          <Text style={styles.convTime}>{timeAgo(item.lastMessageTs)}</Text>
        </View>
        <View style={styles.convLastRow}>
          {item.muted && <Ionicons name="volume-mute" size={12} color={colors.textFaint} style={{ marginRight: 4 }} />}
          {drafts.has(item.id) ? (
            <Text style={styles.draftText} numberOfLines={1}>[草稿] {drafts.get(item.id)}</Text>
          ) : (
            <Text style={styles.convLast} numberOfLines={1}>
              {item.lastMessage || "开始聊天吧"}
            </Text>
          )}
        </View>
        {item.unread > 0 && !item.muted && <Text style={styles.convUnread}>{item.unread}</Text>}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* 连接状态条 + 新对话入口 */}
      <View style={styles.connBar}>
        <View style={[styles.connDot, { backgroundColor: conn.color }]} />
        <Text style={styles.connText}>{conn.text}</Text>
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
        <>
          {/* 搜索栏 */}
          <View style={styles.searchBar}>
            <Ionicons name="search" size={16} color={colors.textFaint} />
            <TextInput
              style={styles.searchInput}
              placeholder="搜索会话…"
              placeholderTextColor={colors.textFaint}
              value={searchText}
              onChangeText={doSearch}
              returnKeyType="search"
            />
            {searchText.length > 0 && (
              <TouchableOpacity onPress={() => { setSearchText(""); setSearchResults([]); }} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.textFaint} />
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            data={displayConversations}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            extraData={usersById}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            ListEmptyComponent={
              <EmptyState
                icon={<Ionicons name={searchText ? "search-outline" : "chatbubbles-outline"} size={28} color={colors.textFaint} />}
                title={searchText ? "无搜索结果" : "暂无会话"}
                subtitle={searchText ? "试试其他关键词" : "在联系人页选择用户 / Agent 开始聊天"}
              />
            }
          />
        </>
      )}

      {/* 长按会话操作菜单：静音 / 置顶 / 删除 */}
      <Modal
        transparent
        visible={!!menuConv}
        animationType="fade"
        onRequestClose={() => setMenuConv(null)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setMenuConv(null)}
        >
          <View style={styles.actionSheet}>
            <TouchableOpacity style={styles.actionItem} onPress={() => menuConv && togglePin(menuConv)} activeOpacity={0.7}>
              <Ionicons name={menuConv?.pinned ? "pin-outline" : "pin"} size={20} color={colors.text} />
              <Text style={styles.actionText}>{menuConv?.pinned ? "取消置顶" : "置顶"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionItem} onPress={() => menuConv && toggleMute(menuConv)} activeOpacity={0.7}>
              <Ionicons name={menuConv?.muted ? "volume-high-outline" : "volume-mute-outline"} size={20} color={colors.text} />
              <Text style={styles.actionText}>{menuConv?.muted ? "取消静音" : "静音"}</Text>
            </TouchableOpacity>
            <View style={styles.actionDivider} />
            <TouchableOpacity style={styles.actionItem} onPress={() => menuConv && deleteConv(menuConv)} activeOpacity={0.7}>
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
              <Text style={[styles.actionText, { color: colors.danger }]}>删除</Text>
            </TouchableOpacity>
            <View style={styles.actionDivider} />
            <TouchableOpacity style={styles.actionItem} onPress={() => setMenuConv(null)} activeOpacity={0.7}>
              <Text style={[styles.actionText, styles.actionCancel]}>取消</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
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
  convCardMuted: { opacity: 0.65 },
  avatarWrap: {
    width: 48,
    height: 48,
    marginRight: spacing.md,
  },
  pinBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  convBody: { flex: 1, minWidth: 0 },
  convRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  convTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: "600", flex: 1 },
  convTime: { color: colors.textFaint, fontSize: 10 },
  convLastRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  convLast: { color: colors.textMuted, fontSize: fontSize.xs, flex: 1 },
  draftText: { color: colors.danger, fontSize: fontSize.xs, flex: 1, fontWeight: "500" },
  convUnread: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
    backgroundColor: colors.danger,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    textAlign: "center",
    lineHeight: 18,
    paddingHorizontal: 5,
    marginTop: 3,
    overflow: "hidden",
  },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 48 + spacing.lg + spacing.md },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: fontSize.sm },
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
