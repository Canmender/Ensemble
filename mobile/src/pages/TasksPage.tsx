/**
 * Task list page
 * Create, view, cancel tasks with error handling and pull-to-refresh.
 */

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useTaskStore } from "../store/taskStore";
import { useDeviceStore } from "../store/deviceStore";
import { connectionService } from "../services/connection";
import type { TaskMode } from "@ensemble/shared-protocol";
import { colors } from "../theme";

export default function TasksPage({ navigation }: { navigation: any }) {
  const { tasks, runs, agents } = useTaskStore();
  const { connectionState } = useDeviceStore();
  const [modalVisible, setModalVisible] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskMode, setNewTaskMode] = useState<TaskMode>("single");
  const [newTaskPrompt, setNewTaskPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastCreateError, setLastCreateError] = useState<string | null>(null);

  const isConnected = connectionState === "connected";

  /** Pull-to-refresh: request a sync from the desktop */
  const onRefresh = useCallback(() => {
    if (!isConnected) return;
    setRefreshing(true);
    try {
      connectionService.requestSync();
    } catch (err) {
      console.error("[TasksPage] Sync request failed:", err);
    }
    setTimeout(() => setRefreshing(false), 1500);
  }, [isConnected]);

  /** Create task with try/catch and feedback */
  const handleCreateTask = async () => {
    if (!newTaskTitle.trim() || !newTaskPrompt.trim()) {
      Alert.alert("错误", "请填写任务标题和提示词");
      return;
    }

    setCreating(true);
    setLastCreateError(null);

    try {
      connectionService.createTask(newTaskTitle, newTaskMode, {
        prompt: newTaskPrompt,
        agentIds: agents.slice(0, 1).map((a) => a.id),
      });

      setModalVisible(false);
      setNewTaskTitle("");
      setNewTaskPrompt("");
      Alert.alert("成功", "任务已创建");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "创建任务失败，请重试";
      setLastCreateError(message);
      Alert.alert("创建失败", message);
    } finally {
      setCreating(false);
    }
  };

  const getTaskStatus = (taskId: string) => {
    const taskRuns = runs.filter((r) => r.taskId === taskId);
    return taskRuns[0]?.status || "pending";
  };

  const getLatestRun = (taskId: string) => {
    const taskRuns = runs.filter((r) => r.taskId === taskId);
    return taskRuns[0] || null;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "running":
        return "#A9873C";
      case "success":
        return "#5F7A5A";
      case "error":
        return "#B05038";
      case "cancelled":
        return "#9A918A";
      case "queued":
        return "#3B3F4A";
      default:
        return "#374151";
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "running":
        return "运行中";
      case "success":
        return "已完成";
      case "error":
        return "错误";
      case "cancelled":
        return "已取消";
      case "queued":
        return "排队中";
      case "pending":
        return "待执行";
      default:
        return status;
    }
  };

  const navigateToRun = (taskId: string) => {
    const latestRun = getLatestRun(taskId);
    if (latestRun) {
      navigation.navigate("Run", { runId: latestRun.id });
    } else {
      Alert.alert("提示", "该任务暂无运行记录");
    }
  };

  const renderTaskItem = ({ item }: { item: any }) => {
    const status = getTaskStatus(item.id);
    const statusColor = getStatusColor(status);
    const latestRun = getLatestRun(item.id);
    const hasRun = !!latestRun;

    return (
      <TouchableOpacity
        style={[styles.taskItem, hasRun && styles.taskItemTouchable]}
        onPress={() => navigateToRun(item.id)}
        activeOpacity={hasRun ? 0.7 : 1}
      >
        <View style={styles.taskHeader}>
          <Text style={styles.taskTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
            <Text style={styles.statusText}>{getStatusText(status)}</Text>
          </View>
        </View>

        <View style={styles.taskMeta}>
          <Text style={styles.taskMode}>
            {item.mode === "single"
              ? "单发"
              : item.mode === "workflow"
              ? "工作流"
              : "群聊"}
          </Text>
          <Text style={styles.taskTime}>
            {new Date(item.createdAt).toLocaleString()}
          </Text>
        </View>

        {hasRun && (
          <View style={styles.taskRunInfo}>
            <Text style={styles.runInfoText}>
              最近运行: {new Date(latestRun.startedAt).toLocaleString()}
            </Text>
            <Text style={styles.viewDetailText}>查看详情</Text>
          </View>
        )}

        {status === "running" && (
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={(e) => {
              e.stopPropagation();
              try {
                connectionService.sendControlCommand(
                  "cancel",
                  item.id,
                  "task"
                );
              } catch (err) {
                Alert.alert("取消失败", "无法发送取消命令，请检查连接");
              }
            }}
          >
            <Text style={styles.cancelButtonText}>取消</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.addButton, !isConnected && styles.addButtonDisabled]}
          onPress={() => {
            setLastCreateError(null);
            isConnected && setModalVisible(true);
          }}
          disabled={!isConnected}
        >
          <Text style={styles.addButtonText}>+ 新建</Text>
        </TouchableOpacity>
      </View>

      {/* Error banner for last create failure */}
      {lastCreateError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{lastCreateError}</Text>
          <TouchableOpacity onPress={() => setLastCreateError(null)}>
            <Text style={styles.errorBannerDismiss}>x</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Task list */}
      {tasks.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>{"\u{1F4CB}"}</Text>
          <Text style={styles.emptyText}>暂无任务</Text>
          <Text style={styles.emptySubtext}>
            {isConnected ? "点击右上角 + 创建新任务" : "请先连接服务器"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={tasks}
          renderItem={renderTaskItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#5F7A5A"
              colors={["#5F7A5A"]}
            />
          }
        />
      )}

      {/* Create task modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>创建新任务</Text>

            <TextInput
              style={styles.input}
              placeholder="任务标题"
              placeholderTextColor="#9A918A"
              value={newTaskTitle}
              onChangeText={setNewTaskTitle}
            />

            <View style={styles.modeSelector}>
              {(["single", "workflow", "chat"] as TaskMode[]).map((mode) => (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.modeButton,
                    newTaskMode === mode && styles.modeButtonActive,
                  ]}
                  onPress={() => setNewTaskMode(mode)}
                >
                  <Text
                    style={[
                      styles.modeButtonText,
                      newTaskMode === mode && styles.modeButtonTextActive,
                    ]}
                  >
                    {mode === "single"
                      ? "单发"
                      : mode === "workflow"
                      ? "工作流"
                      : "群聊"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="输入提示词..."
              placeholderTextColor="#9A918A"
              value={newTaskPrompt}
              onChangeText={setNewTaskPrompt}
              multiline
              numberOfLines={4}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelModalButton}
                onPress={() => setModalVisible(false)}
                disabled={creating}
              >
                <Text style={styles.cancelModalButtonText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.createButton,
                  creating && styles.createButtonDisabled,
                ]}
                onPress={handleCreateTask}
                disabled={creating}
              >
                {creating ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.createButtonText}>创建</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "600",
  },
  addButton: {
    backgroundColor: "#5F7A5A",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addButtonDisabled: {
    backgroundColor: colors.surfaceAlt,
  },
  addButtonText: {
    color: colors.text,
    fontWeight: "500",
  },
  errorBanner: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  errorBannerText: {
    color: colors.danger,
    fontSize: 13,
    flex: 1,
  },
  errorBannerDismiss: {
    color: colors.danger,
    fontSize: 16,
    fontWeight: "600",
    paddingLeft: 12,
  },
  listContent: {
    padding: 16,
  },
  taskItem: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  taskItemTouchable: {
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
    fontSize: 16,
    fontWeight: "500",
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  statusText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "500",
  },
  taskMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  taskMode: {
    color: colors.textMuted,
    fontSize: 12,
  },
  taskTime: {
    color: colors.textFaint,
    fontSize: 12,
  },
  taskRunInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 10,
    paddingTop: 10,
  },
  runInfoText: {
    color: colors.textMuted,
    fontSize: 12,
    flex: 1,
  },
  viewDetailText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "500",
    marginLeft: 8,
  },
  cancelButton: {
    marginTop: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "#B05038",
    borderRadius: 4,
    alignSelf: "flex-end",
  },
  cancelButtonText: {
    color: colors.text,
    fontSize: 12,
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
    color: colors.text,
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptySubtext: {
    color: colors.textFaint,
    textAlign: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 16,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 24,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 16,
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    padding: 12,
    color: colors.text,
    marginBottom: 12,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: "top",
  },
  modeSelector: {
    flexDirection: "row",
    marginBottom: 12,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 6,
    marginHorizontal: 4,
    alignItems: "center",
  },
  modeButtonActive: {
    backgroundColor: "#5F7A5A",
  },
  modeButtonText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  modeButtonTextActive: {
    color: colors.text,
    fontWeight: "500",
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 16,
  },
  cancelModalButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginRight: 12,
  },
  cancelModalButtonText: {
    color: colors.textMuted,
    fontSize: 16,
  },
  createButton: {
    backgroundColor: "#5F7A5A",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 80,
    alignItems: "center",
  },
  createButtonDisabled: {
    opacity: 0.6,
  },
  createButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "500",
  },
});
