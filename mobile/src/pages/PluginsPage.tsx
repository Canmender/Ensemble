/**
 * 「功能」页（U1 演进：用户主权插件在手机端的主门面）
 *
 * 候选插件列表 + 每用户启停 Switch + 按 manifest.settings 声明渲染的配置表单
 * （与桌面 PluginsPanel 同一数据面 /api/users/me/plugins；配置内联展开而非
 * Modal——移动端单手操作更顺）。将来在此页承载市场浏览（U5）、卡片模板
 * 预览、manifest.ui 插槽入口，布局预留分组/分区空间。
 *
 * 样式走 S2 动态 token（模块级 colors Proxy + epoch 重挂载刷新 StyleSheet），
 * 暗色与全局换肤机制一致。
 */
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { api, type PluginInfo } from "../services/api";
import { colors, spacing, radius, fontSize, elevation , ms } from "../theme";

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** 配置展开中的插件 id（同时只展开一个） */
  const [configForId, setConfigForId] = useState<string | null>(null);
  const [configDraft, setConfigDraft] = useState<Record<string, string>>({});
  const [savingConfig, setSavingConfig] = useState(false);

  const refresh = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await api.getPlugins();
      if (res.data) {
        setPlugins(res.data);
        setLoadError(null);
      } else {
        setLoadError(res.error ?? "加载失败");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // 每次进入 Tab 刷新（启用状态可能因别处变更）
  useFocusEffect(
    useCallback(() => {
      void refresh(false);
    }, [refresh]),
  );

  const toggle = async (p: PluginInfo) => {
    setBusyId(p.id);
    try {
      const res = p.enabled ? await api.disablePlugin(p.id) : await api.enablePlugin(p.id);
      if (res.error) {
        setLoadError(`${p.enabled ? "禁用" : "启用"}失败：${res.error}`);
      }
      await refresh(false);
    } finally {
      setBusyId(null);
    }
  };

  const openConfig = async (p: PluginInfo) => {
    if (configForId === p.id) {
      setConfigForId(null);
      return;
    }
    setConfigForId(p.id);
    setConfigDraft({});
    const res = await api.getPluginConfig(p.id);
    const cfg = res.data ?? {};
    const draft: Record<string, string> = {};
    for (const f of p.settings ?? []) draft[f.key] = String((cfg as Record<string, unknown>)[f.key] ?? "");
    setConfigDraft(draft);
  };

  const saveConfig = async (p: PluginInfo) => {
    setSavingConfig(true);
    try {
      const res = await api.setPluginConfig(p.id, configDraft);
      if (res.error) {
        setLoadError(`保存失败：${res.error}`);
      } else {
        setConfigForId(null);
      }
      await refresh(false);
    } finally {
      setSavingConfig(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.centerText}>加载插件中…</Text>
      </View>
    );
  }

  if (loadError && plugins.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="cloud-offline-outline" size={40} color={colors.textFaint} />
        <Text style={styles.centerText}>{loadError}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => void refresh(false)}>
          <Text style={styles.retryText}>重试</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void refresh(true)} tintColor={colors.primary} colors={[colors.primary]} />
      }
    >
      {/* 主权说明（与桌面同文案语义） */}
      <View style={styles.introRow}>
        <Ionicons name="shield-checkmark-outline" size={14} color={colors.textFaint} />
        <Text style={styles.introText}>插件是你的个人资产：启用后只在你自己的作用域内运行，其他人不受影响。</Text>
      </View>

      {loadError && <Text style={styles.errorText}>{loadError}</Text>}

      {plugins.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="extension-puzzle-outline" size={44} color={colors.textFaint} />
          <Text style={styles.emptyTitle}>暂无可用功能</Text>
          <Text style={styles.emptyDesc}>服务器管理员预置的插件会出现在这里</Text>
        </View>
      ) : (
        plugins.map((p) => {
          const expanded = configForId === p.id;
          return (
            <View key={p.id} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.iconWrap}>
                  <Ionicons name="extension-puzzle" size={20} color={colors.primary} />
                </View>
                <View style={styles.cardInfo}>
                  <View style={styles.titleRow}>
                    <Text style={styles.name}>{p.name}</Text>
                    <Text style={styles.version}>v{p.version}</Text>
                    {p.scheduled > 0 && (
                      <View style={styles.badge}>
                        <Ionicons name="time-outline" size={9} color={colors.textMuted} />
                        <Text style={styles.badgeText}>定时 ×{p.scheduled}</Text>
                      </View>
                    )}
                  </View>
                  {!!p.description && <Text style={styles.desc}>{p.description}</Text>}
                </View>
                <Switch
                  value={p.enabled}
                  onValueChange={() => void toggle(p)}
                  disabled={busyId === p.id}
                  trackColor={{ false: colors.surfaceAlt, true: colors.primarySoft }}
                  thumbColor={p.enabled ? colors.primary : colors.textFaint}
                />
              </View>

              {/* 配置入口 + 表单（按 manifest.settings 声明渲染） */}
              {(p.settings?.length ?? 0) > 0 && (
                <View>
                  <TouchableOpacity style={styles.configToggle} onPress={() => void openConfig(p)}>
                    <Ionicons name="settings-outline" size={14} color={colors.textMuted} />
                    <Text style={styles.configToggleText}>配置</Text>
                    <Ionicons
                      name={expanded ? "chevron-up" : "chevron-down"}
                      size={14}
                      color={colors.textFaint}
                      style={styles.chevron}
                    />
                  </TouchableOpacity>
                  {expanded && (
                    <View style={styles.configForm}>
                      {(p.settings ?? []).map((f) => (
                        <View key={f.key} style={styles.field}>
                          <Text style={styles.fieldLabel}>{f.label}</Text>
                          <TextInput
                            style={styles.fieldInput}
                            value={configDraft[f.key] ?? ""}
                            onChangeText={(v) => setConfigDraft((d) => ({ ...d, [f.key]: v }))}
                            placeholder={f.placeholder}
                            placeholderTextColor={colors.textFaint}
                            secureTextEntry={f.type === "password"}
                            autoCapitalize="none"
                          />
                        </View>
                      ))}
                      <TouchableOpacity
                        style={[styles.saveBtn, savingConfig && styles.saveBtnBusy]}
                        onPress={() => void saveConfig(p)}
                        disabled={savingConfig}
                      >
                        {savingConfig ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.saveBtnText}>保存并生效</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = ms({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 96 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, gap: spacing.sm },
  centerText: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: spacing.xs },

  introRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs, marginBottom: spacing.md, paddingHorizontal: spacing.xs },
  introText: { flex: 1, color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 16 },

  errorText: { color: colors.danger, fontSize: fontSize.xs, marginBottom: spacing.sm },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...elevation.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  iconWrap: {
    width: 40, height: 40, borderRadius: radius.sm,
    backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center",
  },
  cardInfo: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  name: { color: colors.text, fontSize: fontSize.md, fontWeight: "700" },
  version: { color: colors.textFaint, fontSize: fontSize.xs },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 2,
    backgroundColor: colors.surfaceAlt, borderRadius: radius.full, paddingHorizontal: 6, paddingVertical: 1,
  },
  badgeText: { color: colors.textMuted, fontSize: 10 },
  desc: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: 2 },

  configToggle: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.md },
  configToggleText: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: "600" },
  chevron: { marginLeft: "auto" },
  configForm: {
    marginTop: spacing.md, paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: spacing.md,
  },
  field: { gap: spacing.xs },
  fieldLabel: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: "600" },
  fieldInput: {
    backgroundColor: colors.inputBg, borderRadius: radius.sm, paddingHorizontal: spacing.md,
    paddingVertical: 10, color: colors.text, fontSize: fontSize.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.sm, alignItems: "center",
    paddingVertical: 11, marginTop: spacing.xs,
  },
  saveBtnBusy: { opacity: 0.6 },
  saveBtnText: { color: colors.primaryFg, fontSize: fontSize.sm, fontWeight: "700" },

  emptyCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, alignItems: "center",
    paddingVertical: 48, gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  emptyTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: "700" },
  emptyDesc: { color: colors.textFaint, fontSize: fontSize.sm },

  retryBtn: {
    backgroundColor: colors.primarySoft, borderRadius: radius.full,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, marginTop: spacing.xs,
  },
  retryText: { color: colors.primary, fontSize: fontSize.sm, fontWeight: "700" },
});
