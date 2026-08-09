/**
 * 聊天页面
 * 实时与 Agent 对话
 */

import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useTaskStore } from "../store/taskStore";
import { useDeviceStore } from "../store/deviceStore";
import { connectionService } from "../services/connection";
import type { ChatMessage } from "@ensemble/shared-protocol";

export default function ChatPage() {
  const { runs, jobs } = useTaskStore();
  const { connectionState } = useDeviceStore();
  const [inputText, setInputText] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  const isConnected = connectionState === "connected";

  // 获取聊天运行
  const chatRuns = runs.filter((r) => r.mode === "chat");

  // 获取当前运行的消息
  const currentMessages = selectedRunId
    ? jobs
        .filter((j) => j.runId === selectedRunId)
        .flatMap((j) => j.events)
        .filter((e) => e.type === "output")
        .map((e) => ({
          id: `${e.ts}`,
          role: "assistant" as const,
          content: e.type === "output" ? e.text : "",
          ts: new Date(e.ts).toISOString(),
        }))
    : [];

  // 发送消息
  const handleSend = () => {
    if (!inputText.trim() || !selectedRunId || !isConnected) return;

    connectionService.sendChatMessage(selectedRunId, inputText.trim());
    setInputText("");
  };

  // 自动滚动到底部
  useEffect(() => {
    if (currentMessages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [currentMessages.length]);

  // 渲染消息
  const renderMessage = ({ item }: { item: any }) => {
    const isUser = item.role === "user";

    return (
      <View
        style={[
          styles.messageBubble,
          isUser ? styles.userBubble : styles.assistantBubble,
        ]}
      >
        {!isUser && (
          <Text style={styles.messageRole}>🤖 Agent</Text>
        )}
        <Text style={styles.messageContent}>{item.content}</Text>
        <Text style={styles.messageTime}>
          {new Date(item.ts).toLocaleTimeString()}
        </Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* 运行选择器 */}
      <View style={styles.runSelector}>
        <FlatList
          horizontal
          data={chatRuns}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.runChip,
                selectedRunId === item.id && styles.runChipActive,
              ]}
              onPress={() => setSelectedRunId(item.id)}
            >
              <Text
                style={[
                  styles.runChipText,
                  selectedRunId === item.id && styles.runChipTextActive,
                ]}
              >
                {item.taskTitle || `运行 ${item.id.slice(0, 6)}`}
              </Text>
            </TouchableOpacity>
          )}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.runList}
        />
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
              <Text style={styles.emptyChatText}>暂无消息</Text>
              <Text style={styles.emptyChatSubtext}>发送消息开始对话</Text>
            </View>
          }
        />
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyText}>选择一个聊天运行</Text>
          <Text style={styles.emptySubtext}>
            {chatRuns.length > 0
              ? "从上方选择一个运行开始聊天"
              : "请先在桌面端创建群聊任务"}
          </Text>
        </View>
      )}

      {/* 输入框 */}
      {selectedRunId && (
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="输入消息..."
            placeholderTextColor="#6b7280"
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={1000}
            editable={isConnected}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              (!inputText.trim() || !isConnected) && styles.sendButtonDisabled,
            ]}
            onPress={handleSend}
            disabled={!inputText.trim() || !isConnected}
          >
            <Text style={styles.sendButtonText}>发送</Text>
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111827",
  },
  runSelector: {
    borderBottomWidth: 1,
    borderBottomColor: "#374151",
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
  messageRole: {
    color: "#9ca3af",
    fontSize: 12,
    marginBottom: 4,
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
  emptyChatText: {
    color: "#6b7280",
    fontSize: 16,
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
  inputContainer: {
    flexDirection: "row",
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#374151",
    backgroundColor: "#111827",
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
    justifyContent: "center",
  },
  sendButtonDisabled: {
    backgroundColor: "#374151",
  },
  sendButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
});
