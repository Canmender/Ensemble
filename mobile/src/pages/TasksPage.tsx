/**
 * 任务列表页面
 */

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
} from "react-native";
import { useTaskStore } from "../store/taskStore";
import { useDeviceStore } from "../store/deviceStore";
import { connectionService } from "../services/connection";
import type { TaskMode } from "@ensemble/shared-protocol";

export default function TasksPage() {
  const { tasks, runs, agents } = useTaskStore();
  const { connectionState } = useDeviceStore();
  const [modalVisible, setModalVisible] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskMode, setNewTaskMode] = useState<TaskMode>("single");
  const [newTaskPrompt, setNewTaskPrompt] = useState("");

  const isConnected = connectionState === "connected";

  // 创建任务
  const handleCreateTask = () => {
    if (!newTaskTitle.trim() || !newTaskPrompt.trim()) {
      Alert.alert("错误", "请填写任务标题和提示词");
      return;
    }

    connectionService.createTask(newTaskTitle, newTaskMode, {
      prompt: newTaskPrompt,
      agentIds: agents.slice(0, 1).map((a) => a.id), // 默认使用第一个 agent
    });

    setModalVisible(false);
    setNewTaskTitle("");
    setNewTaskPrompt("");
  };

  // 获取任务状态
  const getTaskStatus = (taskId: string) => {
    const taskRuns = runs.filter((r) => r.taskId === taskId);
    return taskRuns[0]?.status || "pending";
  };

  // 状态颜色
  const getStatusColor = (status: string) => {
    switch (status) {
      case "running":
        return "#f59e0b";
      case "success":
        return "#10b981";
      case "error":
        return "#ef4444";
      case "cancelled":
        return "#6b7280";
      default:
        return "#374151";
    }
  };

  // 渲染任务项
  const renderTaskItem = ({ item }: { item: any }) => {
    const status = getTaskStatus(item.id);
    const statusColor = getStatusColor(status);

    return (
      <TouchableOpacity style={styles.taskItem}>
        <View style={styles.taskHeader}>
          <Text style={styles.taskTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
            <Text style={styles.statusText}>{status}</Text>
          </View>
        </View>

        <View style={styles.taskMeta}>
          <Text style={styles.taskMode}>{item.mode}</Text>
          <Text style={styles.taskTime}>
            {new Date(item.createdAt).toLocaleDateString()}
          </Text>
        </View>

        {status === "running" && (
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => {
              connectionService.sendControlCommand("cancel", item.id, "task");
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
      {/* 头部 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>任务列表</Text>
        <TouchableOpacity
          style={[styles.addButton, !isConnected && styles.addButtonDisabled]}
          onPress={() => isConnected && setModalVisible(true)}
          disabled={!isConnected}
        >
          <Text style={styles.addButtonText}>+ 新建</Text>
        </TouchableOpacity>
      </View>

      {/* 任务列表 */}
      {tasks.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyText}>暂无任务</Text>
          <Text style={styles.emptySubtext}>
            {isConnected ? "点击右上角 + 创建新任务" : "请先连接到桌面端"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={tasks}
          renderItem={renderTaskItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* 创建任务弹窗 */}
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
              placeholderTextColor="#6b7280"
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
                    {mode === "single" ? "单发" : mode === "workflow" ? "工作流" : "群聊"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="输入提示词..."
              placeholderTextColor="#6b7280"
              value={newTaskPrompt}
              onChangeText={setNewTaskPrompt}
              multiline
              numberOfLines={4}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelModalButton}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.cancelModalButtonText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.createButton}
                onPress={handleCreateTask}
              >
                <Text style={styles.createButtonText}>创建</Text>
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
  addButton: {
    backgroundColor: "#10b981",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addButtonDisabled: {
    backgroundColor: "#374151",
  },
  addButtonText: {
    color: "#fff",
    fontWeight: "500",
  },
  listContent: {
    padding: 16,
  },
  taskItem: {
    backgroundColor: "#1f2937",
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  taskHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  taskTitle: {
    color: "#fff",
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
    color: "#fff",
    fontSize: 12,
    fontWeight: "500",
  },
  taskMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  taskMode: {
    color: "#9ca3af",
    fontSize: 12,
  },
  taskTime: {
    color: "#6b7280",
    fontSize: 12,
  },
  cancelButton: {
    marginTop: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "#ef4444",
    borderRadius: 4,
    alignSelf: "flex-end",
  },
  cancelButtonText: {
    color: "#fff",
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
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptySubtext: {
    color: "#6b7280",
    textAlign: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 16,
  },
  modalContent: {
    backgroundColor: "#1f2937",
    borderRadius: 12,
    padding: 24,
  },
  modalTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 16,
  },
  input: {
    backgroundColor: "#374151",
    borderRadius: 8,
    padding: 12,
    color: "#fff",
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
    backgroundColor: "#374151",
    borderRadius: 6,
    marginHorizontal: 4,
    alignItems: "center",
  },
  modeButtonActive: {
    backgroundColor: "#10b981",
  },
  modeButtonText: {
    color: "#9ca3af",
    fontSize: 14,
  },
  modeButtonTextActive: {
    color: "#fff",
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
    color: "#9ca3af",
    fontSize: 16,
  },
  createButton: {
    backgroundColor: "#10b981",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  createButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "500",
  },
});
