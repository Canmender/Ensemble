/**
 * 聊天页面
 * 支持直接与 Agent 对话，创建新的聊天 run
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useTaskStore } from "../store/taskStore";
import { useDeviceStore } from "../store/deviceStore";
import { connectionService } from "../services/connection";
import type { AgentConfig } from "@ensemble/shared-protocol";

type MessageItem = {
  id: string;
  role: "user" | "assistant";
  content: string;
  agentName?: string;
  ts: string;
};

export default function ChatPage() {
  const { runs, jobs, agents } = useTaskStore();
  const { connectionState } = useDeviceStore();
  const [inputText, setInputText] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showAgentSelector, setShowAgentSelector] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  const isConnected = connectionState === "connected";

  // 获取聊天 runs
  const chatRuns = runs.filter((r) => r.mode === "chat");

  // 获取当前 run 的消息
  const currentMessages: MessageItem[] = selectedRunId
    ? (() => {
        const runJobs = jobs.filter((j) => j.runId === selectedRunId);
        const messages: MessageItem[] = [];

        // 从 job events 中提取输出消息
        runJobs.forEach((job) => {
          job.events.forEach((event) => {
            if (event.type === "output" && event.kind === "text") {
              messages.push({
                id: `${job.id}-${event.ts}`,
                role: "assistant",
                content: event.text,
                agentName: job.agentName,
                ts: new Date(event.ts).toISOString(),
              });
            }
          });
        });

        // 按时间排序
        messages.sort(
          (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
        );

        return messages;
      })()
    : [];

  // 创建新的聊天 run
  const handleCreateChat = useCallback(() => {
    if (!selectedAgentId || !inputText.trim() || !isConnected) return;

    setIsSending(true);
    setSendError(null);

    try {
      connectionService.createTask("新对话", "chat", {
        prompt: inputText.trim(),
        participantIds: [selectedAgentId],
        maxRounds: 10,
      });

      setInputText("");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setIsSending(false);
    }
  }, [selectedAgentId, inputText, isConnected]);

  // 发送消息到已有 run
  const handleSendToRun = useCallback(() => {
    if (!inputText.trim() || !selectedRunId || !isConnected) return;

    setIsSending(true);
    setSendError(null);

    try {
      connectionService.sendChatMessage(selectedRunId, inputText.trim());
      setInputText("");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setIsSending(false);
    }
  }, [inputText, selectedRunId, isConnected]);

  // 发送消息（自动判断新建 or 已有）
  const handleSend = () => {
    if (selectedRunId) {
      handleSendToRun();
    } else if (selectedAgentId && inputText.trim()) {
      handleCreateChat();
    }
  };

  // 自动滚动到底部
  useEffect(() => {
    if (currentMessages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [currentMessages.length]);

  // 清除发送错误
  useEffect(() => {
    if (sendError) {
      const timer = setTimeout(() => setSendError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [sendError]);

  // 选择 agent 并自动创建对话
  const handleSelectAgent = (agent: AgentConfig) => {
    setSelectedAgentId(agent.id);
    setShowAgentSelector(false);
    setSelectedRunId(null); // 切换到新建模式
  };

  // 渲染 agent 选择器
  const renderAgentSelector = () => {
    if (!showAgentSelector) return null;

    const enabledAgents = agents.filter((a) => a.enabled);

    return (
      <View style={styles.agentSelectorOverlay}>
        <View style={styles.agentSelectorContent}>
          <View style={styles.agentSelectorHeader}>
            <Text style={styles.agentSelectorTitle}>选择 Agent</Text>
            <TouchableOpacity onPress={() => setShowAgentSelector(false)}>
              <Text style={styles.agentSelectorClose}>关闭</Text>
            </TouchableOpacity>
          </View>
          {enabledAgents.length === 0 ? (
            <Text style={styles.noAgentsText}>暂无可用 Agent</Text>
          ) : (
            <FlatList
              data={enabledAgents}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.agentItem,
                    selectedAgentId === item.id && styles.agentItemSelected,
                  ]}
                  onPress={() => handleSelectAgent(item)}
                >
                  <View style={styles.agentItemHeader}>
                    <Text style={styles.agentItemIcon}>
                      {item.kind === "builtin" ? "🤖" : "💻"}
                    </Text>
                    <View style={styles.agentItemInfo}>
                      <Text style={styles.agentItemName}>{item.name}</Text>
                      <Text style={styles.agentItemModel}>
                        {item.model || "未配置模型"}
                      </Text>
                    </View>
                    {selectedAgentId === item.id && (
                      <View style={styles.agentCheckmark}>
                        <Text style={styles.agentCheckmarkText}>✓</Text>
                      </View>
                    )}
                  </View>
                  {item.description && (
                    <Text style={styles.agentItemDesc} numberOfLines={2}>
                      {item.description}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </View>
    );
  };

  // 渲染消息
  const renderMessage = ({ item }: { item: MessageItem }) => {
    const isUser = item.role === "user";

    return (
      <View
        style={[
          styles.messageBubble,
          isUser ? styles.userBubble : styles.assistantBubble,
        ]}
      >
        {!isUser && item.agentName && (
          <Text style={styles.messageAgent}>{item.agentName}</Text>
        )}
        <Text style={styles.messageContent}>{item.content}</Text>
        <Text style={styles.messageTime}>
          {new Date(item.ts).toLocaleTimeString()}
        </Text>
      </View>
    );
  };

  // 选择的 agent 名称
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const canSend = inputText.trim() && isConnected && !isSending && (selectedRunId || selectedAgentId);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* 顶部区域：运行选择器 + Agent 选择器 */}
      <View style={styles.topBar}>
        {/* 运行选择器 */}
        <View style={styles.runSelector}>
          <FlatList
            horizontal
            data={[{ id: "__new__", taskTitle: "+ 新对话" }, ...chatRuns]}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const isNew = item.id === "__new__";
              const isActive = isNew
                ? !selectedRunId
                : selectedRunId === item.id;

              return (
                <TouchableOpacity
                  style={[
                    styles.runChip,
                    isActive && styles.runChipActive,
                  ]}
                  onPress={() => {
                    if (isNew) {
                      setSelectedRunId(null);
                    } else {
                      setSelectedRunId(item.id);
                    }
                  }}
                >
                  <Text
                    style={[
                      styles.runChipText,
                      isActive && styles.runChipTextActive,
                    ]}
                  >
                    {isNew
                      ? "+ 新对话"
                      : item.taskTitle || `运行 ${item.id.slice(0, 6)}`}
                  </Text>
                </TouchableOpacity>
              );
            }}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.runList}
          />
        </View>

        {/* Agent 选择器按钮 */}
        {!selectedRunId && (
          <TouchableOpacity
            style={styles.agentSelectorButton}
            onPress={() => setShowAgentSelector(true)}
          >
            <Text style={styles.agentSelectorButtonText}>
              {selectedAgent
                ? `${selectedAgent.kind === "builtin" ? "🤖" : "💻"} ${selectedAgent.name}`
                : "选择 Agent"}
            </Text>
            <Text style={styles.agentSelectorArrow}>▼</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 消息列表 */}
      {selectedRunId ? (
        <FlatList
          ref={flatListRef}
          data={currentMessages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Text style={styles.emptyChatIcon}>💬</Text>
              <Text style={styles.emptyChatText}>暂无消息</Text>
              <Text style={styles.emptyChatSubtext}>发送消息开始对话</Text>
            </View>
          }
        />
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyText}>开始新对话</Text>
          <Text style={styles.emptySubtext}>
            {agents.length > 0
              ? "选择一个 Agent，输入消息开始聊天"
              : "请先在桌面端创建 Agent"}
          </Text>
        </View>
      )}

      {/* 发送错误提示 */}
      {sendError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{sendError}</Text>
          <TouchableOpacity onPress={() => setSendError(null)}>
            <Text style={styles.errorBannerClose}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 输入框 */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder={
            selectedRunId
              ? "输入消息..."
              : selectedAgentId
              ? "输入消息开始对话..."
              : "请先选择 Agent"
          }
          placeholderTextColor="#6b7280"
          value={inputText}
          onChangeText={(text) => {
            setInputText(text);
            if (sendError) setSendError(null);
          }}
          multiline
          maxLength={2000}
          editable={isConnected && !isSending}
        />
        {isSending ? (
          <View style={styles.sendingIndicator}>
            <ActivityIndicator size="small" color="#10b981" />
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!canSend}
          >
            <Text style={styles.sendButtonText}>发送</Text>
          </TouchableOpacity>
        )}
      </View>

      {renderAgentSelector()}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111827",
  },
  topBar: {
    borderBottomWidth: 1,
    borderBottomColor: "#374151",
  },
  runSelector: {
    paddingVertical: 8,
  },
  runList: {
    paddingHorizontal: 12,
  },
  runChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#374151",
    borderRadius: 16,
    marginHorizontal: 4,
  },
  runChipActive: {
    backgroundColor: "#10b981",
  },
  runChipText: {
    color: "#9ca3af",
    fontSize: 14,
  },
  runChipTextActive: {
    color: "#fff",
    fontWeight: "500",
  },
  agentSelectorButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 12,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#1f2937",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#374151",
  },
  agentSelectorButtonText: {
    color: "#d1d5db",
    fontSize: 14,
    fontWeight: "500",
  },
  agentSelectorArrow: {
    color: "#6b7280",
    fontSize: 12,
  },
  messageList: {
    padding: 16,
  },
  messageBubble: {
    maxWidth: "80%",
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  userBubble: {
    backgroundColor: "#10b981",
    alignSelf: "flex-end",
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: "#1f2937",
    alignSelf: "flex-start",
    borderBottomLeftRadius: 4,
  },
  messageAgent: {
    color: "#9ca3af",
    fontSize: 11,
    marginBottom: 4,
    fontWeight: "500",
  },
  messageContent: {
    color: "#fff",
    fontSize: 15,
    lineHeight: 20,
  },
  messageTime: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    marginTop: 4,
    alignSelf: "flex-end",
  },
  emptyChat: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyChatIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyChatText: {
    color: "#6b7280",
    fontSize: 16,
    fontWeight: "500",
  },
  emptyChatSubtext: {
    color: "#4b5563",
    fontSize: 14,
    marginTop: 4,
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
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#ef4444",
  },
  errorBannerText: {
    color: "#fca5a5",
    fontSize: 13,
    flex: 1,
  },
  errorBannerClose: {
    color: "#fca5a5",
    fontSize: 16,
    paddingLeft: 12,
  },
  inputContainer: {
    flexDirection: "row",
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#374151",
    backgroundColor: "#111827",
    alignItems: "flex-end",
  },
  input: {
    flex: 1,
    backgroundColor: "#1f2937",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: "#fff",
    fontSize: 15,
    maxHeight: 100,
    marginRight: 8,
  },
  sendButton: {
    backgroundColor: "#10b981",
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    justifyContent: "center",
  },
  sendButtonDisabled: {
    backgroundColor: "#374151",
  },
  sendButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
  sendingIndicator: {
    width: 60,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },

  // Agent Selector Overlay
  agentSelectorOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  agentSelectorContent: {
    backgroundColor: "#1f2937",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "60%",
    paddingBottom: 20,
  },
  agentSelectorHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#374151",
  },
  agentSelectorTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  agentSelectorClose: {
    color: "#9ca3af",
    fontSize: 16,
  },
  noAgentsText: {
    color: "#6b7280",
    textAlign: "center",
    padding: 24,
    fontSize: 15,
  },
  agentItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#374151",
  },
  agentItemSelected: {
    backgroundColor: "rgba(16, 185, 129, 0.08)",
  },
  agentItemHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  agentItemIcon: {
    fontSize: 28,
    marginRight: 12,
  },
  agentItemInfo: {
    flex: 1,
  },
  agentItemName: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  agentItemModel: {
    color: "#9ca3af",
    fontSize: 12,
    marginTop: 2,
  },
  agentItemDesc: {
    color: "#6b7280",
    fontSize: 13,
    marginTop: 6,
    marginLeft: 40,
    lineHeight: 18,
  },
  agentCheckmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#10b981",
    justifyContent: "center",
    alignItems: "center",
  },
  agentCheckmarkText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
  },
});
