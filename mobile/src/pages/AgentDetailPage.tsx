/**
 * 智能体详情页
 * 查看和编辑智能体配置
 */
import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useTaskStore } from "../store/taskStore";
import { api } from "../services/api";
import { colors, spacing, radius, fontSize , ms } from "../theme";

interface AgentFormData {
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}

export default function AgentDetailPage() {
  const route = useRoute<any>();
  const navigation = useNavigation();
  const { agents, setAgents } = useTaskStore();
  const agentId = route.params?.agentId;
  const agent = agents?.find((a: any) => a.id === agentId);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<AgentFormData>({
    name: "", description: "", model: "", systemPrompt: "", temperature: 0.7, maxTokens: 4096,
  });

  useEffect(() => {
    if (agent) {
      setForm({
        name: agent.name || "",
        description: agent.description || "",
        model: agent.model || "",
        systemPrompt: agent.systemPrompt || "",
        temperature: agent.temperature ?? 0.7,
        maxTokens: agent.maxTokens ?? 4096,
      });
    }
  }, [agent]);

  const handleSave = async () => {
    if (!agent) return;
    setSaving(true);
    try {
      const result = await api.updateAgent(agent.id, form);
      if (result.data) {
        setAgents(agents.map((a: any) => a.id === agent.id ? { ...a, ...form } : a));
        setEditing(false);
        Alert.alert("成功", "智能体已更新");
      } else {
        Alert.alert("错误", result.error || "更新失败");
      }
    } catch (e) {
      Alert.alert("错误", String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!agent) return;
    Alert.alert("确认删除", `确定删除智能体「${agent.name || agent.id}」？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除", style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            const result = await api.deleteAgent(agent.id);
            if (result.data !== undefined) {
              setAgents(agents.filter((a: any) => a.id !== agent.id));
              navigation.goBack();
            } else {
              Alert.alert("错误", result.error || "删除失败");
            }
          } catch (e) {
            Alert.alert("错误", String(e));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  if (!agent) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>智能体不存在</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* 头部信息 */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Ionicons name="hardware-chip" size={32} color={colors.primary} />
        </View>
        <Text style={styles.name}>{agent.name || agent.id}</Text>
        <Text style={styles.desc}>{agent.description || "智能体"}</Text>
      </View>

      {/* 操作按钮 */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.editBtn}
          onPress={() => setEditing(!editing)}
        >
          <Ionicons name={editing ? "close" : "create-outline"} size={20} color={colors.primary} />
          <Text style={styles.editBtnText}>{editing ? "取消" : "编辑"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={handleDelete}
          disabled={deleting}
        >
          {deleting ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : (
            <>
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
              <Text style={styles.deleteBtnText}>删除</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* 详情/编辑表单 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>基本信息</Text>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>名称</Text>
          {editing ? (
            <TextInput
              style={styles.input}
              value={form.name}
              onChangeText={(t) => setForm({ ...form, name: t })}
            />
          ) : (
            <Text style={styles.fieldValue}>{agent.name || "-"}</Text>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>描述</Text>
          {editing ? (
            <TextInput
              style={[styles.input, styles.textArea]}
              value={form.description}
              onChangeText={(t) => setForm({ ...form, description: t })}
              multiline
            />
          ) : (
            <Text style={styles.fieldValue}>{agent.description || "-"}</Text>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>模型</Text>
          {editing ? (
            <TextInput
              style={styles.input}
              value={form.model}
              onChangeText={(t) => setForm({ ...form, model: t })}
            />
          ) : (
            <Text style={styles.fieldValue}>{agent.model || "-"}</Text>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>系统提示词</Text>
          {editing ? (
            <TextInput
              style={[styles.input, styles.textArea]}
              value={form.systemPrompt}
              onChangeText={(t) => setForm({ ...form, systemPrompt: t })}
              multiline
            />
          ) : (
            <Text style={styles.fieldValue}>{agent.systemPrompt || "-"}</Text>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Temperature</Text>
          {editing ? (
            <TextInput
              style={styles.input}
              value={String(form.temperature)}
              onChangeText={(t) => setForm({ ...form, temperature: parseFloat(t) || 0.7 })}
              keyboardType="numeric"
            />
          ) : (
            <Text style={styles.fieldValue}>{agent.temperature ?? 0.7}</Text>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Max Tokens</Text>
          {editing ? (
            <TextInput
              style={styles.input}
              value={String(form.maxTokens)}
              onChangeText={(t) => setForm({ ...form, maxTokens: parseInt(t) || 4096 })}
              keyboardType="numeric"
            />
          ) : (
            <Text style={styles.fieldValue}>{agent.maxTokens ?? 4096}</Text>
          )}
        </View>
      </View>

      {/* 保存按钮 */}
      {editing && (
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.5 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.saveBtnText}>保存修改</Text>
          )}
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = ms({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  errorText: { color: colors.textMuted, fontSize: fontSize.md },
  header: { alignItems: "center", paddingVertical: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.border },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  name: { color: colors.text, fontSize: fontSize.xl, fontWeight: "700" },
  desc: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: spacing.xs },
  actions: { flexDirection: "row", justifyContent: "center", gap: spacing.lg, paddingVertical: spacing.lg },
  editBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full, borderWidth: 1, borderColor: colors.primary },
  editBtnText: { color: colors.primary, fontSize: fontSize.sm, fontWeight: "600" },
  deleteBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full, borderWidth: 1, borderColor: colors.danger },
  deleteBtnText: { color: colors.danger, fontSize: fontSize.sm, fontWeight: "600" },
  section: { paddingHorizontal: spacing.lg },
  sectionTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: "700", marginBottom: spacing.lg },
  field: { marginBottom: spacing.lg },
  fieldLabel: { color: colors.textMuted, fontSize: fontSize.sm, marginBottom: spacing.xs },
  fieldValue: { color: colors.text, fontSize: fontSize.md },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, color: colors.text, fontSize: fontSize.md, borderWidth: 1, borderColor: colors.border },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  saveBtn: { backgroundColor: colors.primary, borderRadius: radius.full, padding: spacing.md, alignItems: "center", marginHorizontal: spacing.lg, marginVertical: spacing.xl },
  saveBtnText: { color: colors.white, fontSize: fontSize.md, fontWeight: "600" },
});
