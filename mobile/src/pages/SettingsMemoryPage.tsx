/**
 * 记忆管理页
 * GET /api/memory — 获取记忆列表
 * POST /api/memory — 添加记忆
 * DELETE /api/memory/:id — 删除记忆
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
  TextInput,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../services/api";
import { colors, spacing, radius, fontSize, elevation } from "../theme";
import { LiquidGlass } from "../components/Glass";

interface Memory {
  id: string;
  key: string;
  value: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

export default function SettingsMemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState({ key: "", value: "", category: "user" });
  const [searchQuery, setSearchQuery] = useState("");

  const loadMemories = useCallback(async () => {
    try {
      const data = await api.get<Memory[]>("/memory");
      setMemories(data);
    } catch (e) {
      console.error("加载记忆失败:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadMemories();
  }, [loadMemories]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadMemories();
  }, [loadMemories]);

  const handleSave = async () => {
    if (!form.key.trim() || !form.value.trim()) {
      Alert.alert("错误", "请填写完整的记忆信息");
      return;
    }

    try {
      await api.post("/memory", form);
      setShowAddModal(false);
      setForm({ key: "", value: "", category: "user" });
      void loadMemories();
    } catch (e) {
      Alert.alert("错误", (e as Error).message || "保存失败");
    }
  };

  const handleDelete = async (memory: Memory) => {
    Alert.alert("确认删除", `确定删除记忆 "${memory.key}"？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          try {
            await api.delete(`/memory/${memory.id}`);
            void loadMemories();
          } catch (e) {
            Alert.alert("错误", (e as Error).message || "删除失败");
          }
        },
      },
    ]);
  };

  const filteredMemories = memories.filter(
    (m) =>
      m.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.value.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderMemory = (memory: Memory) => (
    <View key={memory.id} style={styles.card}>
      <LiquidGlass blur={20} style={styles.cardGlass} />
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Ionicons name="finger-print-outline" size={20} color={colors.primary} />
            <Text style={styles.cardTitle}>{memory.key}</Text>
          </View>
          <View style={[styles.categoryBadge, { backgroundColor: getCategoryColor(memory.category) }]}>
            <Text style={styles.categoryText}>{memory.category}</Text>
          </View>
        </View>
        <Text style={styles.cardValue} numberOfLines={3}>{memory.value}</Text>
        <View style={styles.cardActions}>
          <TouchableOpacity onPress={() => handleDelete(memory)} style={styles.actionBtn}>
            <Ionicons name="trash-outline" size={16} color={colors.danger} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

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
      <Text style={styles.header}>记忆管理</Text>
      <Text style={styles.subheader}>管理 AI 记忆和上下文信息</Text>

      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={20} color={colors.textFaint} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="搜索记忆..."
          placeholderTextColor={colors.textFaint}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {filteredMemories.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="brain-outline" size={48} color={colors.textFaint} />
          <Text style={styles.emptyText}>暂无记忆</Text>
          <Text style={styles.emptySubtext}>点击下方按钮添加记忆</Text>
        </View>
      ) : (
        filteredMemories.map(renderMemory)
      )}

      <TouchableOpacity style={styles.addBtn} onPress={() => { setForm({ key: "", value: "", category: "user" }); setShowAddModal(true); }}>
        <Ionicons name="add-circle-outline" size={20} color="#fff" />
        <Text style={styles.addBtnText}>添加记忆</Text>
      </TouchableOpacity>

      {showAddModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>添加记忆</Text>
            <TextInput style={styles.input} placeholder="键 (如: user_role)" placeholderTextColor={colors.textFaint} value={form.key} onChangeText={(v) => setForm({ ...form, key: v })} />
            <TextInput style={[styles.input, styles.textArea]} placeholder="值 (记忆内容)" placeholderTextColor={colors.textFaint} value={form.value} onChangeText={(v) => setForm({ ...form, value: v })} multiline numberOfLines={4} />
            <TextInput style={styles.input} placeholder="分类 (user/feedback/project等)" placeholderTextColor={colors.textFaint} value={form.category} onChangeText={(v) => setForm({ ...form, category: v })} />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtnCancel} onPress={() => setShowAddModal(false)}>
                <Text style={styles.modalBtnCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalBtnSave} onPress={handleSave}>
                <Text style={styles.modalBtnSaveText}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    user: "rgba(99,102,241,0.15)",
    feedback: "rgba(34,197,94,0.15)",
    project: "rgba(245,158,11,0.15)",
    reference: "rgba(139,92,246,0.15)",
  };
  return colors[category] || colors.user;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  contentContainer: { padding: spacing.lg, paddingBottom: 100 },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.bg },
  header: { fontSize: fontSize.xl, fontWeight: "700", color: colors.text, marginBottom: spacing.xs },
  subheader: { fontSize: fontSize.sm, color: colors.textFaint, marginBottom: spacing.lg },
  searchContainer: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border },
  searchIcon: { marginRight: spacing.sm },
  searchInput: { flex: 1, fontSize: fontSize.md, color: colors.text },
  card: { marginBottom: spacing.md, borderRadius: radius.lg, overflow: "hidden", ...elevation.md },
  cardGlass: { ...StyleSheet.absoluteFillObject },
  cardContent: { padding: spacing.lg, position: "relative" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  cardTitle: { fontSize: fontSize.md, fontWeight: "600", color: colors.text, flex: 1 },
  categoryBadge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
  categoryText: { fontSize: fontSize.xs, fontWeight: "600", color: colors.text },
  cardValue: { fontSize: fontSize.sm, color: colors.textFaint, lineHeight: 20 },
  cardActions: { flexDirection: "row", justifyContent: "flex-end", marginTop: spacing.sm },
  actionBtn: { padding: spacing.sm },
  emptyContainer: { alignItems: "center", padding: spacing.xl * 2 },
  emptyText: { fontSize: fontSize.md, color: colors.textFaint, marginTop: spacing.md },
  emptySubtext: { fontSize: fontSize.sm, color: colors.textFaint, marginTop: spacing.xs },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.primary, padding: spacing.md, borderRadius: radius.md, marginTop: spacing.lg },
  addBtnText: { fontSize: fontSize.md, fontWeight: "600", color: "#fff" },
  modalOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", zIndex: 1000 },
  modal: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, width: "90%", maxWidth: 400 },
  modalTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text, marginBottom: spacing.lg },
  input: { backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, fontSize: fontSize.md, color: colors.text, borderWidth: 1, borderColor: colors.border },
  textArea: { minHeight: 100, textAlignVertical: "top" },
  modalActions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
  modalBtnCancel: { flex: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bg, alignItems: "center" },
  modalBtnCancelText: { fontSize: fontSize.md, color: colors.text, fontWeight: "600" },
  modalBtnSave: { flex: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center" },
  modalBtnSaveText: { fontSize: fontSize.md, color: "#fff", fontWeight: "600" },
});
