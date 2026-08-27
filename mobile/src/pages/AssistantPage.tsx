/**
 * AI 助手页面 - 内置智能助手
 * 可以询问基础问题，调用本地或云端LLM
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
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../services/api";
import { useDeviceStore } from "../store/deviceStore";
import { colors, spacing, radius, fontSize } from "../theme";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
}

const QUICK_QUESTIONS = [
  "合鸣是什么平台？",
  "如何创建智能体？",
  "怎么使用工作流？",
  "如何添加MCP工具？",
  "记忆系统怎么用？",
  "怎么部署到云端？",
];

export default function AssistantPage({ navigation }: { navigation: any }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "你好！我是合鸣内置AI助手，可以帮你解答关于平台使用的问题。\n\n你可以直接输入问题，或者点击下方的快捷问题。",
      ts: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const { connectionState } = useDeviceStore();

  const handleSend = async (text?: string) => {
    const question = (text || input).trim();
    if (!question || loading) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: question,
      ts: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      // Try to call the server's AI assistant endpoint
      const res = await api.assistantChat(question);

      const assistantMsg: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: res.data?.reply || getLocalAnswer(question),
        ts: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      // Fallback to local answers
      const assistantMsg: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: getLocalAnswer(question),
        ts: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } finally {
      setLoading(false);
    }
  };

  const getLocalAnswer = (q: string): string => {
    const lower = q.toLowerCase();
    if (lower.includes("合鸣") || lower.includes("ensemble") || lower.includes("是什么")) {
      return "合鸣（Ensemble）是一个本地优先的多Agent协作平台。它连接Claude Code、Hermes、OpenCode等AI Agent，通过可视化编排让它们协同工作。\n\n核心功能包括：\n• 多Agent编排（单发/工作流/群聊/规划/对抗）\n• 多模型支持（Anthropic/OpenAI/DeepSeek/Ollama）\n• RAG知识库\n• 工具系统（文件/命令/网络/MCP）\n• 双记忆池\n• 实时监控";
    }
    if (lower.includes("智能体") || lower.includes("agent") || lower.includes("创建")) {
      return "创建智能体步骤：\n1. 打开桌面端 → Agents页面\n2. 点击「新建Agent」\n3. 选择类型：内置Agent（LLM+工具）或本地Agent（接入CLI）\n4. 配置模型、工具、技能\n5. 保存即可使用\n\n移动端暂不支持创建智能体，请在桌面端操作。";
    }
    if (lower.includes("工作流") || lower.includes("workflow")) {
      return "工作流是多Agent协作的编排方式：\n\n• 单发：一个Agent独立完成任务\n• 工作流：多个Agent按依赖关系执行\n• 群聊：多Agent轮转对话\n• 规划-执行-反思：自动拆解任务\n• 对抗迭代：Coder vs Tester\n\n在桌面端的任务页面创建。";
    }
    if (lower.includes("mcp") || lower.includes("工具")) {
      return "MCP（Model Context Protocol）是外部工具接入协议：\n\n1. 桌面端设置 → MCP管理\n2. 添加MCP服务器（stdio命令或HTTP URL）\n3. 工具自动注册为 mcp__<server>__<tool>\n4. Agent勾选后即可调用\n\n支持文件操作、命令执行、网络搜索等内置工具。";
    }
    if (lower.includes("记忆") || lower.includes("memory")) {
      return "合鸣的记忆系统包括：\n\n• 显式记忆：Agent通过工具自主记忆，长期持久化\n• 隐式记忆：项目/Run级别，多Agent共享\n• 存储：SQLite FTS5全文搜索\n\n记忆会自动注入Agent上下文，帮助Agent记住重要信息。";
    }
    if (lower.includes("部署") || lower.includes("云端") || lower.includes("docker")) {
      return "云端部署步骤：\n\n1. 准备服务器（推荐阿里云）\n2. 安装Docker和Docker Compose\n3. 克隆仓库到服务器\n4. 配置.env文件（API_KEY等）\n5. docker compose up -d --build\n\n详细步骤见 docs/DEPLOY.md";
    }
    return "抱歉，我暂时无法回答这个问题。建议：\n\n• 查看桌面端Wiki文档\n• 在GitHub提交Issue\n• 尝试用更具体的关键词提问";
  };

  const renderMessage = ({ item }: { item: Message }) => (
    <View style={[styles.messageRow, item.role === "user" && styles.messageRowUser]}>
      {item.role === "assistant" && (
        <View style={styles.assistantAvatar}>
          <Ionicons name="sparkles" size={16} color={colors.accent} />
        </View>
      )}
      <View style={[styles.messageBubble, item.role === "user" ? styles.bubbleUser : styles.bubbleAssistant]}>
        <Text style={[styles.messageText, item.role === "user" && { color: "#fff" }]}>{item.content}</Text>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      {/* 快捷问题 */}
      {messages.length <= 1 && (
        <View style={styles.quickQuestions}>
          <Text style={styles.quickTitle}>快捷问题</Text>
          <View style={styles.quickGrid}>
            {QUICK_QUESTIONS.map((q) => (
              <TouchableOpacity key={q} style={styles.quickBtn} onPress={() => void handleSend(q)} activeOpacity={0.7}>
                <Text style={styles.quickText}>{q}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.loadingText}>思考中...</Text>
        </View>
      )}

      {/* 输入栏 */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="输入问题..."
          placeholderTextColor={colors.textFaint}
          multiline
          maxLength={2000}
          editable={!loading}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || loading) && { opacity: 0.4 }]}
          onPress={() => void handleSend()}
          disabled={!input.trim() || loading}
        >
          <Ionicons name="send" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  quickQuestions: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  quickTitle: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: "600", marginBottom: spacing.sm },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  quickBtn: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  quickText: { color: colors.primary, fontSize: fontSize.sm },
  messageList: { padding: spacing.lg, paddingBottom: 100 },
  messageRow: { flexDirection: "row", marginBottom: spacing.md, alignItems: "flex-end" },
  messageRowUser: { justifyContent: "flex-end" },
  assistantAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  messageBubble: {
    maxWidth: "75%",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
  },
  bubbleUser: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleAssistant: { backgroundColor: colors.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border },
  messageText: { color: colors.text, fontSize: fontSize.md, lineHeight: 22 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  loadingText: { color: colors.textMuted, fontSize: fontSize.sm },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: spacing.sm,
    paddingBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: colors.inputBg,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: fontSize.md,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});
