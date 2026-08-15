/**
 * 加好友面板（联系人页右上角进入）
 * - 搜索用户 → 发送好友请求
 * - 好友请求列表：收到的（同意/拒绝）+ 发出的（等待中）
 * - 支持按昵称/用户名搜索、展示私隐设置不允许加好友时的提示
 */
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Modal, TextInput, TouchableOpacity, FlatList, ActivityIndicator, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api, type UserInfo } from "../services/api";
import { useMeStore } from "../store/meStore";
import { colors, spacing, radius, fontSize } from "../theme";

interface ReqItem {
  id: string;
  fromUser: string;
  toUser: string;
  direction?: "incoming" | "outgoing";
  message?: string;
  peerName?: string;
  createdAt?: string;
}

export function AddFriendSheet({
  visible,
  onClose,
  onChanged,
}: {
  visible: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const me = useMeStore((s) => s.me);
  const [tab, setTab] = useState<"add" | "requests">("add");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [requests, setRequests] = useState<ReqItem[]>([]);
  const [busyReq, setBusyReq] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setQuery("");
    setTab("add");
    void loadUsers();
    void loadRequests();
  }, [visible]);

  const loadUsers = async () => {
    setLoading(true);
    const res = await api.getUsers();
    if (res.data) setUsers(res.data);
    setLoading(false);
  };

  const loadRequests = async () => {
    const res = await api.getFriendRequests();
    if (res.data?.requests) setRequests(res.data.requests);
  };

  const q = query.trim().toLowerCase();
  const candidates = users.filter(
    (u) => u.id !== me?.id && (!q || (u.displayName || u.username).toLowerCase().includes(q)),
  );

  const incoming = requests.filter((r) => r.direction === "incoming");
  const outgoing = requests.filter((r) => r.direction !== "incoming");

  const sendRequest = async (targetId: string) => {
    setSendingId(targetId);
    const res = await api.sendFriendRequest(targetId);
    setSendingId(null);
    if (res.error) {
      Alert.alert("无法添加", res.error);
      return;
    }
    Alert.alert("已发送", "好友请求已发送，等待对方确认。");
    void loadRequests();
    onChanged?.();
  };

  const accept = async (id: string) => {
    setBusyReq(id);
    const res = await api.acceptFriendRequest(id);
    setBusyReq(null);
    if (res.error) { Alert.alert("操作失败", res.error); return; }
    Alert.alert("添加成功", "你们已成为好友，快去聊天吧！");
    void loadRequests();
    onChanged?.();
  };

  const reject = async (id: string) => {
    setBusyReq(id);
    const res = await api.rejectFriendRequest(id);
    setBusyReq(null);
    if (res.error) { Alert.alert("操作失败", res.error); return; }
    void loadRequests();
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>好友</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* tab 切换 */}
          <View style={styles.tabs}>
            <TabBtn active={tab === "add"} label="查找/加好友" onPress={() => setTab("add")} />
            <TabBtn active={tab === "requests"} label={`好友请求${incoming.length > 0 ? " · " + incoming.length : ""}`} onPress={() => setTab("requests")} />
          </View>

          {tab === "add" ? (
            <>
              <View style={styles.search}>
                <Ionicons name="search" size={16} color={colors.textFaint} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="搜索昵称 / 用户名"
                  placeholderTextColor={colors.textFaint}
                  autoCorrect={false}
                />
              </View>
              <FlatList
                data={candidates}
                keyExtractor={(u) => u.id}
                renderItem={({ item }) => (
                  <View style={styles.row}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{(item.displayName || item.username || "?")[0]?.toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{item.displayName || item.username}</Text>
                      <Text style={styles.uname}>@{item.username}</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.addBtn, sendingId === item.id && { opacity: 0.6 }]}
                      onPress={() => void sendRequest(item.id)}
                      disabled={sendingId === item.id}
                      activeOpacity={0.7}
                    >
                      {sendingId === item.id ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Ionicons name="person-add-outline" size={18} color="#fff" />
                      )}
                      <Text style={styles.addBtnText}>加好友</Text>
                    </TouchableOpacity>
                  </View>
                )}
                ListEmptyComponent={<Text style={styles.empty}>没有匹配的用户</Text>}
                keyboardShouldPersistTaps="handled"
              />
            </>
          ) : (
            <FlatList
              data={requests}
              keyExtractor={(r) => r.id}
              renderItem={({ item }) => {
                const isIncoming = item.direction === "incoming";
                return (
                  <View style={styles.row}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{(item.peerName || "?")[0]?.toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{item.peerName || "用户"}</Text>
                      <Text style={styles.uname}>
                        {isIncoming ? "发来好友请求" : "已发送，等待对方确认"}
                      </Text>
                    </View>
                    {isIncoming ? (
                      <TouchableOpacity style={styles.acceptBtn} onPress={() => void accept(item.id)} disabled={busyReq === item.id} activeOpacity={0.7}>
                        {busyReq === item.id ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.acceptText}>同意</Text>}
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity style={styles.rejectBtn} onPress={() => void reject(item.id)} disabled={busyReq === item.id} activeOpacity={0.7}>
                        {busyReq === item.id ? <ActivityIndicator size="small" color={colors.textMuted} /> : <Text style={styles.rejectText}>撤销</Text>}
                      </TouchableOpacity>
                    )}
                  </View>
                );
              }}
              ListEmptyComponent={<Text style={styles.empty}>暂无好友请求</Text>}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

function TabBtn({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.tabBtn, active && styles.tabActive]} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: "80%", paddingBottom: spacing.xl },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: "600" },
  tabs: { flexDirection: "row", gap: spacing.sm, padding: spacing.md },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: "center", backgroundColor: colors.inputBg },
  tabActive: { backgroundColor: colors.primary },
  tabText: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: "600" },
  tabTextActive: { color: "#fff" },
  search: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.inputBg, borderRadius: radius.md, paddingHorizontal: spacing.md, marginHorizontal: spacing.md, marginBottom: spacing.sm },
  searchInput: { flex: 1, paddingVertical: 8, color: colors.text, fontSize: fontSize.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.primary, fontSize: 16, fontWeight: "700" },
  name: { color: colors.text, fontSize: fontSize.md, fontWeight: "600" },
  uname: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 6, paddingHorizontal: 10 },
  addBtnText: { color: "#fff", fontSize: fontSize.xs, fontWeight: "600" },
  acceptBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 6, paddingHorizontal: 14 },
  acceptText: { color: "#fff", fontSize: fontSize.sm, fontWeight: "600" },
  rejectBtn: { borderRadius: radius.md, paddingVertical: 6, paddingHorizontal: 10 },
  rejectText: { color: colors.textMuted, fontSize: fontSize.sm },
  empty: { color: colors.textMuted, textAlign: "center", paddingVertical: spacing.xl },
});
