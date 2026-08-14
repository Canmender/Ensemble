/**
 * 联系人页（通讯录）
 * - 分组可折叠：设备（系统固定：手机端 + 电脑端）、用户（全部用户）、用户自定义分组
 * - 自定义分组：组名 + 成员（本地 AsyncStorage 持久化），可新建 / 编辑 / 删除
 * - 点击用户 → 个人资料页；点击 Agent → 直接开聊
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTaskStore } from "../store/taskStore";
import { useDeviceStore } from "../store/deviceStore";
import { api, type UserInfo } from "../services/api";
import { useChatTarget } from "../store/chatTargetStore";
import { wsLink } from "../services/wslink";
import { colors, spacing, radius, fontSize } from "../theme";
import { Avatar } from "../components/Avatar";
import type { AgentConfig } from "@ensemble/shared-protocol";

const GROUPS_KEY = "@ensemble/contact-groups";

/** 用户自定义分组 */
interface ContactGroup {
  id: string;
  name: string;
  memberIds: string[];
}

type Row =
  | { type: "header"; key: string; title: string; count: number; system: boolean; collapsed: boolean }
  | { type: "item"; key: string; kind: "user" | "agent" | "device"; id: string; name: string; subtitle: string; user?: UserInfo; agent?: AgentConfig; deviceIcon?: keyof typeof Ionicons.glyphMap };

