/**
 * Agent management page
 * View, create, edit, delete Agents with proper error handling.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
} from "react-native";
import { useTaskStore } from "../store/taskStore";
import { useDeviceStore } from "../store/deviceStore";
import { api } from "../services/api";
import type { AgentConfig } from "@ensemble/shared-protocol";

interface AgentFormData {
  name: string;
  kind: "builtin" | "local";
  description: string;
  providerId: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxIterations: number;
  tools: string[];
  enabled: boolean;
}

const defaultFormData: AgentFormData = {
  name: "",
  kind: "builtin",
  description: "",
  providerId: "",
  model: "",
  systemPrompt: "You are a helpful assistant.",
  temperature: 0.7,
  maxIterations: 10,
  tools: [],
  enabled: true,
};

const AVAILABLE_TOOLS = [
  "read_file",
  "write_file",
  "execute_command",
  "web_search",
  "web_fetch",
  "memory_write",
  "memory_read",
  "memory_list",
];

export default function AgentsPage() {
  const { agents, setAgents } = useTaskStore();
  const { connectionState } = useDeviceStore();
  const isConnected = connectionState === "connected";

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const [formData, setFormData] = useState<AgentFormData>(defaultFormData);
  const [providers, setProviders] = useState<any[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load agents
  const loadAgents = useCallback(async () => {
    if (!isConnected) return;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await api.getAgents();
      if (result.error) {
        setLoadError(result.error);
      } else if (result.data) {
        setAgents(result.data);
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "加载 Agent 列表失败"
      );
    } finally {
      setLoading(false);
    }
  }, [isConnected, setAgents]);

  // Load providers
  const loadProviders = useCallback(async () => {
    if (!isConnected) return;
    try {
      const result = await api.getProviders();
      if (result.data) {
        setProviders(result.data);
      }
    } catch (err) {
      console.error("[AgentsPage] Failed to load providers:", err);
    }
  }, [isConnected]);

  useEffect(() => {
    loadAgents();
    loadProviders();
  }, [loadAgents, loadProviders]);

  const handleCreate = () => {
    setEditingAgent(null);
    setFormData(defaultFormData);
    setShowModal(true);
  };

  const handleEdit = (agent: AgentConfig) => {
    setEditingAgent(agent);
    setFormData({
      name: agent.name,
      kind: agent.kind,
      description: agent.description || "",
      providerId: agent.providerId || "",
      model: agent.model || "",
      systemPrompt: agent.systemPrompt || "",
      temperature: agent.temperature || 0.7,
      maxIterations: agent.maxIterations || 10,
      tools: agent.tools || [],
      enabled: agent.enabled,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      Alert.alert("错误", "请输入 Agent 名称");
      return;
    }

    setSaving(true);
    try {
      let result;
      if (editingAgent) {
        result = await api.updateAgent(editingAgent.id, formData);
      } else {
        result = await api.createAgent({
          ...formData,
          id: `agent-${Date.now()}`,
        });
      }

      if (result.error) {
        Alert.alert("保存失败", result.error);
      } else {
        setShowModal(false);
        Alert.alert("成功", editingAgent ? "Agent 已更新" : "Agent 已创建");
        loadAgents();
      }
    } catch (err) {
      Alert.alert(
        "保存失败",
        err instanceof Error ? err.message : "网络错误，请检查连接"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (agent: AgentConfig) => {
    Alert.alert("确认删除", `确定要删除 Agent "${agent.name}" 吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          setDeleting(agent.id);
          try {
            const result = await api.deleteAgent(agent.id);
            if (result.error) {
              Alert.alert("删除失败", result.error);
            } else {
              Alert.alert("成功", "Agent 已删除");
              loadAgents();
            }
          } catch (err) {
            Alert.alert(
              "删除失败",
              err instanceof Error ? err.message : "网络错误，请检查连接"
            );
          } finally {
            setDeleting(null);
          }
        },
      },
    ]);
  };

  const toggleTool = (tool: string) => {
    setFormData((prev) => ({
      ...prev,
      tools: prev.tools.includes(tool)
        ? prev.tools.filter((t) => t !== tool)
        : [...prev.tools, tool],
    }));
  };

  const getAgentIcon = (kind: string) => {
    switch (kind) {
      case "builtin":
        return "\u{1F916}";
      case "local":
        return "\u{1F4BB}";
      default:
        return "\u{1F527}";
    }
  };

  const renderAgentItem = ({ item }: { item: AgentConfig }) => (
    <TouchableOpacity
      style={styles.agentItem}
      onPress={() => handleEdit(item)}
      onLongPress={() => handleDelete(item)}
      disabled={deleting === item.id}
    >
      <View style={styles.agentHeader}>
        <Text style={styles.agentIcon}>{getAgentIcon(item.kind)}</Text>
        <View style={styles.agentInfo}>
          <Text style={styles.agentName}>{item.name}</Text>
          <Text style={styles.agentKind}>
            {item.kind === "builtin" ? "内置 Agent" : "本地 Agent"}
          </Text>
        </View>
        {deleting === item.id ? (
          <ActivityIndicator size="small" color="#ef4444" />
        ) : (
          <View
            style={[
              styles.statusDot,
              { backgroundColor: item.enabled ? "#10b981" : "#6b7280" },
            ]}
          />
        )}
      </View>

      {item.description && (
        <Text style={styles.agentDescription} numberOfLines={2}>
          {item.description}
        </Text>
      )}

      <View style={styles.agentMeta}>
        <Text style={styles.agentModel}>{item.model || "未配置模型"}</Text>
        <Text style={styles.agentProvider}>
          {item.providerId || "未配置提供商"}
        </Text>
      </View>

      <View style={styles.agentTools}>
        {item.tools.slice(0, 3).map((tool, index) => (
          <View key={index} style={styles.toolBadge}>
            <Text style={styles.toolText}>{tool}</Text>
          </View>
        ))}
        {item.tools.length > 3 && (
          <Text style={styles.moreTools}>+{item.tools.length - 3}</Text>
        )}
      </View>
    </TouchableOpacity>
  );

  const renderFormModal = () => (
    <Modal
      visible={showModal}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShowModal(false)}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => setShowModal(false)}>
            <Text style={styles.modalCancel}>取消</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>
            {editingAgent ? "编辑 Agent" : "创建 Agent"}
          </Text>
          <TouchableOpacity onPress={handleSave} disabled={saving}>
            {saving ? (
              <ActivityIndicator size="small" color="#10b981" />
            ) : (
              <Text style={[styles.modalSave, saving && styles.modalSaveDisabled]}>
                保存
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalContent}>
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>名称 *</Text>
            <TextInput
              style={styles.formInput}
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
              placeholder="输入 Agent 名称"
              placeholderTextColor="#6b7280"
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>类型</Text>
            <View style={styles.kindSelector}>
              <TouchableOpacity
                style={[
                  styles.kindOption,
                  formData.kind === "builtin" && styles.kindOptionActive,
                ]}
                onPress={() => setFormData({ ...formData, kind: "builtin" })}
              >
                <Text
                  style={[
                    styles.kindText,
                    formData.kind === "builtin" && styles.kindTextActive,
                  ]}
                >
                  内置
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.kindOption,
                  formData.kind === "local" && styles.kindOptionActive,
                ]}
                onPress={() => setFormData({ ...formData, kind: "local" })}
              >
                <Text
                  style={[
                    styles.kindText,
                    formData.kind === "local" && styles.kindTextActive,
                  ]}
                >
                  本地
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>描述</Text>
            <TextInput
              style={[styles.formInput, styles.formTextarea]}
              value={formData.description}
              onChangeText={(text) =>
                setFormData({ ...formData, description: text })
              }
              placeholder="Agent 描述"
              placeholderTextColor="#6b7280"
              multiline
              numberOfLines={3}
            />
          </View>

          {formData.kind === "builtin" && (
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Provider</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {providers.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[
                      styles.providerOption,
                      formData.providerId === p.id &&
                        styles.providerOptionActive,
                    ]}
                    onPress={() =>
                      setFormData({ ...formData, providerId: p.id })
                    }
                  >
                    <Text
                      style={[
                        styles.providerText,
                        formData.providerId === p.id &&
                          styles.providerTextActive,
                      ]}
                    >
                      {p.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {formData.kind === "builtin" && (
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>模型</Text>
              <TextInput
                style={styles.formInput}
                value={formData.model}
                onChangeText={(text) =>
                  setFormData({ ...formData, model: text })
                }
                placeholder="例如: claude-sonnet-4-20250514"
                placeholderTextColor="#6b7280"
              />
            </View>
          )}

          {formData.kind === "builtin" && (
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>System Prompt</Text>
              <TextInput
                style={[styles.formInput, styles.formTextarea]}
                value={formData.systemPrompt}
                onChangeText={(text) =>
                  setFormData({ ...formData, systemPrompt: text })
                }
                placeholder="系统提示词"
                placeholderTextColor="#6b7280"
                multiline
                numberOfLines={4}
              />
            </View>
          )}

          {formData.kind === "builtin" && (
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>
                Temperature: {formData.temperature.toFixed(1)}
              </Text>
              <View style={styles.sliderContainer}>
                <Text style={styles.sliderLabel}>精确</Text>
                <View style={styles.sliderTrack}>
                  <TouchableOpacity
                    style={[
                      styles.sliderThumb,
                      { left: `${formData.temperature * 100}%` },
                    ]}
                  />
                </View>
                <Text style={styles.sliderLabel}>创意</Text>
              </View>
            </View>
          )}

          {formData.kind === "builtin" && (
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>工具</Text>
              <View style={styles.toolsGrid}>
                {AVAILABLE_TOOLS.map((tool) => (
                  <TouchableOpacity
                    key={tool}
                    style={[
                      styles.toolChip,
                      formData.tools.includes(tool) && styles.toolChipActive,
                    ]}
                    onPress={() => toggleTool(tool)}
                  >
                    <Text
                      style={[
                        styles.toolChipText,
                        formData.tools.includes(tool) &&
                          styles.toolChipTextActive,
                      ]}
                    >
                      {tool}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          <View style={styles.formGroup}>
            <View style={styles.switchRow}>
              <Text style={styles.formLabel}>启用</Text>
              <Switch
                value={formData.enabled}
                onValueChange={(value) =>
                  setFormData({ ...formData, enabled: value })
                }
                trackColor={{ false: "#374151", true: "#10b981" }}
                thumbColor={formData.enabled ? "#fff" : "#9ca3af"}
              />
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Agent 管理</Text>
          <Text style={styles.headerSubtitle}>
            {isConnected ? `${agents.length} 个 Agent` : "未连接"}
          </Text>
        </View>
        {isConnected && (
          <TouchableOpacity style={styles.addButton} onPress={handleCreate}>
            <Text style={styles.addButtonText}>+ 创建</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color="#10b981" />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      )}

      {loadError && !loading && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{loadError}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadAgents}>
            <Text style={styles.retryButtonText}>重试</Text>
          </TouchableOpacity>
        </View>
      )}

      {!isConnected ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>{"\u{1F50C}"}</Text>
          <Text style={styles.emptyText}>未连接到桌面端</Text>
          <Text style={styles.emptySubtext}>请先在设置页面连接到桌面端</Text>
        </View>
      ) : !loadError && agents.length === 0 && !loading ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>{"\u{1F916}"}</Text>
          <Text style={styles.emptyText}>暂无 Agent</Text>
          <Text style={styles.emptySubtext}>点击右上角创建第一个 Agent</Text>
        </View>
      ) : (
        !loadError && (
          <FlatList
            data={agents}
            renderItem={renderAgentItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshing={loading}
            onRefresh={loadAgents}
          />
        )
      )}

      {renderFormModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111827",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#374151",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "600",
  },
  headerSubtitle: {
    color: "#9ca3af",
    fontSize: 14,
    marginTop: 2,
  },
  addButton: {
    backgroundColor: "#10b981",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  loadingContainer: {
    padding: 16,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  loadingText: {
    color: "#9ca3af",
    fontSize: 14,
    marginLeft: 8,
  },
  errorContainer: {
    margin: 16,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
  },
  errorText: {
    color: "#ef4444",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: "#374151",
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 6,
  },
  retryButtonText: {
    color: "#10b981",
    fontSize: 14,
    fontWeight: "500",
  },
  listContent: {
    padding: 16,
  },
  agentItem: {
    backgroundColor: "#1f2937",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  agentHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  agentIcon: {
    fontSize: 32,
    marginRight: 12,
  },
  agentInfo: {
    flex: 1,
  },
  agentName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  agentKind: {
    color: "#9ca3af",
    fontSize: 12,
    marginTop: 2,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  agentDescription: {
    color: "#d1d5db",
    fontSize: 14,
    marginTop: 8,
    lineHeight: 20,
  },
  agentMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  agentModel: {
    color: "#10b981",
    fontSize: 12,
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  agentProvider: {
    color: "#6b7280",
    fontSize: 12,
  },
  agentTools: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 12,
  },
  toolBadge: {
    backgroundColor: "#374151",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 6,
    marginBottom: 6,
  },
  toolText: {
    color: "#9ca3af",
    fontSize: 11,
  },
  moreTools: {
    color: "#6b7280",
    fontSize: 11,
    alignSelf: "center",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptySubtext: {
    color: "#6b7280",
    textAlign: "center",
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "#111827",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#374151",
  },
  modalCancel: {
    color: "#9ca3af",
    fontSize: 16,
  },
  modalTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  modalSave: {
    color: "#10b981",
    fontSize: 16,
    fontWeight: "600",
  },
  modalSaveDisabled: {
    color: "#6b7280",
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  formGroup: {
    marginBottom: 20,
  },
  formLabel: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 8,
  },
  formInput: {
    backgroundColor: "#1f2937",
    borderRadius: 8,
    padding: 12,
    color: "#fff",
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#374151",
  },
  formTextarea: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  kindSelector: {
    flexDirection: "row",
    gap: 12,
  },
  kindOption: {
    flex: 1,
    backgroundColor: "#1f2937",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#374151",
  },
  kindOptionActive: {
    borderColor: "#10b981",
    backgroundColor: "rgba(16, 185, 129, 0.1)",
  },
  kindText: {
    color: "#9ca3af",
    fontSize: 14,
  },
  kindTextActive: {
    color: "#10b981",
  },
  providerOption: {
    backgroundColor: "#1f2937",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: "#374151",
  },
  providerOptionActive: {
    borderColor: "#10b981",
    backgroundColor: "rgba(16, 185, 129, 0.1)",
  },
  providerText: {
    color: "#9ca3af",
    fontSize: 14,
  },
  providerTextActive: {
    color: "#10b981",
  },
  sliderContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sliderLabel: {
    color: "#6b7280",
    fontSize: 12,
  },
  sliderTrack: {
    flex: 1,
    height: 4,
    backgroundColor: "#374151",
    borderRadius: 2,
    position: "relative",
  },
  sliderThumb: {
    position: "absolute",
    top: -8,
    width: 20,
    height: 20,
    backgroundColor: "#10b981",
    borderRadius: 10,
    marginLeft: -10,
  },
  toolsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  toolChip: {
    backgroundColor: "#1f2937",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#374151",
  },
  toolChipActive: {
    borderColor: "#10b981",
    backgroundColor: "rgba(16, 185, 129, 0.1)",
  },
  toolChipText: {
    color: "#9ca3af",
    fontSize: 12,
  },
  toolChipTextActive: {
    color: "#10b981",
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
});
