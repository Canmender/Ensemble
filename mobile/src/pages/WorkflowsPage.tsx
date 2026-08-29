/**
 * 工作流管理页
 * GET /api/workflows — 获取工作流列表
 * POST /api/workflows — 创建工作流
 * PUT /api/workflows/:id — 更新工作流
 * DELETE /api/workflows/:id — 删除工作流
 * POST /api/workflows/:id/run — 运行工作流
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
import { useNavigation } from "@react-navigation/native";
import { api } from "../services/api";
import { colors, spacing, radius, fontSize, elevation } from "../theme";
import { LiquidGlass } from "../components/Glass";

interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: number;
  isActive: boolean;
  lastRunAt?: string;
  runCount: number;
  createdAt: string;
}

export default function WorkflowsPage() {
  const navigation = useNavigation();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [form, setForm] = useState({ name: "", description: "" });
  const [runningId, setRunningId] = useState<string | null>(null);

  const loadWorkflows = useCallback(async () => {
    try {
      const data = await api.get<Workflow[]>("/api/workflows");
      setWorkflows(data);
    } catch (e) {
      console.error("加载工作流失败:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadWorkflows();
  }, [loadWorkflows]);

  const handleSave = async () => {
    if (!form.name.trim()) {
      Alert.alert("错误", "请输入工作流名称");
      return;
    }

    try {
      if (editingWorkflow) {
        await api.put(`/api/workflows/${editingWorkflow.id}`, form);
      } else {
        await api.post("/api/workflows", form);
      }
      setShowAddModal(false);
      setEditingWorkflow(null);
      setForm({ name: "", description: "" });
      void loadWorkflows();
    } catch (e) {
      Alert.alert("错误", (e as Error).message || "保存失败");
    }
  };

  const handleDelete = async (workflow: Workflow) => {
    Alert.alert("确认删除", `确定删除工作流 "${workflow.name}"？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          try {
            await api.delete(`/api/workflows/${workflow.id}`);
            void loadWorkflows();
          } catch (e) {
            Alert.alert("错误", (e as Error).message || "删除失败");
          }
        },
      },
    ]);
  };

  const handleRun = async (workflow: Workflow) => {
    Alert.alert("提示", "工作流运行功能暂未开放，敬请期待", [
      { text: "确定", style: "cancel" },
    ]);
  };

  const openEdit = (workflow: Workflow) => {
    setEditingWorkflow(workflow);
    setForm({ name: workflow.name, description: workflow.description });
    setShowAddModal(true);
  };

  const renderWorkflow = (workflow: Workflow) => (
    <View key={workflow.id} style={styles.card}>
      <LiquidGlass blur={20} style={styles.cardGlass} />
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Ionicons name="git-network-outline" size={20} color={colors.primary} />
            <Text style={styles.cardTitle}>{workflow.name}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: workflow.isActive ? "rgba(34,197,94,0.15)" : "rgba(156,163,175,0.15)" }]}>
            <Text style={[styles.statusText, { color: workflow.isActive ? colors.success : colors.textFaint }]}>
              {workflow.isActive ? "启用" : "禁用"}
            </Text>
          </View>
        </View>
        {workflow.description ? <Text style={styles.cardDesc}>{workflow.description}</Text> : null}
        <View style={styles.cardMeta}>
          <View style={styles.metaItem}>
            <Ionicons name="layers-outline" size={12} color={colors.textFaint} />
            <Text style={styles.metaText}>{workflow.steps} 步骤</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="play-outline" size={12} color={colors.textFaint} />
            <Text style={styles.metaText}>{workflow.runCount} 次运行</Text>
          </View>
          {workflow.lastRunAt && (
            <View style={styles.metaItem}>
              <Ionicons name="time-outline" size={12} color={colors.textFaint} />
              <Text style={styles.metaText}>上次: {formatDate(workflow.lastRunAt)}</Text>
            </View>
          )}
        </View>
        <View style={styles.cardActions}>
          <TouchableOpacity
            onPress={() => handleRun(workflow)}
            style={[styles.actionBtn, styles.runBtn]}
            disabled={runningId === workflow.id}
          >
            {runningId === workflow.id ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="play" size={16} color="#fff" />
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => openEdit(workflow)} style={styles.actionBtn}>
            <Ionicons name="pencil-outline" size={16} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleDelete(workflow)} style={styles.actionBtn}>
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
      <Text style={styles.header}>工作流</Text>
      <Text style={styles.subheader}>管理和运行自动化工作流</Text>

      {workflows.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="git-network-outline" size={48} color={colors.textFaint} />
          <Text style={styles.emptyText}>暂无工作流</Text>
          <Text style={styles.emptySubtext}>点击下方按钮创建工作流</Text>
        </View>
      ) : (
        workflows.map(renderWorkflow)
      )}

      <TouchableOpacity style={styles.addBtn} onPress={() => { setEditingWorkflow(null); setForm({ name: "", description: "" }); setShowAddModal(true); }}>
        <Ionicons name="add-circle-outline" size={20} color="#fff" />
        <Text style={styles.addBtnText}>创建工作流</Text>
      </TouchableOpacity>

      {showAddModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{editingWorkflow ? "编辑工作流" : "创建工作流"}</Text>
            <TextInput style={styles.input} placeholder="工作流名称" placeholderTextColor={colors.textFaint} value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
            <TextInput style={[styles.input, styles.textArea]} placeholder="描述 (可选)" placeholderTextColor={colors.textFaint} value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} multiline numberOfLines={3} />
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

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "刚刚";
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 7) return `${diffDays} 天前`;
  return date.toLocaleDateString("zh-CN");
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  contentContainer: { padding: spacing.lg, paddingBottom: 100 },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.bg },
  header: { fontSize: fontSize.xl, fontWeight: "700", color: colors.text, marginBottom: spacing.xs },
  subheader: { fontSize: fontSize.sm, color: colors.textFaint, marginBottom: spacing.lg },
  card: { marginBottom: spacing.md, borderRadius: radius.lg, overflow: "hidden", ...elevation.md },
  cardGlass: { ...StyleSheet.absoluteFillObject },
  cardContent: { padding: spacing.lg, position: "relative" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  cardTitle: { fontSize: fontSize.md, fontWeight: "600", color: colors.text, flex: 1 },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
  statusText: { fontSize: fontSize.xs, fontWeight: "600" },
  cardDesc: { fontSize: fontSize.sm, color: colors.textFaint, marginBottom: spacing.sm, lineHeight: 20 },
  cardMeta: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginBottom: spacing.sm },
  metaItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  metaText: { fontSize: fontSize.xs, color: colors.textFaint },
  cardActions: { flexDirection: "row", gap: spacing.sm },
  actionBtn: { padding: spacing.sm },
  runBtn: { backgroundColor: colors.success, borderRadius: radius.sm, paddingHorizontal: spacing.md },
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