export default function ContactsPage({ navigation }: { navigation: any }) {
  const { agents } = useTaskStore();
  const { currentDevice } = useDeviceStore();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [devices, setDevices] = useState<Array<{ id: string; name: string; type: string; online: boolean }>>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [manageOpen, setManageOpen] = useState(false);
  // 创建群聊（用户 + Agent 可混合，三类群）
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  // 编辑态：null=列表视图；{mode:'new'}=新建；{mode:'edit',group}=编辑
  const [editState, setEditState] = useState<{ mode: "new" } | { mode: "edit"; group: ContactGroup } | null>(null);
  const [editName, setEditName] = useState("");
  const [editIds, setEditIds] = useState<Set<string>>(new Set());
  const setTarget = useChatTarget((s) => s.setTarget);

  const loadUsers = useCallback(async () => {
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

  const loadGroups = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(GROUPS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ContactGroup[];
        if (Array.isArray(parsed)) setGroups(parsed);
      }
    } catch {
      /* 忽略 */
    }
  }, []);

  const saveGroups = useCallback((next: ContactGroup[]) => {
    setGroups(next);
    void AsyncStorage.setItem(GROUPS_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      const res = await api.getDevices();
      if (res.data) setDevices(res.data);
    } catch {
      /* 忽略 */
    }
  }, []);

  useEffect(() => {
    void loadUsers();
    void loadGroups();
    void loadDevices();
    // 设备在线状态变化实时刷新
    const unsub = wsLink.on({ onDeviceStatus: () => void loadDevices() });
    return unsub;
  }, [loadUsers, loadGroups, loadDevices]);

  const q = query.trim().toLowerCase();
  const matchUser = (u: UserInfo) =>
    !q || (u.displayName || u.username).toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
  const matchAgent = (a: AgentConfig) => !q || a.name.toLowerCase().includes(q);

  // 全部用户（过滤搜索）
  const allUsers = users.filter(matchUser);
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const toggle = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  // 打开组管理
  const openManage = () => {
    setManageOpen(true);
    setEditState(null);
  };
  const startNew = () => {
    setEditState({ mode: "new" });
    setEditName("");
    setEditIds(new Set());
  };
  const startEdit = (g: ContactGroup) => {
    setEditState({ mode: "edit", group: g });
    setEditName(g.name);
    setEditIds(new Set(g.memberIds));
  };
  const toggleMember = (id: string) => {
    setEditIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const saveEdit = () => {
    const name = editName.trim();
    if (!name) return;
    const memberIds = Array.from(editIds);
    if (editState?.mode === "new") {
      saveGroups([...groups, { id: `g${Date.now()}`, name, memberIds }]);
    } else if (editState?.mode === "edit") {
      saveGroups(
        groups.map((g) => (g.id === editState.group.id ? { ...g, name, memberIds } : g)),
      );
    }
    setEditState(null);
  };
  const deleteGroup = (id: string) => {
    saveGroups(groups.filter((g) => g.id !== id));
    setEditState(null);
  };

  /** 创建群聊成员多选 */
  const toggleGroupMember = (id: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 创建群聊（用户 / Agent 可混合 → 三类群） */
  const createGroup = async () => {
    const ids = Array.from(selectedMembers);
    const name = groupName.trim();
    if (!name || ids.length < 2) return;
    const res = await api.createConversation({ type: "group", title: name, participantIds: ids });
    if (res.error) {
      Alert.alert("创建失败", res.error);
      return;
    }
    if (res.data) {
      navigation.navigate("ChatRoom", { convId: res.data.id, runId: res.data.runId, title: name });
    }
    setShowCreateGroup(false);
    setGroupName("");
    setSelectedMembers(new Set());
  };

  const openContact = (row: Row) => {
    if (row.type !== "item") return;
    if (row.kind === "user" && row.user) {
      navigation.navigate("UserProfile", {
        userId: row.id,
        name: row.name,
        username: row.user.username,
        displayName: row.user.displayName,
      });
    } else if (row.kind === "agent") {
      setTarget({ kind: "agent", id: row.id, name: row.name });
      navigation.navigate("Chat");
    }
  };

  // 构建分组列表（系统组 + 自定义组）
  const sections: Array<{ key: string; title: string; system: boolean; rows: Row[] }> = [
    {
      key: "devices",
      title: "设备",
      system: true,
      rows: devices.map((d) => ({
        type: "item" as const,
        key: `dev-${d.id}`,
        kind: "device" as const,
        id: d.id,
        name: d.name || (d.type === "desktop" ? "电脑端" : "手机端"),
        subtitle: `${d.id === currentDevice?.id ? "本机 · " : ""}${d.online ? "在线" : "离线"}`,
        deviceIcon: (d.type === "desktop" ? "desktop-outline" : "phone-portrait-outline") as keyof typeof Ionicons.glyphMap,
      })),
    },
    {
      key: "users",
      title: "用户",
      system: true,
      rows: allUsers.map((u) => ({
        type: "item" as const,
        key: `user-${u.id}`,
        kind: "user" as const,
        id: u.id,
        name: u.displayName || u.username,
        subtitle: "用户",
        user: u,
      })),
    },
    ...groups.map((g) => ({
      key: g.id,
      title: g.name,
      system: false,
      rows: g.memberIds
        .map((id) => usersById.get(id))
        .filter((u): u is UserInfo => !!u && matchUser(u))
        .map((u) => ({
          type: "item" as const,
          key: `${g.id}-${u.id}`,
          kind: "user" as const,
          id: u.id,
          name: u.displayName || u.username,
          subtitle: g.name,
          user: u,
        })),
    })),
  ].filter((s) => s.rows.length > 0);

  const flatData: Row[] = [];
  for (const s of sections) {
    const isCollapsed = !!collapsed[s.key];
    flatData.push({ type: "header", key: `h-${s.key}`, title: s.title, count: s.rows.length, system: s.system, collapsed: isCollapsed });
    if (!isCollapsed) flatData.push(...s.rows);
  }

  const renderHeader = (h: Extract<Row, { type: "header" }>) => (
    <TouchableOpacity style={styles.sectionHeader} onPress={() => toggle(h.key.slice(2))} activeOpacity={0.7}>
      <Ionicons name={h.collapsed ? "chevron-forward" : "chevron-down"} size={14} color={colors.textMuted} />
      <Text style={styles.sectionTitle}>{h.title}</Text>
      <Text style={styles.sectionCount}>{h.count}</Text>
      {h.system && <Text style={styles.sectionSys}>系统</Text>}
    </TouchableOpacity>
  );

  const renderItem = ({ item }: { item: Row }) => {
    if (item.type === "header") return renderHeader(item);
    const row = item;
    if (row.kind === "device") {
      const online = row.subtitle.includes("在线");
      return (
        <View style={styles.row}>
          <View style={[styles.avatar, { backgroundColor: colors.surfaceAlt }]}>
            <Ionicons name={row.deviceIcon} size={20} color={colors.textMuted} />
          </View>
          <View style={styles.rowInfo}>
            <Text style={styles.rowName}>{row.name}</Text>
            <Text style={styles.rowSubtitle}>{row.subtitle}</Text>
          </View>
          <View style={[styles.onlineDot, { backgroundColor: online ? "#10b981" : "#9ca3af" }]} />
        </View>
      );
    }
    const isUser = row.kind === "user";
    return (
      <TouchableOpacity style={styles.row} onPress={() => openContact(row)} activeOpacity={0.7}>
        <Avatar
          name={row.name}
          avatarUrl={isUser ? row.user?.avatarUrl : undefined}
          size={44}
        />
        <View style={styles.rowInfo}>
          <Text style={styles.rowName}>{row.name}</Text>
          <Text style={styles.rowSubtitle}>{row.subtitle}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* 搜索框 */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={colors.textFaint} />
        <TextInput
          style={styles.searchInput}
          placeholder="搜索联系人"
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

      {/* 操作栏：新建分组 + 创建群聊 */}
      <View style={styles.actionBar}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => setShowCreateGroup(true)} activeOpacity={0.7}>
          <View style={styles.actionIcon}>
            <Ionicons name="chatbubbles-outline" size={18} color={colors.primary} />
          </View>
          <Text style={styles.actionLabel}>创建群聊</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={openManage} activeOpacity={0.7}>
          <View style={styles.actionIcon}>
            <Ionicons name="folder-open-outline" size={18} color={colors.primary} />
          </View>
          <Text style={styles.actionLabel}>分组管理</Text>
        </TouchableOpacity>
      </View>

      {loading && users.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : flatData.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="people-outline" size={40} color={colors.textFaint} />
          <Text style={styles.emptyText}>暂无联系人</Text>
        </View>
      ) : (
        <FlatList
          data={flatData}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {/* 分组管理 */}
      <Modal transparent visible={manageOpen} animationType="slide" onRequestClose={() => setManageOpen(false)}>
        <View style={styles.manageOverlay}>
          <View style={styles.manageSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{editState ? (editState.mode === "new" ? "新建分组" : "编辑分组") : "分组管理"}</Text>
              <TouchableOpacity onPress={() => (editState ? setEditState(null) : setManageOpen(false))} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {editState ? (
              <>
                <Text style={styles.fieldLabel}>组名</Text>
                <TextInput
                  style={styles.input}
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="输入组名，如：同事 / 家人"
                  placeholderTextColor={colors.textFaint}
                  maxLength={20}
                />
                <Text style={styles.fieldLabel}>
                  选择成员（{editIds.size}）
                </Text>
                <ScrollView style={{ maxHeight: 300 }}>
                  {users.map((u) => (
                    <TouchableOpacity
                      key={u.id}
                      style={styles.memberRow}
                      onPress={() => toggleMember(u.id)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.memberAvatar, { backgroundColor: colors.primarySoft }]}>
                        <Text style={[styles.memberAvatarText, { color: colors.primary }]}>
                          {(u.displayName || u.username)[0]?.toUpperCase() || "?"}
                        </Text>
                      </View>
                      <Text style={styles.memberName}>{u.displayName || u.username}</Text>
                      <Ionicons
                        name={editIds.has(u.id) ? "checkmark-circle" : "ellipse-outline"}
                        size={22}
                        color={editIds.has(u.id) ? colors.primary : colors.textFaint}
                      />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <View style={styles.sheetActions}>
                  <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setEditState(null)}>
                    <Text style={[styles.btnText, { color: colors.textMuted }]}>取消</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnPrimary, !editName.trim() && { opacity: 0.5 }]}
                    onPress={saveEdit}
                    disabled={!editName.trim()}
                  >
                    <Text style={[styles.btnText, { color: "#fff" }]}>保存</Text>
                  </TouchableOpacity>
                </View>
                {editState.mode === "edit" && (
                  <TouchableOpacity
                    style={styles.deleteGroup}
                    onPress={() => {
                      if (editState.mode === "edit") deleteGroup(editState.group.id);
                    }}
                  >
                    <Text style={styles.deleteGroupText}>删除分组</Text>
                  </TouchableOpacity>
                )}
              </>
            ) : (
              <>
                <TouchableOpacity style={styles.newGroupBtn} onPress={startNew} activeOpacity={0.7}>
                  <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                  <Text style={styles.newGroupText}>新建分组</Text>
                </TouchableOpacity>
                {groups.length === 0 ? (
                  <Text style={styles.noGroup}>还没有自定义分组，点上方「新建分组」把用户分组管理</Text>
                ) : (
                  groups.map((g) => (
                    <View key={g.id} style={styles.groupRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.groupName}>{g.name}</Text>
                        <Text style={styles.groupMeta}>{g.memberIds.length} 位成员</Text>
                      </View>
                      <TouchableOpacity style={styles.groupAction} onPress={() => startEdit(g)} hitSlop={6}>
                        <Ionicons name="create-outline" size={18} color={colors.textMuted} />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.groupAction} onPress={() => deleteGroup(g.id)} hitSlop={6}>
                        <Ionicons name="trash-outline" size={18} color={colors.danger} />
                      </TouchableOpacity>
                    </View>
                  ))
                )}
                <Text style={styles.manageHint}>
                  「设备」与「用户」为系统分组，不可编辑。自定义分组保存在本机。
                </Text>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* 创建群聊（用户 + Agent 可混合 → 三类群） */}
      <Modal transparent visible={showCreateGroup} animationType="slide" onRequestClose={() => setShowCreateGroup(false)}>
        <View style={styles.manageOverlay}>
          <View style={styles.manageSheet}>
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
                <TouchableOpacity key={u.id} style={styles.memberRow} onPress={() => toggleGroupMember(u.id)} activeOpacity={0.7}>
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
              {agents
                .filter((a) => a.enabled)
                .map((a) => (
                  <TouchableOpacity key={a.id} style={styles.memberRow} onPress={() => toggleGroupMember(a.id)} activeOpacity={0.7}>
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
  // 操作栏
  actionBar: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  actionIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: { color: colors.primary, fontSize: fontSize.sm, fontWeight: "600" },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 6,
  },
  sectionTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: "600" },
  sectionCount: { color: colors.textFaint, fontSize: fontSize.xs, marginLeft: 4 },
  sectionSys: { color: colors.textFaint, fontSize: 10, marginLeft: "auto" },
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
  onlineDot: { width: 8, height: 8, borderRadius: 4, marginLeft: "auto" },
  rowInfo: { flex: 1 },
  rowName: { color: colors.text, fontSize: fontSize.md, fontWeight: "500" },
  rowSubtitle: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingBottom: 60 },
  emptyText: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: "center", paddingHorizontal: 40 },
  manageOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  manageSheet: {
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
    marginBottom: spacing.md,
  },
  sheetTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: "600" },
  newGroupBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  newGroupText: { color: colors.primary, fontSize: fontSize.md, fontWeight: "600" },
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  groupName: { color: colors.text, fontSize: fontSize.md, fontWeight: "600" },
  groupMeta: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
  groupAction: { padding: 6 },
  noGroup: { color: colors.textFaint, fontSize: fontSize.sm, paddingVertical: spacing.md },
  manageHint: { color: colors.textFaint, fontSize: fontSize.xs, marginTop: spacing.md, lineHeight: 18 },
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
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: "center",
  },
  btnGhost: { backgroundColor: colors.surfaceAlt },
  btnPrimary: { backgroundColor: colors.primary },
  btnText: { fontSize: fontSize.md, fontWeight: "600" },
  deleteGroup: { alignItems: "center", marginTop: spacing.md },
  deleteGroupText: { color: colors.danger, fontSize: fontSize.sm, fontWeight: "600" },
});
