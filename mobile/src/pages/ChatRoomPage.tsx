/**
 * 聊天室页面（微信式：从会话列表卡片点击进入）
 * 消息历史 / WS 实时 / 断线重连补拉 / 未读清零 / 图片与文件附件。
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
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api, type Conversation } from "../services/api";
import { useDeviceStore } from "../store/deviceStore";
import { wsLink } from "../services/wslink";
import { EmptyState } from "../components/ui";
import { colors, spacing, radius, fontSize } from "../theme";
import type { MessageAttachment } from "@ensemble/shared-protocol";
import type { RootStackParamList } from "../App";

type Props = NativeStackScreenProps<RootStackParamList, "ChatRoom">;

type MessageItem = {
  id: string;
  role: "user" | "assistant";
  content: string;
  agentName?: string;
  attachment?: MessageAttachment;
  ts: string;
};

/** 相邻去重：WS 回显 + 乐观追加会产生相同消息（如群聊/agent 会话里自己的发言），按 content + role 合并 */
function appendMessage(list: MessageItem[], msg: MessageItem): MessageItem[] {
  const last = list[list.length - 1];
  if (last && last.content === msg.content && last.role === msg.role) return list;
  return [...list, msg];
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 附件 url 补全：服务器返回相对 /uploads/...，移动端拼完整地址 */
function attachUrl(u: string): string {
  if (u.startsWith("http")) return u;
  const d = useDeviceStore.getState().connectedDevice;
  return d ? `http://${d.ip}:${d.httpPort}${u}` : u;
}

export default function ChatRoomPage({ route, navigation }: Props) {
  const { convId, runId, title } = route.params;
  const { connectionState } = useDeviceStore();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [draftAttachment, setDraftAttachment] = useState<MessageAttachment | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const activeRunIdRef = useRef<string | null>(null);

  const isConnected = connectionState === "connected";
  // 附件仅支持用户-用户会话（agent 链路只处理文本）；用户会话 runId 以 conv_ 开头
  const canSendAttachment = !!conv && conv.runId.startsWith("conv_");

  // 会话信息（runId/标题），设置导航标题
  useEffect(() => {
    activeRunIdRef.current = runId ?? null;
    if (title) navigation.setOptions({ title });
    void api.getConversations().then((res) => {
      const c = res.data?.find((x) => x.id === convId);
      if (c) {
        setConv(c);
        activeRunIdRef.current = c.runId;
        navigation.setOptions({ title: c.title || "聊天" });
      }
    });
  }, [convId, runId, title, navigation]);

  // 加载消息历史 + 已读清零
  useEffect(() => {
    void api.getConversationMessages(convId).then((res) => {
      if (res.data) {
        setMessages(
          res.data.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            agentName: m.agentId,
            attachment: m.attachment,
            ts: m.ts,
          })),
        );
      }
    });
    void api.markConversationRead(convId);
  }, [convId]);

  // WS 实时：新消息推送到当前会话
  useEffect(() => {
    wsLink.on({
      onChatMessage: (msg) => {
        if (msg.runId === activeRunIdRef.current) {
          // agent 会话中用户发言会被广播回发送者（agentId="user"），与乐观追加去重；agentId 非 "user" 视为对方消息
          const isSelf = msg.agentId === "user";
          setMessages((prev) =>
            appendMessage(prev, {
              id: `${msg.agentId}-${Date.now()}`,
              role: isSelf ? "user" : "assistant",
              content: msg.content,
              agentName: msg.agentId,
              attachment: msg.attachment,
              ts: new Date().toISOString(),
            }),
          );
        }
      },
    });
  }, []);

  // 断线重连后补拉当前会话历史（chat.message 不走 run_events/seq，catchUp 补不回，重拉服务端历史兜底）
  const prevConnRef = useRef(connectionState);
  useEffect(() => {
    const prev = prevConnRef.current;
    prevConnRef.current = connectionState;
    if (connectionState === "connected" && prev !== "connected") {
      void api.getConversationMessages(convId).then((res) => {
        if (!res.data) return;
        setMessages(
          res.data.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            agentName: m.agentId,
            attachment: m.attachment,
            ts: m.ts,
          })),
        );
      });
    }
  }, [connectionState, convId]);

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

  // 发送文本 / 附件
  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if ((!text && !draftAttachment) || !isConnected || isSending || uploading) return;
    setIsSending(true);
    setSendError(null);
    try {
      await api.sendConversationMessage(convId, text, draftAttachment ?? undefined);
      setMessages((prev) =>
        appendMessage(prev, {
          id: `u-${Date.now()}`,
          role: "user",
          content: text,
          attachment: draftAttachment ?? undefined,
          ts: new Date().toISOString(),
        }),
      );
      setInputText("");
      setDraftAttachment(null);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setIsSending(false);
    }
  }, [inputText, convId, draftAttachment, isConnected, isSending, uploading]);

  // 上传附件（图片 base64 直取；文件经 expo-file-system 读 base64）
  const doUpload = useCallback(async (name: string, mime: string, base64: string) => {
    setUploading(true);
    try {
      const res = await api.uploadAttachment({ name, mime, data: base64 });
      if (res.error) {
        setSendError(res.error);
        return;
      }
      const up = res.data!;
      setDraftAttachment({
        type: up.type === "image" ? "image" : "file",
        name: up.name,
        size: up.size,
        mime: up.mime,
        url: up.url,
      });
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }, []);

  const pickImage = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setSendError("需要相册权限才能发送图片");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true,
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if ((asset.fileSize ?? 0) > 20 * 1024 * 1024) {
      setSendError("图片过大（上限 20MB）");
      return;
    }
    if (!asset.base64) {
      setSendError("无法读取图片");
      return;
    }
    await doUpload(asset.fileName ?? "image.jpg", asset.mimeType ?? "image/jpeg", asset.base64);
  }, [doUpload]);

  const pickFile = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if ((asset.size ?? 0) > 20 * 1024 * 1024) {
      setSendError("文件过大（上限 20MB）");
      return;
    }
    const base64 = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await doUpload(asset.name ?? "file", asset.mimeType ?? "application/octet-stream", base64);
  }, [doUpload]);

  const renderAttachment = (att: MessageAttachment, isUser: boolean) => {
    if (att.type === "image") {
      return <Image source={{ uri: attachUrl(att.url) }} style={styles.msgImage} resizeMode="cover" />;
    }
    return (
      <View style={styles.fileCard}>
        <Ionicons name="document-text" size={20} color={isUser ? "#fff" : colors.primary} />
        <View style={{ flex: 1, marginLeft: spacing.sm }}>
          <Text style={[styles.fileName, isUser && { color: "#fff" }]} numberOfLines={1}>
            {att.name}
          </Text>
          <Text style={[styles.fileSize, isUser && { color: "rgba(255,255,255,0.7)" }]}>
            {fmtSize(att.size)}
          </Text>
        </View>
      </View>
    );
  };

  const renderMessage = ({ item }: { item: MessageItem }) => {
    const isUser = item.role === "user";
    return (
      <View style={[styles.msgRow, isUser ? styles.msgRowUser : styles.msgRowAgent]}>
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAgent]}>
          {!isUser && item.agentName && (
            <Text style={styles.bubbleAgentName}>{item.agentName}</Text>
          )}
          {item.attachment && renderAttachment(item.attachment, isUser)}
          {!!item.content && (
            <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>{item.content}</Text>
          )}
          <Text style={[styles.bubbleTime, isUser && styles.bubbleTimeUser]}>
            {new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </Text>
        </View>
      </View>
    );
  };

  const canSend = (inputText.trim() || !!draftAttachment) && isConnected && !isSending && !uploading;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
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

      {sendError && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={14} color={colors.danger} />
          <Text style={styles.errorText}>{sendError}</Text>
          <TouchableOpacity onPress={() => setSendError(null)} hitSlop={8}>
            <Ionicons name="close" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* 待发送附件预览 */}
      {draftAttachment && (
        <View style={styles.draftBar}>
          <Ionicons
            name={draftAttachment.type === "image" ? "image-outline" : "document-text-outline"}
            size={16}
            color={colors.textMuted}
          />
          <Text style={styles.draftName} numberOfLines={1}>
            {draftAttachment.name}
          </Text>
          <TouchableOpacity onPress={() => setDraftAttachment(null)} hitSlop={8}>
            <Ionicons name="close" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* 输入栏 */}
      <View style={styles.inputBar}>
        <TouchableOpacity
          style={styles.attachBtn}
          onPress={pickImage}
          disabled={!canSendAttachment || uploading || isSending}
          activeOpacity={0.7}
        >
          <Ionicons
            name="image-outline"
            size={22}
            color={canSendAttachment && !uploading ? colors.textMuted : colors.textFaint}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.attachBtn}
          onPress={pickFile}
          disabled={!canSendAttachment || uploading || isSending}
          activeOpacity={0.7}
        >
          <Ionicons
            name="attach-outline"
            size={22}
            color={canSendAttachment && !uploading ? colors.textMuted : colors.textFaint}
          />
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder="输入消息…"
          placeholderTextColor={colors.textFaint}
          value={inputText}
          onChangeText={(t) => {
            setInputText(t);
            if (sendError) setSendError(null);
          }}
          multiline
          maxLength={2000}
          editable={isConnected && !isSending && !uploading}
        />
        {isSending || uploading ? (
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
  bubbleUser: { backgroundColor: colors.primary, borderBottomRightRadius: radius.sm },
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
  msgImage: {
    width: 180,
    height: 180,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    marginBottom: 4,
  },
  fileCard: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: 200,
    marginBottom: 4,
  },
  fileName: { color: colors.text, fontSize: fontSize.sm, fontWeight: "600" },
  fileSize: { color: colors.textFaint, fontSize: 10, marginTop: 1 },
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
  draftBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  draftName: { color: colors.textMuted, fontSize: fontSize.sm, flex: 1 },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  attachBtn: { width: 36, height: 40, alignItems: "center", justifyContent: "center" },
  input: {
    flex: 1,
    backgroundColor: colors.inputBg,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
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
});
