/**
 * 看板页面
 * 显示任务状态和实时更新
 */

import React, { useEffect, useState } from "react";
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
import { discoveryService } from "../services/discovery";
import { connectionService } from "../services/connection";

export default function DashboardPage() {
  const { connectedDevice, connectionState, discoveredDevices } = useDeviceStore();
  const { tasks, runs, loading, lastSyncTs } = useTaskStore();
  const [refreshing, setRefreshing] = useState(false);

  // 统计数据
  const stats = {
    totalTasks: tasks.length,
    runningRuns: runs.filter((r) => r.status === "running").length,
    completedRuns: runs.filter((r) => r.status === "success").length,
    errorRuns: runs.filter((r) => r.status === "error").length,
  };

  // 初始化扫描
  useEffect(() => {
    discoveryService.startScan();
    return () => {
      discoveryService.stopScan();
    };
  }, []);

  // 下拉刷新
  const onRefresh = async () => {
    setRefreshing(true);
    connectionService.requestSync(lastSyncTs || undefined);
    setTimeout(() => setRefreshing(false), 1000);
  };

  // 连接状态颜色
  const getStatusColor = () => {
    switch (connectionState) {
      case "connected":
        return "#10b981";
      case "connecting":
      case "reconnecting":
        return "#f59e0b";
      case "error":
        return "#ef4444";
      default:
        return "#6b7280";
    }
  };

  // 连接状态文本
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

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* 连接状态 */}
      <View style={styles.statusCard}>
        <View style={styles.statusHeader}>
          <View style={[styles.statusDot, { backgroundColor: getStatusColor() }]} />
          <Text style={styles.statusText}>{getStatusText()}</Text>
        </View>

        {connectionState === "disconnected" && discoveredDevices.length > 0 && (
          <View style={styles.deviceList}>
            <Text style={styles.deviceListTitle}>发现的设备:</Text>
            {discoveredDevices.map((device) => (
              <TouchableOpacity
                key={device.id}
                style={styles.deviceItem}
                onPress={() => {
                  connectionService.connect(device.ip, device.wsPort);
                }}
              >
                <Text style={styles.deviceName}>{device.name}</Text>
                <Text style={styles.deviceIp}>{device.ip}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* 统计卡片 */}
      <View style={styles.statsContainer}>
        <View style={[styles.statCard, { backgroundColor: "#1e3a5f" }]}>
          <Text style={styles.statNumber}>{stats.totalTasks}</Text>
          <Text style={styles.statLabel}>总任务</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: "#1e4d3f" }]}>
          <Text style={styles.statNumber}>{stats.runningRuns}</Text>
          <Text style={styles.statLabel}>进行中</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: "#3f1e4d" }]}>
          <Text style={styles.statNumber}>{stats.completedRuns}</Text>
          <Text style={styles.statLabel}>已完成</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: "#4d1e1e" }]}>
          <Text style={styles.statNumber}>{stats.errorRuns}</Text>
          <Text style={styles.statLabel}>错误</Text>
        </View>
      </View>

      {/* 最近任务 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>最近任务</Text>
        {tasks.length === 0 ? (
          <Text style={styles.emptyText}>暂无任务</Text>
        ) : (
          tasks.slice(0, 5).map((task) => {
            const taskRuns = runs.filter((r) => r.taskId === task.id);
            const latestRun = taskRuns[0];

            return (
              <View key={task.id} style={styles.taskCard}>
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
                          backgroundColor:
                            latestRun.status === "success"
                              ? "#10b981"
                              : latestRun.status === "running"
                              ? "#f59e0b"
                              : latestRun.status === "error"
                              ? "#ef4444"
                              : "#6b7280",
                        },
                      ]}
                    />
                    <Text style={styles.taskStatusText}>{latestRun.status}</Text>
                  </View>
                )}
                <Text style={styles.taskTime}>
                  {new Date(task.createdAt).toLocaleString()}
                </Text>
              </View>
            );
          })
        )}
      </View>

      {/* 同步状态 */}
      {lastSyncTs && (
        <Text style={styles.syncText}>
          最后同步: {new Date(lastSyncTs).toLocaleTimeString()}
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111827",
    padding: 16,
  },
  statusCard: {
    backgroundColor: "#1f2937",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
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
    color: "#fff",
    fontSize: 16,
    fontWeight: "500",
  },
  deviceList: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#374151",
    paddingTop: 12,
  },
  deviceListTitle: {
    color: "#9ca3af",
    fontSize: 14,
    marginBottom: 8,
  },
  deviceItem: {
    backgroundColor: "#374151",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  deviceName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
  },
  deviceIp: {
    color: "#9ca3af",
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
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 4,
    alignItems: "center",
  },
  statNumber: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "bold",
  },
  statLabel: {
    color: "#9ca3af",
    fontSize: 12,
    marginTop: 4,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  emptyText: {
    color: "#6b7280",
    textAlign: "center",
    padding: 20,
  },
  taskCard: {
    backgroundColor: "#1f2937",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  taskHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  taskTitle: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
  },
  taskMode: {
    color: "#9ca3af",
    fontSize: 12,
    backgroundColor: "#374151",
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
    color: "#9ca3af",
    fontSize: 12,
  },
  taskTime: {
    color: "#6b7280",
    fontSize: 11,
    marginTop: 4,
  },
  syncText: {
    color: "#6b7280",
    fontSize: 12,
    textAlign: "center",
    marginTop: 8,
  },
});
