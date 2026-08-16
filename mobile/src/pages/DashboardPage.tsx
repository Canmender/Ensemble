/**
 * Dashboard page
 * Task stats, connection status, connection quality indicator, sync info.
 */

import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { useDeviceStore } from "../store/deviceStore";
import { useTaskStore } from "../store/taskStore";
import { connectionService } from "../services/connection";
import { api } from "../services/api";
import { colors, radius, elevation } from "../theme";

type ConnectionQuality = "excellent" | "good" | "poor" | "unknown";

export default function DashboardPage({ navigation }: { navigation: any }) {
  const { connectedDevice, connectionState } =
    useDeviceStore();
  const { tasks, runs, loading, lastSyncTs, setTasks, setRuns, setAgents } =
    useTaskStore();
  const [refreshing, setRefreshing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [connectionQuality, setConnectionQuality] =
    useState<ConnectionQuality>("unknown");
  const lastPingTime = useRef<number | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stats = {
    totalTasks: tasks.length,
    runningRuns: runs.filter((r) => r.status === "running").length,
    completedRuns: runs.filter((r) => r.status === "success").length,
    errorRuns: runs.filter((r) => r.status === "error").length,
  };

  // 应用启动时已自动连接云端服务器（connectionService.connectToCloud，见 App.tsx）

  /** Fetch data via REST API */
  const fetchData = useCallback(async () => {
    const isConnected = connectionState === "connected";
    if (!isConnected) return;

    try {
      const [tasksRes, runsRes, agentsRes] = await Promise.all([
        api.getTasks(),
        api.getRuns(),
        api.getAgents(),
      ]);

      if (tasksRes.data) setTasks(tasksRes.data);
      if (runsRes.data) setRuns(runsRes.data);
      if (agentsRes.data) setAgents(agentsRes.data);
    } catch (err) {
      console.error("[DashboardPage] Fetch data failed:", err);
    }
  }, [connectionState, setTasks, setRuns, setAgents]);

  /** Measure connection quality via health endpoint */
  const measureConnectionQuality = useCallback(async () => {
    if (connectionState !== "connected" || !connectedDevice) {
      setConnectionQuality("unknown");
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const start = Date.now();
      const response = await fetch(
        `http://${connectedDevice.ip}:${connectedDevice.httpPort}/api/health`,
        { method: "GET", signal: controller.signal }
      );
      clearTimeout(timeoutId);
      const latency = Date.now() - start;

      if (!response.ok) {
        setConnectionQuality("poor");
      } else if (latency < 100) {
        setConnectionQuality("excellent");
      } else if (latency < 500) {
        setConnectionQuality("good");
      } else {
        setConnectionQuality("poor");
      }
      lastPingTime.current = latency;
    } catch {
      setConnectionQuality("poor");
      lastPingTime.current = null;
    }
  }, [connectionState, connectedDevice]);

  // Periodically measure connection quality when connected
  useEffect(() => {
    if (connectionState === "connected") {
      measureConnectionQuality();
      pingIntervalRef.current = setInterval(measureConnectionQuality, 30000);
    } else {
      setConnectionQuality("unknown");
      lastPingTime.current = null;
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
    }
    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
    };
  }, [connectionState, measureConnectionQuality]);

  /** Pull-to-refresh with error handling */
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setSyncError(null);
    try {
      connectionService.requestSync(lastSyncTs || undefined);
      await fetchData();
      await measureConnectionQuality();
    } catch (err) {
      setSyncError(
        err instanceof Error ? err.message : "同步失败，请检查连接"
      );
    }
    setTimeout(() => setRefreshing(false), 500);
  }, [fetchData, lastSyncTs, measureConnectionQuality]);

  const getStatusColor = () => {
    switch (connectionState) {
      case "connected":
        return colors.primary;
      case "connecting":
      case "reconnecting":
        return colors.warning;
      case "error":
        return colors.danger;
      default:
        return colors.textFaint;
    }
  };

  const getStatusText = () => {
    switch (connectionState) {
      case "connected":
        return `已连接: ${connectedDevice?.name || "未知设备"}`;
      case "connecting":
        return "连接中...";
      case "reconnecting":
        return "重连中...";
      case "error":
        return "连接失败";
      default:
        return "未连接";
    }
  };

  const getQualityColor = (quality: ConnectionQuality) => {
    switch (quality) {
      case "excellent":
        return colors.primary;
      case "good":
        return colors.warning;
      case "poor":
        return colors.danger;
      default:
        return colors.textFaint;
    }
  };

  const getQualityText = (quality: ConnectionQuality) => {
    switch (quality) {
      case "excellent":
        return "优秀";
      case "good":
        return "良好";
      case "poor":
        return "较差";
      default:
        return "未知";
    }
  };

  /** Format relative time for last sync */
  const formatSyncTime = (ts: number | null) => {
    if (!ts) return "从未同步";
    const diff = Date.now() - ts;
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return new Date(ts).toLocaleDateString();
  };

  const navigateToRun = (taskId: string) => {
    const taskRuns = runs.filter((r) => r.taskId === taskId);
    const latestRun = taskRuns[0];
    if (latestRun) {
      navigation.navigate("Run", { runId: latestRun.id });
    }
  };

  const getRunStatusColor = (status: string) => {
    switch (status) {
      case "success":
        return colors.primary;
      case "running":
        return colors.warning;
      case "error":
        return colors.danger;
      case "cancelled":
        return colors.textFaint;
      case "queued":
        return colors.accent;
      default:
        return colors.border;
    }
  };

  const getRunStatusText = (status: string) => {
    switch (status) {
      case "success":
        return "已完成";
      case "running":
        return "运行中";
      case "error":
        return "错误";
      case "cancelled":
        return "已取消";
      case "queued":
        return "排队中";
      default:
        return status;
    }
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      {/* Connection status */}
      <View style={styles.statusCard}>
        <View style={styles.statusHeader}>
          <View
            style={[styles.statusDot, { backgroundColor: getStatusColor() }]}
          />
          <Text style={styles.statusText}>{getStatusText()}</Text>
        </View>

        {/* Connection quality indicator */}
        {connectionState === "connected" && (
          <View style={styles.qualityRow}>
            <View
              style={[
                styles.qualityDot,
                { backgroundColor: getQualityColor(connectionQuality) },
              ]}
            />
            <Text style={styles.qualityText}>
              连接质量: {getQualityText(connectionQuality)}
              {lastPingTime.current !== null && ` (${lastPingTime.current}ms)`}
            </Text>
          </View>
        )}

        {/* Sync info */}
        <View style={styles.syncRow}>
          <Text style={styles.syncLabel}>最后同步:</Text>
          <Text style={styles.syncValue}>{formatSyncTime(lastSyncTs)}</Text>
        </View>

        {/* Sync error */}
        {syncError && (
          <View style={styles.syncErrorRow}>
            <Text style={styles.syncErrorText}>{syncError}</Text>
          </View>
        )}
      </View>

      {/* Stats */}
      <View style={styles.statsContainer}>
        <View style={[styles.statCard, { backgroundColor: "rgba(59,63,74,0.12)" }]}>
          <Text style={styles.statNumber}>{stats.totalTasks}</Text>
          <Text style={styles.statLabel}>总任务</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: "rgba(95,122,90,0.12)" }]}>
          <Text style={styles.statNumber}>{stats.runningRuns}</Text>
          <Text style={styles.statLabel}>进行中</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: "rgba(95,122,90,0.12)" }]}>
          <Text style={styles.statNumber}>{stats.completedRuns}</Text>
          <Text style={styles.statLabel}>已完成</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: "rgba(176,80,56,0.12)" }]}>
          <Text style={styles.statNumber}>{stats.errorRuns}</Text>
          <Text style={styles.statLabel}>错误</Text>
        </View>
      </View>

      {/* Recent tasks */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>最近任务</Text>
        {tasks.length === 0 ? (
          <Text style={styles.emptyText}>暂无任务</Text>
        ) : (
          tasks.slice(0, 5).map((task) => {
            const taskRuns = runs.filter((r) => r.taskId === task.id);
            const latestRun = taskRuns[0];
            const hasRun = !!latestRun;

            return (
              <TouchableOpacity
                key={task.id}
                style={[
                  styles.taskCard,
                  hasRun && styles.taskCardTouchable,
                ]}
                onPress={() => hasRun && navigateToRun(task.id)}
                activeOpacity={hasRun ? 0.7 : 1}
              >
                <View style={styles.taskHeader}>
                  <Text style={styles.taskTitle}>{task.title}</Text>
                  <Text style={styles.taskMode}>{task.mode}</Text>
                </View>
                {latestRun && (
                  <View style={styles.taskStatus}>
                    <View
                      style={[
                        styles.statusBadge,
                        {
                          backgroundColor: getRunStatusColor(latestRun.status),
                        },
                      ]}
                    />
                    <Text style={styles.taskStatusText}>
                      {getRunStatusText(latestRun.status)}
                    </Text>
                    {latestRun.status === "running" && (
                      <Text style={styles.runningIndicator}>
                        {" "}
                        (实时更新中)
                      </Text>
                    )}
                  </View>
                )}
                <View style={styles.taskFooter}>
                  <Text style={styles.taskTime}>
                    {new Date(task.createdAt).toLocaleString()}
                  </Text>
                  {hasRun && (
                    <Text style={styles.viewDetail}>查看详情</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </View>

      {/* Bottom spacing */}
      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 16,
  },
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 16,
    ...elevation.sm,
  },
  statusHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  statusText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "500",
  },
  qualityRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  qualityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  qualityText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  syncRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  syncLabel: {
    color: colors.textFaint,
    fontSize: 12,
    marginRight: 4,
  },
  syncValue: {
    color: colors.textMuted,
    fontSize: 12,
  },
  syncErrorRow: {
    marginTop: 8,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderRadius: 6,
    padding: 8,
  },
  syncErrorText: {
    color: "#B05038",
    fontSize: 12,
  },
  deviceList: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  deviceListTitle: {
    color: colors.textMuted,
    fontSize: 14,
    marginBottom: 8,
  },
  deviceItem: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  deviceName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "500",
  },
  deviceIp: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  statsContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    borderRadius: radius.lg,
    padding: 16,
    marginHorizontal: 4,
    alignItems: "center",
    ...elevation.sm,
  },
  statNumber: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "bold",
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  emptyText: {
    color: colors.textFaint,
    textAlign: "center",
    padding: 20,
  },
  taskCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 8,
    ...elevation.sm,
  },
  taskCardTouchable: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  taskHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  taskTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
  },
  taskMode: {
    color: colors.textMuted,
    fontSize: 12,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  taskStatus: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  statusBadge: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  taskStatusText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  runningIndicator: {
    color: colors.warning,
    fontSize: 11,
    fontStyle: "italic",
  },
  taskFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
  },
  taskTime: {
    color: colors.textFaint,
    fontSize: 11,
  },
  viewDetail: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "500",
  },
  syncText: {
    color: colors.textFaint,
    fontSize: 12,
    textAlign: "center",
    marginTop: 8,
  },
});
