/**
 * 聊天页面（企业级会话）
 * 会话列表来自 conversations API，消息读 chat_messages（含用户消息），
 * 实时回复通过 wslink（原生 WebSocket）推送。
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
import { api, type Conversation } from "../services/api";
import { wsLink } from "../services/wslink";
import type { AgentConfig } from "@ensemble/shared-protocol";

type MessageItem = {
  id: string;
  role: "user" | "assistant";
  content: string;
  agentName?: string;
  ts: string;
};

export default function ChatPage() {
  const { agents } = useTaskStore();
  const { connectionState } = useDeviceStore();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [inputText, setInputText] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showAgentSelector, setShowAgentSelector] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const activeRunIdRef = useRef<string | null>(null);

  const isConnected = connectionState === "connected";
  const selectedConv = conversations.find((c) => c.id === selectedConvId);

  // 加载会话列表
  const loadConversations = useCallback(async () => {
    const res = await api.getConversations();
    if (res.data) setConversations(res.data);
  }, []);
  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  // 选中会话：记录关联 run（供 WS 匹配）、加载消息、标记已读
  useEffect(() => {
    if (!selectedConvId) {
      setMessages([]);
      activeRunIdRef.current = null;
      return;
    }
    activeRunIdRef.current = selectedConv?.runId ?? null;
    void api.getConversationMessages(selectedConvId).then((res) => {
      if (res.data) {
        setMessages(
          res.data.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            agentName: m.agentId,
            ts: m.ts,
          })),
        );
      }
    });
    void api.markConversationRead(selectedConvId);
  }, [selectedConvId, selectedConv?.runId]);

  // WS 实时：新消息推送到当前会话
  useEffect(() => {
    wsLink.on({
      onChatMessage: (msg) => {
        if (msg.runId === activeRunIdRef.current) {
          setMessages((prev) => [
            ...prev,
            {
              id: `${msg.agentId}-${Date.now()}`,
              role: "assistant",
              content: msg.content,
              agentName: msg.agentId,
              ts: new Date().toISOString(),
            },
          ]);
        }
      },
    });
  }, []);

  // 发送消息
  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !isConnected || isSending) return;

    // 已有会话：发送到当前会话
    if (selectedConvId) {
      setIsSending(true);
      setSendError(null);
      try {
        await api.sendConversationMessage(selectedConvId, text);
        setMessages((prev) => [
          ...prev,
          { id: `u-${Date.now()}`, role: "user", content: text, ts: new Date().toISOString() },
        ]);
        setInputText("");
      } catch (err) {
        setSendError(err instanceof Error ? err.message : "发送失败");
      } finally {
        setIsSending(false);
      }
      return;
    }

    // 新建 direct 会话（选中的 agent）
    if (!selectedAgentId) return;
    setIsSending(true);
    setSendError(null);
    try {
      const res = await api.createConversation({
        type: "direct",
        participantIds: [selectedAgentId],
      });
      if (res.data) {
        await api.sendConversationMessage(res.data.id, text);
        setSelectedConvId(res.data.id);
        setMessages([
          { id: `u-${Date.now()}`, role: "user", content: text, ts: new Date().toISOString() },
        ]);
        setInputText("");
        void loadConversations();
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "创建会话失败");
    } finally {
      setIsSending(false);
    }
  }, [inputText, selectedConvId, selectedAgentId, isConnected, isSending, loadConversations]);

  // 自动滚动到底部
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  // 清除发送错误
  useEffect(() => {
    if (!sendError) return;
    const t = setTimeout(() => setSendError(null), 5000);
    return () => clearTimeout(t);
  }, [sendError]);

  const handleSelectAgent = (agent: AgentConfig) => {
    setSelectedAgentId(agent.id);
    setShowAgentSelector(false);
    setSelectedConvId(null);
  };

  // 渲染消息
  const renderMessage = ({ item }: { item: MessageItem }) => {
    const isUser = item.role === "user";
    return (
      <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        {!isUser && item.agentName && <Text style={styles.messageAgent}>{item.agentName}</Text>}
        <Text style={styles.messageContent}>{item.content}</Text>
        <Text style={styles.messageTime}>{new Date(item.ts).toLocaleTimeString()}</Text>
      </View>
    );
  };

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const canSend =
    inputText.trim() && isConnected && !isSending && (!!selectedConvId || !!selectedAgentId);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* 会话选择器 */}
      <View style={styles.topBar}>
        <View style={styles.runSelector}>
          <FlatList
            horizontal
            data={[{ id: "__new__", title: "+ 新对话" }, ...conversations]}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const isNew = item.id === "__new__";
              const isActive = isNew ? !selectedConvId : selectedConvId === item.id;
              const title = isNew
                ? "+ 新对话"
                : (item as Conversation).title ||
                  (Array.isArray((item as Conversation).participantIds)
                    ? (item as Conversation).participantIds.join(", ")
                    : "会话");
              return (
                <TouchableOpacity
                  style={[styles.runChip, isActive && styles.runChipActive]}
                  onPress={() => setSelectedConvId(isNew ? null : (item as Conversation).id)}
                >
                  <Text style={[styles.runChipText, isActive && styles.runChipTextActive]}>
                    {title.length > 8 ? title.slice(0, 8) + "…" : title}
                  </Text>
                  {!isNew && (item as Conversation).unread > 0 && (
                    <Text style={styles.unreadBadge}>{(item as Conversation).unread}</Text>
                  )}
                </TouchableOpacity>
              );
            }}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.runList}
          />
        </View>

        {/* Agent 选择器按钮（新对话） */}
        {!selectedConvId && (
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
      {selectedConvId ? (
        <FlatList
          ref={flatListRef}
          data={messages}
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
            {selectedAgentId
              ? `与 ${selectedAgent?.name} 对话，输入消息开始`
              : agents.length > 0
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
            selectedConvId ? "输入消息..." : selectedAgentId ? "输入消息开始对话..." : "请先选择 Agent"
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

      {showAgentSelector && (
        <View style={styles.agentSelectorOverlay}>
          <View style={styles.agentSelectorContent}>
            <View style={styles.agentSelectorHeader}>
              <Text style={styles.agentSelectorTitle}>选择 Agent</Text>
              <TouchableOpacity onPress={() => setShowAgentSelector(false)}>
                <Text style={styles.agentSelectorClose}>关闭</Text>
              </TouchableOpacity>
            </View>
            {agents.filter((a) => a.enabled).length === 0 ? (
              <Text style={styles.noAgentsText}>暂无可用 Agent</Text>
            ) : (
              <FlatList
                data={agents.filter((a) => a.enabled)}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.agentItem, selectedAgentId === item.id && styles.agentItemSelected]}
                    onPress={() => handleSelectAgent(item)}
                  >
                    <View style={styles.agentItemHeader}>
                      <Text style={styles.agentItemIcon}>{item.kind === "builtin" ? "🤖" : "💻"}</Text>
                      <View style={styles.agentItemInfo}>
                        <Text style={styles.agentItemName}>{item.name}</Text>
                        <Text style={styles.agentItemModel}>{item.model || "未配置模型"}</Text>
                      </View>
                      {selectedAgentId === item.id && (
                        <View style={styles.agentCheckmark}>
                          <Text style={styles.agentCheckmarkText}>✓</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111827" },
  topBar: { borderBottomWidth: 1, borderBottomColor: "#374151" },
  runSelector: { paddingVertical: 8 },
  runList: { paddingHorizontal: 12 },
  runChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#374151",
    borderRadius: 16,
    marginHorizontal: 4,
    flexDirection: "row",
    alignItems: "center",
  },
  runChipActive: { backgroundColor: "#10b981" },
  runChipText: { color: "#9ca3af", fontSize: 14 },
  runChipTextActive: { color: "#fff", fontWeight: "500" },
  unreadBadge: {
    color: "#fff",
    fontSize: 10,
    backgroundColor: "#ef4444",
    borderRadius: 8,
    paddingHorizontal: 5,
    marginLeft: 4,
    overflow: "hidden",
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
  agentSelectorButtonText: { color: "#d1d5db", fontSize: 14, fontWeight: "500" },
  agentSelectorArrow: { color: "#6b7280", fontSize: 12 },
  messageList: { padding: 16 },
  messageBubble: { maxWidth: "80%", padding: 12, borderRadius: 12, marginBottom: 12 },
  userBubble: { backgroundColor: "#10b981", alignSelf: "flex-end", borderBottomRightRadius: 4 },
  assistantBubble: { backgroundColor: "#1f2937", alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  messageAgent: { color: "#9ca3af", fontSize: 11, marginBottom: 4, fontWeight: "500" },
  messageContent: { color: "#fff", fontSize: 15, lineHeight: 20 },
  messageTime: { color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 4, alignSelf: "flex-end" },
  emptyChat: { flex: 1, justifyContent: "center", alignItems: "center", paddingVertical: 60 },
  emptyChatIcon: { fontSize: 40, marginBottom: 12 },
  emptyChatText: { color: "#6b7280", fontSize: 16, fontWeight: "500" },
  emptyChatSubtext: { color: "#4b5563", fontSize: 14, marginTop: 4 },
  emptyState: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { color: "#fff", fontSize: 18, fontWeight: "600", marginBottom: 8 },
  emptySubtext: { color: "#6b7280", textAlign: "center" },
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
  errorBannerText: { color: "#fca5a5", fontSize: 13, flex: 1 },
  errorBannerClose: { color: "#fca5a5", fontSize: 16, paddingLeft: 12 },
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
  sendButton: { backgroundColor: "#10b981", borderRadius: 20, paddingHorizontal: 20, paddingVertical: 10, justifyContent: "center" },
  sendButtonDisabled: { backgroundColor: "#374151" },
  sendButtonText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  sendingIndicator: { width: 60, height: 40, justifyContent: "center", alignItems: "center" },
  agentSelectorOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  agentSelectorContent: { backgroundColor: "#1f2937", borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "60%", paddingBottom: 20 },
  agentSelectorHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#374151",
  },
  agentSelectorTitle: { color: "#fff", fontSize: 18, fontWeight: "600" },
  agentSelectorClose: { color: "#9ca3af", fontSize: 16 },
  noAgentsText: { color: "#6b7280", textAlign: "center", padding: 24, fontSize: 15 },
  agentItem: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#374151" },
  agentItemSelected: { backgroundColor: "rgba(16, 185, 129, 0.08)" },
  agentItemHeader: { flexDirection: "row", alignItems: "center" },
  agentItemIcon: { fontSize: 28, marginRight: 12 },
  agentItemInfo: { flex: 1 },
  agentItemName: { color: "#fff", fontSize: 15, fontWeight: "600" },
  agentItemModel: { color: "#9ca3af", fontSize: 12, marginTop: 2 },
  agentCheckmark: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#10b981", justifyContent: "center", alignItems: "center" },
  agentCheckmarkText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
});
