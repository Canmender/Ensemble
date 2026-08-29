/**
 * MCP 服务管理页
 * GET /api/mcp — 获取 MCP 服务列表
 * POST /api/mcp — 添加 MCP 服务
 * PUT /api/mcp/:id — 更新 MCP 服务
 * DELETE /api/mcp/:id — 删除 MCP 服务
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

interface MCPService {
  id: string;
  name: string;
  url: string;
  description?: string;
  isActive: boolean;
  toolsCount: number;
  createdAt: string;
}

export default function SettingsMCPPage() {
  const [services, setServices] = useState<MCPService[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingService, setEditingService] = useState<MCPService | null>(null);
  const [form, setForm] = useState({ name: "", url: "", description: "" });

  const loadServices = useCallback(async () => {
    try {
      const data = await api.get<MCPService[]>("/api/mcp");
      setServices(data);
    } catch (e) {
      console.error("加载 MCP 服务失败:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadServices();
  }, [loadServices]);

  const handleSave = async () => {
    if (!form.name.trim() || !form.url.trim()) {
      Alert.alert("错误", "请填写服务名称和 URL");
      return;
    }

    try {
      if (editingService) {
        await api.put(`/api/mcp/${editingService.id}`, form);
      } else {
        await api.post("/api/mcp", form);
      }
      setShowAddModal(false);
      setEditingService(null);
      setForm({ name: "", url: "", description: "" });
      void loadServices();
    } catch (e) {
      Alert.alert("错误", (e as Error).message || "保存失败");
    }
  };

  const handleDelete = async (service: MCPService) => {
    Alert.alert("确认删除", `确定删除服务 "${service.name}"？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          try {
            await api.delete(`/api/mcp/${service.id}`);
            void loadServices();
          } catch (e) {
            Alert.alert("错误", (e as Error).message || "删除失败");
          }
        },
      },
    ]);
  };

  const handleToggleActive = async (service: MCPService) => {
    try {
      await api.put(`/api/mcp/${service.id}`, { isActive: !service.isActive });
      void loadServices();
    } catch (e) {
      Alert.alert("错误", (e as Error).message || "切换失败");
    }
  };

  const openEdit = (service: MCPService) => {
    setEditingService(service);
    setForm({ name: service.name, url: service.url, description: service.description || "" });
    setShowAddModal(true);
  };

  const renderService = (service: MCPService) => (
    <View key={service.id} style={styles.card}>
      <LiquidGlass blur={20} style={styles.cardGlass} />
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Ionicons name="server-outline" size={20} color={colors.primary} />
            <Text style={styles.cardTitle}>{service.name}</Text>
          </View>
          <TouchableOpacity onPress={() => handleToggleActive(service)} style={styles.toggleBtn}>
            <View style={[styles.toggleDot, service.isActive && styles.toggleDotActive]} />
          </TouchableOpacity>
        </View>
        <Text style={styles.cardUrl} numberOfLines={1}>{service.url}</Text>
        {service.description ? <Text style={styles.cardDesc}>{service.description}</Text> : null}
        <View style={styles.cardMeta}>
          <View style={styles.toolsBadge}>
            <Ionicons name="construct-outline" size={12} color={colors.primary} />
            <Text style={styles.toolsText}>{service.toolsCount} 工具</Text>
          </View>
        </View>
        <View style={styles.cardActions}>
          <TouchableOpacity onPress={() => openEdit(service)} style={styles.actionBtn}>
            <Ionicons name="pencil-outline" size={16} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleDelete(service)} style={styles.actionBtn}>
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
      <Text style={styles.header}>MCP 服务</Text>
      <Text style={styles.subheader}>管理 Model Context Protocol 工具服务</Text>

      {services.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="cube-outline" size={48} color={colors.textFaint} />
          <Text style={styles.emptyText}>暂无 MCP 服务</Text>
          <Text style={styles.emptySubtext}>点击下方按钮添加 MCP 工具服务</Text>
        </View>
      ) : (
        services.map(renderService)
      )}

      <TouchableOpacity style={styles.addBtn} onPress={() => { setEditingService(null); setForm({ name: "", url: "", description: "" }); setShowAddModal(true); }}>
        <Ionicons name="add-circle-outline" size={20} color="#fff" />
        <Text style={styles.addBtnText}>添加服务</Text>
      </TouchableOpacity>

      {showAddModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{editingService ? "编辑服务" : "添加服务"}</Text>
            <TextInput style={styles.input} placeholder="服务名称" placeholderTextColor={colors.textFaint} value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
            <TextInput style={styles.input} placeholder="URL (如 http://localhost:3000)" placeholderTextColor={colors.textFaint} value={form.url} onChangeText={(v) => setForm({ ...form, url: v })} />
            <TextInput style={styles.input} placeholder="描述 (可选)" placeholderTextColor={colors.textFaint} value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} />
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
  card: { marginBottom: spacing.md, borderRadius: radius.lg, overflow: "hidden", ...elevation.md },
  cardGlass: { ...StyleSheet.absoluteFillObject },
  cardContent: { padding: spacing.lg, position: "relative" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  cardTitle: { fontSize: fontSize.md, fontWeight: "600", color: colors.text, flex: 1 },
  cardUrl: { fontSize: fontSize.sm, color: colors.primary, marginBottom: spacing.xs },
  cardDesc: { fontSize: fontSize.sm, color: colors.textFaint, marginBottom: spacing.sm },
  cardMeta: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  toolsBadge: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: "rgba(99,102,241,0.15)", paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
  toolsText: { fontSize: fontSize.xs, fontWeight: "600", color: colors.primary },
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
  modalActions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
  modalBtnCancel: { flex: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bg, alignItems: "center" },
  modalBtnCancelText: { fontSize: fontSize.md, color: colors.text, fontWeight: "600" },
  modalBtnSave: { flex: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center" },
  modalBtnSaveText: { fontSize: fontSize.md, color: "#fff", fontWeight: "600" },
});
