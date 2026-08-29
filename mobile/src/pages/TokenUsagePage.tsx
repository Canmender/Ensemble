/**
 * Token 用量统计页
 * GET /api/tokens/stats — 获取 Token 用量统计
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../services/api";
import { colors, spacing, radius, fontSize, elevation } from "../theme";
import { LiquidGlass } from "../components/Glass";

interface TokenStats {
  total: { input: number; output: number };
  byDay: Array<{ day: string; input: number; output: number }>;
  byAgent: Array<{ agentId: string; agentName: string; input: number; output: number }>;
  runCount: number;
}

const CHART_COLORS = [
  "#6366f1", "#22c55e", "#f59e0b", "#ef4444",
  "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16",
];

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function TokenUsagePage() {
  const [stats, setStats] = useState<TokenStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const data = await api.get<TokenStats>("/tokens/stats");
      setStats(data);
      setError(null);
    } catch (e) {
      console.error("加载 Token 用量失败:", e);
      setError("加载失败：" + (e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadStats();
  }, [loadStats]);

  const grandTotal = stats ? stats.total.input + stats.total.output : 0;
  const screenW = Dimensions.get("window").width;
  const chartW = screenW - spacing.lg * 2 - spacing.md * 2;
  const maxDaily = stats ? Math.max(...stats.byDay.map((d) => d.input + d.output), 1) : 1;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.danger} />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={loadStats}>
          <Text style={styles.retryBtnText}>重试</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!stats || grandTotal === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="bar-chart-outline" size={48} color={colors.textFaint} />
        <Text style={styles.emptyText}>暂无用量数据</Text>
        <Text style={styles.emptySubtext}>运行 Agent 任务后，这里会展示 Token 消耗</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Text style={styles.header}>Token 用量</Text>
      <Text style={styles.subheader}>各 Agent 的 LLM 调用消耗统计</Text>

      {/* 汇总卡片 */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <LiquidGlass blur={20} style={styles.summaryGlass} />
          <View style={styles.summaryContent}>
            <Ionicons name="arrow-down-outline" size={16} color={colors.primary} />
            <Text style={styles.summaryLabel}>输入</Text>
            <Text style={styles.summaryValue}>{fmt(stats.total.input)}</Text>
          </View>
        </View>
        <View style={styles.summaryCard}>
          <LiquidGlass blur={20} style={styles.summaryGlass} />
          <View style={styles.summaryContent}>
            <Ionicons name="arrow-up-outline" size={16} color={colors.success} />
            <Text style={styles.summaryLabel}>输出</Text>
            <Text style={styles.summaryValue}>{fmt(stats.total.output)}</Text>
          </View>
        </View>
        <View style={styles.summaryCard}>
          <LiquidGlass blur={20} style={styles.summaryGlass} />
          <View style={styles.summaryContent}>
            <Ionicons name="flash-outline" size={16} color={colors.warning} />
            <Text style={styles.summaryLabel}>总计</Text>
            <Text style={[styles.summaryValue, styles.summaryValueHighlight]}>{fmt(grandTotal)}</Text>
          </View>
        </View>
      </View>

      {/* 按 Agent 占比 */}
      <View style={styles.sectionCard}>
        <LiquidGlass blur={20} style={styles.sectionGlass} />
        <View style={styles.sectionContent}>
          <Text style={styles.sectionTitle}>按 Agent 占比</Text>
          {stats.byAgent.map((agent, idx) => {
            const total = agent.input + agent.output;
            const pct = grandTotal > 0 ? (total / grandTotal) * 100 : 0;
            return (
              <View key={agent.agentId} style={styles.agentRow}>
                <View style={[styles.agentColor, { backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }]} />
                <Text style={styles.agentName} numberOfLines={1}>{agent.agentName}</Text>
                <View style={styles.agentBarContainer}>
                  <View style={[styles.agentBar, { width: `${pct}%`, backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }]} />
                </View>
                <Text style={styles.agentValue}>{fmt(total)}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* 按日趋势（简易柱状图） */}
      <View style={styles.sectionCard}>
        <LiquidGlass blur={20} style={styles.sectionGlass} />
        <View style={styles.sectionContent}>
          <Text style={styles.sectionTitle}>按日趋势</Text>
          <View style={styles.chartContainer}>
            {stats.byDay.slice(-7).map((day, idx) => {
              const total = day.input + day.output;
              const barHeight = maxDaily > 0 ? (total / maxDaily) * 100 : 0;
              return (
                <View key={day.day} style={styles.chartBarWrapper}>
                  <View style={styles.chartBarContainer}>
                    <View style={[styles.chartBar, { height: `${barHeight}%` }]} />
                  </View>
                  <Text style={styles.chartBarLabel}>{day.day.slice(5)}</Text>
                </View>
              );
            })}
          </View>
        </View>
      </View>

      {/* 明细表 */}
      <View style={styles.sectionCard}>
        <LiquidGlass blur={20} style={styles.sectionGlass} />
        <View style={styles.sectionContent}>
          <Text style={styles.sectionTitle}>明细</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableCell, styles.tableCellName]}>Agent</Text>
            <Text style={[styles.tableCell, styles.tableCellNum]}>输入</Text>
            <Text style={[styles.tableCell, styles.tableCellNum]}>输出</Text>
            <Text style={[styles.tableCell, styles.tableCellNum]}>合计</Text>
          </View>
          {stats.byAgent.map((agent) => (
            <View key={agent.agentId} style={styles.tableRow}>
              <Text style={[styles.tableCell, styles.tableCellName]} numberOfLines={1}>{agent.agentName}</Text>
              <Text style={[styles.tableCell, styles.tableCellNum]}>{agent.input.toLocaleString()}</Text>
              <Text style={[styles.tableCell, styles.tableCellNum]}>{agent.output.toLocaleString()}</Text>
              <Text style={[styles.tableCell, styles.tableCellNum, styles.tableCellBold]}>{(agent.input + agent.output).toLocaleString()}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  contentContainer: { padding: spacing.lg, paddingBottom: 100 },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.bg },
  errorContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.bg, padding: spacing.xl },
  errorText: { fontSize: fontSize.md, color: colors.danger, marginTop: spacing.md, textAlign: "center" },
  retryBtn: { marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md },
  retryBtnText: { fontSize: fontSize.md, fontWeight: "600", color: "#fff" },
  emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.bg, padding: spacing.xl },
  emptyText: { fontSize: fontSize.md, color: colors.textFaint, marginTop: spacing.md },
  emptySubtext: { fontSize: fontSize.sm, color: colors.textFaint, marginTop: spacing.xs },
  header: { fontSize: fontSize.xl, fontWeight: "700", color: colors.text, marginBottom: spacing.xs },
  subheader: { fontSize: fontSize.sm, color: colors.textFaint, marginBottom: spacing.lg },
  summaryRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg },
  summaryCard: { flex: 1, borderRadius: radius.lg, overflow: "hidden", ...elevation.md },
  summaryGlass: { ...StyleSheet.absoluteFillObject },
  summaryContent: { padding: spacing.md, alignItems: "center", position: "relative" },
  summaryLabel: { fontSize: fontSize.xs, color: colors.textFaint, marginTop: spacing.xs },
  summaryValue: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text, marginTop: spacing.xs },
  summaryValueHighlight: { color: colors.primary },
  sectionCard: { marginBottom: spacing.lg, borderRadius: radius.lg, overflow: "hidden", ...elevation.md },
  sectionGlass: { ...StyleSheet.absoluteFillObject },
  sectionContent: { padding: spacing.lg, position: "relative" },
  sectionTitle: { fontSize: fontSize.md, fontWeight: "600", color: colors.text, marginBottom: spacing.md },
  agentRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm },
  agentColor: { width: 12, height: 12, borderRadius: 6, marginRight: spacing.sm },
  agentName: { fontSize: fontSize.sm, color: colors.text, width: 80 },
  agentBarContainer: { flex: 1, height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: "hidden", marginHorizontal: spacing.sm },
  agentBar: { height: "100%", borderRadius: 4 },
  agentValue: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text, width: 60, textAlign: "right" },
  chartContainer: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 120 },
  chartBarWrapper: { flex: 1, alignItems: "center" },
  chartBarContainer: { width: "60%", height: 100, justifyContent: "flex-end" },
  chartBar: { width: "100%", backgroundColor: colors.primary, borderRadius: 4 },
  chartBarLabel: { fontSize: 10, color: colors.textFaint, marginTop: spacing.xs },
  tableHeader: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.sm, marginBottom: spacing.sm },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.sm },
  tableCell: { fontSize: fontSize.sm, color: colors.text },
  tableCellName: { flex: 2 },
  tableCellNum: { flex: 1, textAlign: "right" },
  tableCellBold: { fontWeight: "600" },
});
