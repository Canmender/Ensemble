/**
 * 群设置页：修改群名 / 查看成员 / 添加成员 / 移除成员
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api, type Conversation, type UserInfo } from "../services/api";
import { useDeviceStore } from "../store/deviceStore";
import { colors, spacing, radius, fontSize } from "../theme";
import type { RootStackParamList } from "../App";

type Props = NativeStackScreenProps<RootStackParamList, "GroupSettings">;

export default function GroupSettingsPage({ route, navigation }: Props) {
  const { convId, title: initialTitle } = route.params;
  const d = useDeviceStore.getState().connectedDevice;
  const baseUrl = d ? `http://${d.ip}:${d.httpPort}` : "";

  const [conv, setConv] = useState<Conversation | null>(null);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [editTitle, setEditTitle] = useState(initialTitle || "");
  const [saving, setSaving] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [allUsers, setAllUsers] = useState<UserInfo[]>([]);

  const usersById = new Map(users.map((u) => [u.id, u]));

  useEffect(() => {
    void api.getConversations().then((res) => {
      const c = res.data?.find((x) => x.id === convId);
      if (c) {
        setConv(c);
        setEditTitle(c.title || "");
        // 加载成员信息
        void api.getUsers().then((r) => {
          if (r.data) {
            const memberUsers = r.data.filter((u) => c.participantIds.includes(u.id));
            setUsers(memberUsers);
            setAllUsers(r.data);
          }
        });
      }
    });
  }, [convId]);

  // 修改群名
  const saveTitle = useCallback(async () => {
    if (!editTitle.trim() || editTitle === conv?.title) return;
    setSaving(true);
    const res = await api.updateConversation(convId, { title: editTitle.trim() });
    setSaving(false);
    if (res.error) {
      Alert.alert("修改失败", res.error);
    } else {
      setConv((prev) => prev ? { ...prev, title: editTitle.trim() } : prev);
      navigation.setOptions({ title: editTitle.trim() });
    }
  }, [editTitle, conv, convId, navigation]);

  // 移除成员
  const removeMember = useCallback((userId: string) => {
    if (!conv) return;
    const user = usersById.get(userId);
    const name = user?.displayName || user?.username || userId;
    Alert.alert("移除成员", `确定将「${name}」移出群聊？`, [
      { text: "取消", style: "cancel" },
      {
        text: "移除",
        style: "destructive",
        onPress: async () => {
          const newIds = conv.participantIds.filter((id) => id !== userId);
          const res = await api.updateConversation(convId, { participantIds: newIds });
          if (!res.error) {
            setConv((prev) => prev ? { ...prev, participantIds: newIds } : prev);
            setUsers((prev) => prev.filter((u) => u.id !== userId));
          }
        },
      },
    ]);
  }, [conv, convId, usersById]);

  // 添加成员
  const addMember = useCallback(async (userId: string) => {
    if (!conv) return;
    if (conv.participantIds.includes(userId)) return;
    const newIds = [...conv.participantIds, userId];
    const res = await api.updateConversation(convId, { participantIds: newIds });
    if (!res.error) {
      setConv((prev) => prev ? { ...prev, participantIds: newIds } : prev);
      const user = allUsers.find((u) => u.id === userId);
      if (user) setUsers((prev) => [...prev, user]);
    }
    setShowAddMember(false);
  }, [conv, convId, allUsers]);

  // 可添加的用户（不在当前成员中）
  const addableUsers = allUsers.filter((u) => !conv?.participantIds.includes(u.id));

  return (
    <View style={styles.container}>
      {/* 群名编辑 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>群名称</Text>
        <View style={styles.titleRow}>
          <TextInput
            style={styles.titleInput}
            value={editTitle}
            onChangeText={setEditTitle}
            placeholder="输入群名称"
            placeholderTextColor={colors.textFaint}
            maxLength={30}
          />
          {saving ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            editTitle.trim() && editTitle !== conv?.title && (
              <TouchableOpacity onPress={saveTitle} hitSlop={8}>
                <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
              </TouchableOpacity>
            )
          )}
        </View>
      </View>

      {/* 成员列表 */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>成员（{users.length}）</Text>
          <TouchableOpacity onPress={() => setShowAddMember(true)} hitSlop={8}>
            <Ionicons name="person-add" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          renderItem={({ item: u }) => (
            <View style={styles.memberRow}>
              <View style={styles.memberAvatar}>
                <Text style={styles.memberAvatarText}>
                  {(u.displayName || u.username || "?")[0]}
                </Text>
              </View>
              <Text style={styles.memberName}>{u.displayName || u.username}</Text>
              <TouchableOpacity onPress={() => removeMember(u.id)} hitSlop={8}>
                <Ionicons name="close-circle" size={20} color={colors.danger} />
              </TouchableOpacity>
            </View>
          )}
          scrollEnabled={false}
        />
      </View>

      {/* 添加成员弹窗 */}
      <Modal
        transparent
        visible={showAddMember}
        animationType="slide"
        onRequestClose={() => setShowAddMember(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>添加成员</Text>
              <TouchableOpacity onPress={() => setShowAddMember(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {addableUsers.length === 0 ? (
              <Text style={styles.emptyText}>没有可添加的用户</Text>
            ) : (
              <FlatList
                data={addableUsers}
                keyExtractor={(u) => u.id}
                renderItem={({ item: u }) => (
                  <TouchableOpacity
                    style={styles.memberRow}
                    onPress={() => addMember(u.id)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.memberAvatar}>
                      <Text style={styles.memberAvatarText}>
                        {(u.displayName || u.username || "?")[0]}
                      </Text>
                    </View>
                    <Text style={styles.memberName}>{u.displayName || u.username}</Text>
                    <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  section: {
    backgroundColor: colors.surface,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: "600", marginBottom: spacing.sm },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  titleInput: {
    flex: 1,
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.text,
    fontSize: fontSize.md,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  memberAvatarText: { color: colors.primary, fontSize: 14, fontWeight: "700" },
  memberName: { flex: 1, color: colors.text, fontSize: fontSize.md },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: "70%",
    paddingBottom: spacing.xl,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: "600" },
  emptyText: { color: colors.textMuted, textAlign: "center", paddingVertical: spacing.xl },
});
