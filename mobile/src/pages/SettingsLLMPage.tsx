/**
 * LLM 提供商管理页
 * GET /api/providers — 获取提供商列表
 * POST /api/providers — 添加提供商
 * PUT /api/providers/:id — 更新提供商
 * DELETE /api/providers/:id — 删除提供商
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

interface LLMProvider {
  id: string;
  name: string;
  type: string;
  apiKey?: string;
  baseUrl?: string;
  isActive: boolean;
  createdAt: string;
}

export default function SettingsLLMPage() {
  const navigation = useNavigation();
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState<LLMProvider | null>(null);
  const [form, setForm] = useState({ name: "", type: "openai", apiKey: "", baseUrl: "" });

  const loadProviders = useCallback(async () => {
    try {
      const data = await api.get<LLMProvider[]>("/providers");
      setProviders(data);
    } catch (e) {
      console.error("加载提供商失败:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadProviders();
  }, [loadProviders]);

  const handleSave = async () => {
    if (!form.name.trim()) {
      Alert.alert("错误", "请输入提供商名称");
      return;
    }

    try {
      if (editingProvider) {
        await api.put(`/providers/${editingProvider.id}`, form);
      } else {
        await api.post("/providers", form);
      }
      setShowAddModal(false);
      setEditingProvider(null);
      setForm({ name: "", type: "openai", apiKey: "", baseUrl: "" });
      void loadProviders();
    } catch (e) {
      Alert.alert("错误", (e as Error).message || "保存失败");
    }
  };

  const handleDelete = async (provider: LLMProvider) => {
    Alert.alert("确认删除", `确定删除提供商 "${provider.name}"？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          try {
            await api.delete(`/providers/${provider.id}`);
            void loadProviders();
          } catch (e) {
            Alert.alert("错误", (e as Error).message || "删除失败");
          }
        },
      },
    ]);
  };

  const handleToggleActive = async (provider: LLMProvider) => {
    try {
      await api.put(`/providers/${provider.id}`, { isActive: !provider.isActive });
      void loadProviders();
    } catch (e) {
      Alert.alert("错误", (e as Error).message || "切换失败");
    }
  };

  const openEdit = (provider: LLMProvider) => {
    setEditingProvider(provider);
    setForm({ name: provider.name, type: provider.type, apiKey: provider.apiKey || "", baseUrl: provider.baseUrl || "" });
    setShowAddModal(true);
  };

  const renderProvider = (provider: LLMProvider) => (
    <View key={provider.id} style={styles.card}>
      <LiquidGlass blur={20} style={styles.cardGlass} />
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Ionicons name="hardware-chip-outline" size={20} color={colors.primary} />
            <Text style={styles.cardTitle}>{provider.name}</Text>
          </View>
          <TouchableOpacity onPress={() => handleToggleActive(provider)} style={styles.toggleBtn}>
            <View style={[styles.toggleDot, provider.isActive && styles.toggleDotActive]} />
          </TouchableOpacity>
        </View>
        <Text style={styles.cardDesc}>类型: {provider.type.toUpperCase()}</Text>
        {provider.baseUrl ? <Text style={styles.cardDesc}>地址: {provider.baseUrl}</Text> : null}
        <View style={styles.cardActions}>
          <TouchableOpacity onPress={() => openEdit(provider)} style={styles.actionBtn}>
            <Ionicons name="pencil-outline" size={16} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleDelete(provider)} style={styles.actionBtn}>
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
      <Text style={styles.header}>LLM 提供商</Text>
      <Text style={styles.subheader}>管理 AI 模型提供商和 API 密钥</Text>

      {providers.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="cloud-outline" size={48} color={colors.textFaint} />
          <Text style={styles.emptyText}>暂无提供商</Text>
          <Text style={styles.emptySubtext}>点击下方按钮添加 LLM 提供商</Text>
        </View>
      ) : (
        providers.map(renderProvider)
      )}

      <TouchableOpacity style={styles.addBtn} onPress={() => { setEditingProvider(null); setForm({ name: "", type: "openai", apiKey: "", baseUrl: "" }); setShowAddModal(true); }}>
        <Ionicons name="add-circle-outline" size={20} color="#fff" />
        <Text style={styles.addBtnText}>添加提供商</Text>
      </TouchableOpacity>

      {showAddModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{editingProvider ? "编辑提供商" : "添加提供商"}</Text>
            <TextInput style={styles.input} placeholder="提供商名称" placeholderTextColor={colors.textFaint} value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
            <TextInput style={styles.input} placeholder="类型 (openai/anthropic/azure等)" placeholderTextColor={colors.textFaint} value={form.type} onChangeText={(v) => setForm({ ...form, type: v })} />
            <TextInput style={styles.input} placeholder="API Key" placeholderTextColor={colors.textFaint} value={form.apiKey} onChangeText={(v) => setForm({ ...form, apiKey: v })} secureTextEntry />
            <TextInput style={styles.input} placeholder="Base URL (可选)" placeholderTextColor={colors.textFaint} value={form.baseUrl} onChangeText={(v) => setForm({ ...form, baseUrl: v })} />
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
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { fontSize: fontSize.md, fontWeight: "600", color: colors.text },
  cardDesc: { fontSize: fontSize.sm, color: colors.textFaint, marginBottom: spacing.xs },
  cardActions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
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
