/**
 * 技能管理页
 * GET /api/skills — 获取技能列表
 * POST /api/skills — 添加技能
 * PUT /api/skills/:id — 更新技能
 * DELETE /api/skills/:id — 删除技能
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

interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  isActive: boolean;
  usageCount: number;
  createdAt: string;
}

export default function SettingsSkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [form, setForm] = useState({ name: "", description: "", category: "general" });
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    try {
      const data = await api.get<Skill[]>("/api/skills");
      setSkills(data);
    } catch (e) {
      console.error("加载技能失败:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadSkills();
  }, [loadSkills]);

  const handleSave = async () => {
    if (!form.name.trim()) {
      Alert.alert("错误", "请输入技能名称");
      return;
    }

    try {
      if (editingSkill) {
        await api.put(`/api/skills/${editingSkill.id}`, form);
      } else {
        await api.post("/api/skills", form);
      }
      setShowAddModal(false);
      setEditingSkill(null);
      setForm({ name: "", description: "", category: "general" });
      void loadSkills();
    } catch (e) {
      Alert.alert("错误", (e as Error).message || "保存失败");
    }
  };

  const handleDelete = async (skill: Skill) => {
    Alert.alert("确认删除", `确定删除技能 "${skill.name}"？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          try {
            await api.delete(`/api/skills/${skill.id}`);
            void loadSkills();
          } catch (e) {
            Alert.alert("错误", (e as Error).message || "删除失败");
          }
        },
      },
    ]);
  };

  const handleToggleActive = async (skill: Skill) => {
    try {
      await api.put(`/api/skills/${skill.id}`, { isActive: !skill.isActive });
      void loadSkills();
    } catch (e) {
      Alert.alert("错误", (e as Error).message || "切换失败");
    }
  };

  const openEdit = (skill: Skill) => {
    setEditingSkill(skill);
    setForm({ name: skill.name, description: skill.description, category: skill.category });
    setShowAddModal(true);
  };

  const categories = [...new Set(skills.map((s) => s.category))];
  const filteredSkills = selectedCategory ? skills.filter((s) => s.category === selectedCategory) : skills;

  const renderSkill = (skill: Skill) => (
    <View key={skill.id} style={styles.card}>
      <LiquidGlass blur={20} style={styles.cardGlass} />
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Ionicons name="flash-outline" size={20} color={colors.primary} />
            <Text style={styles.cardTitle}>{skill.name}</Text>
          </View>
          <TouchableOpacity onPress={() => handleToggleActive(skill)} style={styles.toggleBtn}>
            <View style={[styles.toggleDot, skill.isActive && styles.toggleDotActive]} />
          </TouchableOpacity>
        </View>
        <Text style={styles.cardDesc}>{skill.description || "无描述"}</Text>
        <View style={styles.cardMeta}>
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText}>{skill.category}</Text>
          </View>
          <View style={styles.usageBadge}>
            <Ionicons name="stats-chart-outline" size={12} color={colors.textFaint} />
            <Text style={styles.usageText}>{skill.usageCount} 次使用</Text>
          </View>
        </View>
        <View style={styles.cardActions}>
          <TouchableOpacity onPress={() => openEdit(skill)} style={styles.actionBtn}>
            <Ionicons name="pencil-outline" size={16} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleDelete(skill)} style={styles.actionBtn}>
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
      <Text style={styles.header}>技能管理</Text>
      <Text style={styles.subheader}>管理 AI 助手的技能和工具</Text>

      {categories.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
          <TouchableOpacity
            style={[styles.categoryChip, !selectedCategory && styles.categoryChipActive]}
            onPress={() => setSelectedCategory(null)}
          >
            <Text style={[styles.categoryChipText, !selectedCategory && styles.categoryChipTextActive]}>全部</Text>
          </TouchableOpacity>
          {categories.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[styles.categoryChip, selectedCategory === cat && styles.categoryChipActive]}
              onPress={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
            >
              <Text style={[styles.categoryChipText, selectedCategory === cat && styles.categoryChipTextActive]}>{cat}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {filteredSkills.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="flash-outline" size={48} color={colors.textFaint} />
          <Text style={styles.emptyText}>暂无技能</Text>
          <Text style={styles.emptySubtext}>点击下方按钮添加技能</Text>
        </View>
      ) : (
        filteredSkills.map(renderSkill)
      )}

      <TouchableOpacity style={styles.addBtn} onPress={() => { setEditingSkill(null); setForm({ name: "", description: "", category: "general" }); setShowAddModal(true); }}>
        <Ionicons name="add-circle-outline" size={20} color="#fff" />
        <Text style={styles.addBtnText}>添加技能</Text>
      </TouchableOpacity>

      {showAddModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{editingSkill ? "编辑技能" : "添加技能"}</Text>
            <TextInput style={styles.input} placeholder="技能名称" placeholderTextColor={colors.textFaint} value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
            <TextInput style={[styles.input, styles.textArea]} placeholder="技能描述" placeholderTextColor={colors.textFaint} value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} multiline numberOfLines={3} />
            <TextInput style={styles.input} placeholder="分类 (general/code/writing等)" placeholderTextColor={colors.textFaint} value={form.category} onChangeText={(v) => setForm({ ...form, category: v })} />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  contentContainer: { padding: spacing.lg, paddingBottom: 100 },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.bg },
  header: { fontSize: fontSize.xl, fontWeight: "700", color: colors.text, marginBottom: spacing.xs },
  subheader: { fontSize: fontSize.sm, color: colors.textFaint, marginBottom: spacing.lg },
  categoryScroll: { marginBottom: spacing.lg },
  categoryChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, marginRight: spacing.sm, borderWidth: 1, borderColor: colors.border },
  categoryChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  categoryChipText: { fontSize: fontSize.sm, color: colors.text },
  categoryChipTextActive: { color: "#fff" },
  card: { marginBottom: spacing.md, borderRadius: radius.lg, overflow: "hidden", ...elevation.md },
  cardGlass: { ...StyleSheet.absoluteFillObject },
  cardContent: { padding: spacing.lg, position: "relative" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  cardTitle: { fontSize: fontSize.md, fontWeight: "600", color: colors.text, flex: 1 },
  cardDesc: { fontSize: fontSize.sm, color: colors.textFaint, marginBottom: spacing.sm, lineHeight: 20 },
  cardMeta: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  categoryBadge: { backgroundColor: "rgba(99,102,241,0.15)", paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
  categoryText: { fontSize: fontSize.xs, fontWeight: "600", color: colors.primary },
  usageBadge: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.bg, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
  usageText: { fontSize: fontSize.xs, color: colors.textFaint },
  cardActions: { flexDirection: "row", gap: spacing.md },
  actionBtn: { padding: spacing.sm },
  toggleBtn: { width: 44, height: 24, borderRadius: 12, backgroundColor: colors.border, justifyContent: "center", paddingHorizontal: 2 },
  toggleDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },
  toggleDotActive: { backgroundColor: colors.success, marginLeft: 22 },
  emptyContainer: { alignItems: "center", padding: spacing.xl * 2 },
  emptyText: { fontSize: fontSize.md, color: colors.textFaint, marginTop: spacing.md },
  emptySubtext: { fontSize: fontSize.sm, color: colors.textFaint, marginTop: spacing.xs },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.primary, padding: spacing.md, borderRadius: radius.md, marginTop: spacing.lg },
  addBtnText: { fontSize: fontSize.md, fontWeight: "600", color: "#fff" },
  modalOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", zIndex: 1000 },
  modal: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, width: "90%", maxWidth: 400 },
  modalTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text, marginBottom: spacing.lg },
  input: { backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, fontSize: fontSize.md, color: colors.text, borderWidth: 1, borderColor: colors.border },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  modalActions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
  modalBtnCancel: { flex: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bg, alignItems: "center" },
  modalBtnCancelText: { fontSize: fontSize.md, color: colors.text, fontWeight: "600" },
  modalBtnSave: { flex: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center" },
  modalBtnSaveText: { fontSize: fontSize.md, color: "#fff", fontWeight: "600" },
});
