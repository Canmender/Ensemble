/**
 * 聊天页面（企业级会话）
 * 会话列表 / 消息读 chat_messages / WS 实时推送。
 * 使用设计系统（theme + ui 组件 + Ionicons）。
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
import { Ionicons } from "@expo/vector-icons";
import { useTaskStore } from "../store/taskStore";
import { useDeviceStore } from "../store/deviceStore";
import { api, type Conversation } from "../services/api";
import { wsLink } from "../services/wslink";
import { Button, EmptyState, Badge } from "../components/ui";
import { colors, spacing, radius, fontSize } from "../theme";
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

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

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

  const renderMessage = ({ item }: { item: MessageItem }) => {
    const isUser = item.role === "user";
    return (
      <View style={[styles.msgRow, isUser ? styles.msgRowUser : styles.msgRowAgent]}>
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAgent]}>
          {!isUser && item.agentName && (
            <Text style={styles.bubbleAgentName}>{item.agentName}</Text>
          )}
          <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>{item.content}</Text>
          <Text style={[styles.bubbleTime, isUser && styles.bubbleTimeUser]}>
            {new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </Text>
        </View>
      </View>
    );
  };

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const canSend = inputText.trim() && isConnected && !isSending && (!!selectedConvId || !!selectedAgentId);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* 会话选择器 */}
      <View style={styles.topBar}>
        <FlatList
          horizontal
          data={[{ id: "__new__", title: "新对话" }, ...conversations]}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const isNew = item.id === "__new__";
            const isActive = isNew ? !selectedConvId : selectedConvId === item.id;
            const conv = item as Conversation;
            const title = isNew
              ? "新对话"
              : conv.title || (conv.participantIds ?? []).join(", ");
            return (
              <TouchableOpacity
                style={[styles.convChip, isActive && styles.convChipActive]}
                onPress={() => setSelectedConvId(isNew ? null : conv.id)}
                activeOpacity={0.7}
              >
                {isNew ? (
                  <Ionicons name="add" size={14} color={isActive ? "#fff" : colors.textMuted} />
                ) : null}
                <Text
                  style={[styles.convChipText, isActive && styles.convChipTextActive]}
                  numberOfLines={1}
                >
                  {title}
                </Text>
                {!isNew && conv.unread > 0 && <Badge count={conv.unread} />}
              </TouchableOpacity>
            );
          }}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.convList}
        />

        {/* 新对话：选择 Agent */}
        {!selectedConvId && (
          <View style={styles.agentBar}>
            <TouchableOpacity style={styles.agentPicker} onPress={() => setShowAgentSelector(true)} activeOpacity={0.7}>
              <Ionicons
                name={selectedAgent?.kind === "builtin" ? "flash" : "terminal"}
                size={16}
                color={colors.primary}
              />
              <Text style={styles.agentPickerText} numberOfLines={1}>
                {selectedAgent ? selectedAgent.name : "选择 Agent"}
              </Text>
              <Ionicons name="chevron-down" size={14} color={colors.textFaint} />
            </TouchableOpacity>
          </View>
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
            <EmptyState
              icon={<Ionicons name="chatbubble-ellipses-outline" size={28} color={colors.textFaint} />}
              title="暂无消息"
              subtitle="发送消息开始对话"
            />
          }
        />
      ) : (
        <View style={styles.newConvWrap}>
          <EmptyState
            icon={<Ionicons name="chatbubbles-outline" size={28} color={colors.textFaint} />}
            title={selectedAgentId ? `与 ${selectedAgent?.name} 对话` : "开始新对话"}
            subtitle={
              selectedAgentId
                ? "输入消息，回车发送"
                : agents.length > 0
                  ? "选择一个 Agent 开始对话"
                  : "请先在桌面端创建 Agent"
            }
          />
        </View>
      )}

      {/* 发送错误提示 */}
      {sendError && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={14} color={colors.danger} />
          <Text style={styles.errorText}>{sendError}</Text>
          <TouchableOpacity onPress={() => setSendError(null)} hitSlop={8}>
            <Ionicons name="close" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* 输入栏 */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder={selectedConvId ? "输入消息…" : selectedAgentId ? "输入消息…" : "请先选择 Agent"}
          placeholderTextColor={colors.textFaint}
          value={inputText}
          onChangeText={(t) => {
            setInputText(t);
            if (sendError) setSendError(null);
          }}
          multiline
          maxLength={2000}
          editable={isConnected && !isSending}
        />
        {isSending ? (
          <View style={styles.sendBtn}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!canSend}
            activeOpacity={0.8}
          >
            <Ionicons name="arrow-up" size={20} color={canSend ? "#fff" : colors.textFaint} />
          </TouchableOpacity>
        )}
      </View>

      {/* Agent 选择器 */}
      {showAgentSelector && (
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>选择 Agent</Text>
              <TouchableOpacity onPress={() => setShowAgentSelector(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {agents.filter((a) => a.enabled).length === 0 ? (
              <EmptyState title="暂无可用 Agent" subtitle="请先在桌面端配置" />
            ) : (
              <FlatList
                data={agents.filter((a) => a.enabled)}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.agentItem, selectedAgentId === item.id && styles.agentItemActive]}
                    onPress={() => handleSelectAgent(item)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.agentIcon}>
                      <Ionicons
                        name={item.kind === "builtin" ? "flash" : "terminal"}
                        size={20}
                        color={colors.primary}
                      />
                    </View>
                    <View style={styles.agentInfo}>
                      <Text style={styles.agentName}>{item.name}</Text>
                      <Text style={styles.agentModel} numberOfLines={1}>
                        {item.model || "未配置模型"}
                      </Text>
                    </View>
                    {selectedAgentId === item.id && (
                      <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                    )}
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
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: { borderBottomWidth: 1, borderBottomColor: colors.border },
  convList: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  convChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: 3,
  },
  convChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  convChipText: { color: colors.textMuted, fontSize: fontSize.sm, maxWidth: 110 },
  convChipTextActive: { color: "#fff", fontWeight: "600" },
  agentBar: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  agentPicker: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  agentPickerText: { color: colors.text, fontSize: fontSize.md, flex: 1 },
  messageList: { padding: spacing.lg },
  msgRow: { marginBottom: spacing.md },
  msgRowUser: { alignItems: "flex-end" },
  msgRowAgent: { alignItems: "flex-start" },
  bubble: {
    maxWidth: "80%",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
  },
  bubbleUser: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: radius.sm,
  },
  bubbleAgent: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: radius.sm,
  },
  bubbleAgentName: { color: colors.primary, fontSize: fontSize.xs, fontWeight: "600", marginBottom: 2 },
  bubbleText: { color: colors.text, fontSize: fontSize.md, lineHeight: 21 },
  bubbleTextUser: { color: "#fff" },
  bubbleTime: { color: colors.textFaint, fontSize: 10, marginTop: 4, alignSelf: "flex-end" },
  bubbleTimeUser: { color: "rgba(255,255,255,0.7)" },
  newConvWrap: { flex: 1, justifyContent: "center" },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  errorText: { color: colors.danger, fontSize: fontSize.sm, flex: 1 },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: colors.inputBg,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    color: colors.text,
    fontSize: fontSize.md,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { backgroundColor: colors.surfaceAlt },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: "60%",
    paddingBottom: spacing.xl,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: "600" },
  agentItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  agentItemActive: { backgroundColor: colors.primarySoft },
  agentIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  agentInfo: { flex: 1 },
  agentName: { color: colors.text, fontSize: fontSize.md, fontWeight: "600" },
  agentModel: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
});
