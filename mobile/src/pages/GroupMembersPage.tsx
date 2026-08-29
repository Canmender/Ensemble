/**
 * 群成员管理页
 * GET /api/conversations/:convId/members — 获取成员列表
 * PUT /api/groups/:convId/members/:userId/role — 修改角色
 * POST /api/groups/:convId/members/:userId/kick — 踢人
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRoute, useNavigation } from "@react-navigation/native";
import { api } from "../services/api";
import { useMeStore } from "../store/meStore";
import { colors, spacing, radius, fontSize, elevation } from "../theme";
import { LiquidGlass } from "../components/Glass";
import { Avatar } from "../components/Avatar";

interface MemberInfo {
  userId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  role: string;
  joinedAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  owner: "群主",
  admin: "管理员",
  moderator: "协管",
  member: "成员",
  guest: "访客",
};

const ROLE_COLORS: Record<string, string> = {
  owner: "rgba(245,158,11,0.15)",
  admin: "rgba(99,102,241,0.15)",
  moderator: "rgba(34,197,94,0.15)",
  member: "rgba(156,163,175,0.15)",
  guest: "rgba(156,163,175,0.15)",
};

export default function GroupMembersPage() {
  const route = useRoute<any>();
  const navigation = useNavigation();
  const convId = route.params?.convId;
  const me = useMeStore((s) => s.me);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteQuery, setInviteQuery] = useState("");
  const [inviteResults, setInviteResults] = useState<Array<{ id: string; username: string; displayName?: string }>>([]);

  const myRole = me?.role || "member";
  const isOwnerOrAdmin = myRole === "owner" || myRole === "admin";

  const loadMembers = useCallback(async () => {
    if (!convId) return;
    try {
      const data = await api.get<MemberInfo[]>(`/conversations/${convId}/members`);
      setMembers(data);
    } catch (e) {
      console.error("加载成员失败:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [convId]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadMembers();
  }, [loadMembers]);

  const searchInvite = async (q: string) => {
    setInviteQuery(q);
    if (!q.trim()) {
      setInviteResults([]);
      return;
    }
    try {
      const data = await api.get(`/users/search?q=${encodeURIComponent(q)}&limit=20`);
      setInviteResults(data);
    } catch (e) {
      console.error("搜索用户失败:", e);
    }
  };

  const setRole = async (userId: string, role: string) => {
    try {
      await api.put(`/groups/${convId}/members/${userId}/role`, { role });
      setMembers((ms) => ms.map((m) => (m.userId === userId ? { ...m, role } : m)));
      Alert.alert("成功", "已更新角色");
    } catch (e) {
      Alert.alert("错误", (e as Error).message || "更新失败");
    }
  };

  const kick = async (userId: string, username: string) => {
    Alert.alert("确认踢出", `确定踢出成员 "${username}"？`, [
      { text: "取消", style: "cancel" },
      {
        text: "踢出",
        style: "destructive",
        onPress: async () => {
          try {
            await api.post(`/groups/${convId}/members/${userId}/kick`);
            setMembers((ms) => ms.filter((m) => m.userId !== userId));
            Alert.alert("成功", "已踢出");
          } catch (e) {
            Alert.alert("错误", (e as Error).message || "踢出失败");
          }
        },
      },
    ]);
  };

  const invite = async (userId: string) => {
    try {
      await api.post(`/groups/${convId}/members/${userId}/role`, { role: "3" });
      Alert.alert("成功", "已邀请");
      setShowInvite(false);
      setInviteQuery("");
      setInviteResults([]);
    } catch (e) {
      Alert.alert("错误", (e as Error).message || "邀请失败");
    }
  };

  const sorted = [...members].sort((a, b) => {
    const roleOrder: Record<string, number> = { owner: 0, admin: 1, moderator: 2, member: 3, guest: 4 };
    return (roleOrder[a.role] ?? 5) - (roleOrder[b.role] ?? 5);
  });

  const renderMember = (member: MemberInfo) => {
    const role = member.role;
    const canManage = isOwnerOrAdmin && role !== "owner";

    return (
      <View key={member.userId} style={styles.memberCard}>
        <LiquidGlass blur={20} style={styles.memberGlass} />
        <View style={styles.memberContent}>
          <Avatar name={member.displayName || member.username} avatarUrl={member.avatarUrl} size={40} />
          <View style={styles.memberInfo}>
            <Text style={styles.memberName}>{member.displayName || member.username}</Text>
            <Text style={styles.memberUsername}>@{member.username}</Text>
          </View>
          <View style={[styles.roleBadge, { backgroundColor: ROLE_COLORS[role] || ROLE_COLORS.member }]}>
            <Text style={styles.roleText}>{ROLE_LABELS[role] || role}</Text>
          </View>
          {canManage && (
            <View style={styles.memberActions}>
              <TouchableOpacity onPress={() => setRole(member.userId, "admin")} style={styles.actionBtn}>
                <Ionicons name="shield-outline" size={16} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => kick(member.userId, member.username)} style={styles.actionBtn}>
                <Ionicons name="person-remove-outline" size={16} color={colors.danger} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Text style={styles.header}>群成员（{members.length}）</Text>

      {sorted.map(renderMember)}

      {isOwnerOrAdmin && (
        <TouchableOpacity style={styles.inviteBtn} onPress={() => setShowInvite(true)}>
          <Ionicons name="person-add-outline" size={20} color="#fff" />
          <Text style={styles.inviteBtnText}>邀请成员</Text>
        </TouchableOpacity>
      )}

      {showInvite && (
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>邀请成员</Text>
            <TextInput
              style={styles.input}
              placeholder="搜索用户名..."
              placeholderTextColor={colors.textFaint}
              value={inviteQuery}
              onChangeText={searchInvite}
              autoFocus
            />
            <ScrollView style={styles.searchResults}>
              {inviteResults.map((user) => (
                <TouchableOpacity key={user.id} style={styles.searchResultItem} onPress={() => invite(user.id)}>
                  <Text style={styles.searchResultName}>{user.displayName || user.username}</Text>
                  <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalBtnCancel} onPress={() => { setShowInvite(false); setInviteQuery(""); setInviteResults([]); }}>
              <Text style={styles.modalBtnCancelText}>取消</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  contentContainer: { padding: spacing.lg, paddingBottom: 100 },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.bg },
  header: { fontSize: fontSize.xl, fontWeight: "700", color: colors.text, marginBottom: spacing.lg },
  memberCard: { marginBottom: spacing.md, borderRadius: radius.lg, overflow: "hidden", ...elevation.md },
  memberGlass: { ...StyleSheet.absoluteFillObject },
  memberContent: { flexDirection: "row", alignItems: "center", padding: spacing.md, position: "relative" },
  memberInfo: { flex: 1, marginLeft: spacing.md },
  memberName: { fontSize: fontSize.md, fontWeight: "600", color: colors.text },
  memberUsername: { fontSize: fontSize.sm, color: colors.textFaint },
  roleBadge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
  roleText: { fontSize: fontSize.xs, fontWeight: "600", color: colors.text },
  memberActions: { flexDirection: "row", gap: spacing.sm, marginLeft: spacing.sm },
  actionBtn: { padding: spacing.sm },
  inviteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.primary, padding: spacing.md, borderRadius: radius.md, marginTop: spacing.lg },
  inviteBtnText: { fontSize: fontSize.md, fontWeight: "600", color: "#fff" },
  modalOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", zIndex: 1000 },
  modal: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, width: "90%", maxWidth: 400, maxHeight: "80%" },
  modalTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text, marginBottom: spacing.lg },
  input: { backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, fontSize: fontSize.md, color: colors.text, borderWidth: 1, borderColor: colors.border },
  searchResults: { maxHeight: 200, marginBottom: spacing.md },
  searchResultItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  searchResultName: { fontSize: fontSize.md, color: colors.text },
  modalBtnCancel: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bg, alignItems: "center" },
  modalBtnCancelText: { fontSize: fontSize.md, color: colors.text, fontWeight: "600" },
});
