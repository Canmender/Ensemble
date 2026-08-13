/**
 * 聊天室页面（微信式：从会话列表卡片点击进入）
 * 消息历史 / WS 实时 / 断线重连补拉 / 未读清零 / 图片与文件附件。
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Keyboard,
  ActivityIndicator,
  Image,
  Alert,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api, type Conversation, type UserInfo } from "../services/api";
import { useDeviceStore } from "../store/deviceStore";
import { wsLink } from "../services/wslink";
import { EmptyState } from "../components/ui";
import { colors, spacing, radius, fontSize } from "../theme";
import type { AgentConfig, MessageAttachment, MessageReply } from "@ensemble/shared-protocol";
import type { RootStackParamList } from "../App";

type Props = NativeStackScreenProps<RootStackParamList, "ChatRoom">;

type MessageItem = {
  id: string;
  role: "user" | "assistant";
  content: string;
  agentName?: string;
  attachment?: MessageAttachment;
  replyTo?: MessageReply;
  deleted?: boolean;
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
  // 键盘高度（Android 15+/edge-to-edge 下 adjustResize 失效，需手动顶起输入栏）
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // 长按操作菜单：当前长按的消息 / 引用中的消息 / 待转发的消息 / 转发目标会话列表
  const [menuMsg, setMenuMsg] = useState<MessageItem | null>(null);
  const [quoting, setQuoting] = useState<MessageReply | null>(null);
  const [forwardMsg, setForwardMsg] = useState<MessageItem | null>(null);
  const [forwardConversations, setForwardConversations] = useState<Conversation[]>([]);
  // 附件下载中（防重复点击）
  const [downloading, setDownloading] = useState(false);
  // 已读回执：当前用户 id + 对方最后已读时间（自己消息 ts ≤ 该时间 → 显示「已读」）
  const [meId, setMeId] = useState<string | undefined>();
  const [peerReadTs, setPeerReadTs] = useState<number | undefined>();
  // 用户/Agent 列表（消息发送者昵称解析）
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
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
        // 标题优先用进入时传入的（ChatPage 已解析为昵称）；缺省回退会话 title
        if (!title) navigation.setOptions({ title: c.title || "聊天" });
      }
    });
  }, [convId, runId, title, navigation]);

  // 用户/Agent 列表（解析消息发送者昵称，不直接显示 user id / agent id）
  useEffect(() => {
    void api.getUsers().then((r) => {
      if (r.data) setUsers(r.data);
    });
    void api.getAgents().then((r) => {
      if (r.data) setAgents(r.data);
    });
  }, []);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  /** 发送者显示名：用户-用户会话显示对方昵称，agent 会话显示 agent 名 */
  const resolveSenderName = useCallback(
    (agentId: string): string => {
      if (conv?.runId.startsWith("conv_")) {
        const u = usersById.get(agentId);
        return u ? u.displayName || u.username || agentId : agentId;
      }
      const a = agentsById.get(agentId);
      return a ? a.name : agentId;
    },
    [conv, usersById, agentsById],
  );

  /** 是否自己发送的消息（用户-用户会话按发送者 id，agent 会话按 role）——决定能否撤回 */
  const isMyMessage = useCallback(
    (item: MessageItem): boolean => {
      const isUserConv = !!conv && conv.runId.startsWith("conv_");
      return isUserConv
        ? item.agentName === meId || item.id.startsWith("u-")
        : item.role === "user";
    },
    [conv, meId],
  );

  // 加载消息历史 + 已读回执（readers）+ 已读清零；发送成功后也调用以刷新真实 msgId（撤回可用）
  const loadMessages = useCallback(async () => {
    const [histRes, meRes] = await Promise.all([api.getConversationMessages(convId), api.getMe()]);
    if (histRes.data) {
      setMessages(
        histRes.data.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          agentName: m.agentId,
          attachment: m.attachment,
          replyTo: m.replyTo,
          deleted: m.deleted,
          ts: m.ts,
        })),
      );
      const me = meRes.data?.id;
      if (me) setMeId(me);
      const readers = histRes.data.readers ?? [];
      const peer = readers.find((r) => r.userId !== me);
      setPeerReadTs(peer?.readTs ? new Date(peer.readTs).getTime() : undefined);
    }
    void api.markConversationRead(convId);
  }, [convId]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

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
              replyTo: msg.replyTo,
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
      void loadMessages();
    }
  }, [connectionState, loadMessages]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length, keyboardHeight]);

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
      const res = await api.sendConversationMessage(
        convId,
        text,
        draftAttachment ?? undefined,
        quoting ?? undefined,
      );
      if (res.error) {
        setSendError(res.error);
        return;
      }
      setMessages((prev) =>
        appendMessage(prev, {
          id: `u-${Date.now()}`,
          role: "user",
          content: text,
          attachment: draftAttachment ?? undefined,
          replyTo: quoting ?? undefined,
          ts: new Date().toISOString(),
        }),
      );
      setInputText("");
      setDraftAttachment(null);
      setQuoting(null);
      // 刷新历史拿到真实 msgId（撤回可用）
      void loadMessages();
      // 保持输入框聚焦，键盘不收起，方便连续发送
      setTimeout(() => inputRef.current?.focus(), 80);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setIsSending(false);
    }
  }, [inputText, convId, draftAttachment, quoting, isConnected, isSending, uploading, loadMessages]);

  // 撤回消息（长按自己的消息触发）
  const recallMessage = useCallback(
    (msg: MessageItem) => {
      Alert.alert("撤回消息", "撤回后对方将看不到该消息，确定？", [
        { text: "取消", style: "cancel" },
        {
          text: "撤回",
          style: "destructive",
          onPress: () => {
            void (async () => {
              const res = await api.recallMessage(convId, msg.id);
              if (res.error) {
                setSendError(res.error);
                return;
              }
              setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, deleted: true } : m)));
            })();
          },
        },
      ]);
    },
    [convId],
  );

  /** 长按菜单 → 引用：记录被引用消息，输入栏显示引用条 */
  const startQuote = useCallback(() => {
    if (!menuMsg) return;
    setQuoting({
      id: menuMsg.id,
      content: menuMsg.content || "[附件]",
      agentName: menuMsg.agentName ? resolveSenderName(menuMsg.agentName) : undefined,
    });
    setMenuMsg(null);
  }, [menuMsg, resolveSenderName]);

  /** 长按菜单 → 转发：加载目标会话列表 */
  const startForward = useCallback(() => {
    if (!menuMsg) return;
    setMenuMsg(null);
    setForwardMsg(menuMsg);
    void api.getConversations().then((res) => {
      setForwardConversations((res.data ?? []).filter((c) => c.id !== convId));
    });
  }, [menuMsg, convId]);

  /** 转发目标会话显示名（用户会话用参与者昵称，避免显示 user id） */
  const targetTitle = useCallback(
    (c: Conversation): string => {
      if (c.runId.startsWith("conv_")) {
        const names = (c.participantIds ?? []).map((pid) => {
          const u = usersById.get(pid);
          return u ? u.displayName || u.username || pid : pid;
        });
        return names.join(", ") || "会话";
      }
      return c.title || (c.participantIds ?? []).join(", ") || "会话";
    },
    [usersById],
  );

  /** 转发消息到目标会话（文本 + 附件原样发送） */
  const doForward = useCallback(
    async (target: Conversation) => {
      const fw = forwardMsg;
      if (!fw) return;
      const res = await api.sendConversationMessage(target.id, fw.content, fw.attachment);
      setForwardMsg(null);
      setForwardConversations([]);
      if (res.error) {
        setSendError(res.error);
      } else {
        Alert.alert("已转发", `已转发到「${targetTitle(target)}」`);
      }
    },
    [forwardMsg, targetTitle],
  );

  // WS 撤回事件：对方撤回时实时标记
  useEffect(() => {
    wsLink.on({
      onChatDeleted: ({ msgId }) => {
        setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, deleted: true } : m)));
      },
    });
  }, []);

  // 键盘弹出/收起监听（Android 15+/edge-to-edge 下 windowSoftInputMode 不生效，手动顶起输入栏）
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) =>
      setKeyboardHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

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

  // 下载附件到本地 downloads/ 目录，并调起系统分享/保存面板
  const downloadAttachment = useCallback(
    async (att: MessageAttachment) => {
      if (downloading) return;
      setDownloading(true);
      setSendError(null);
      try {
        const url = attachUrl(att.url);
        const dir = `${FileSystem.documentDirectory}downloads/`;
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
        const safeName = (att.name || `attachment-${Date.now()}`).replace(/[\\/:*?"<>|]/g, "_");
        const dest = `${dir}${safeName}`;
        const result = await FileSystem.downloadAsync(url, dest);
        if (result.status !== 200) {
          setSendError("下载失败");
          return;
        }
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(dest, { mimeType: att.mime, dialogTitle: att.name });
        } else {
          Alert.alert("已下载", `已保存到 ${dest}`);
        }
      } catch (err) {
        setSendError(err instanceof Error ? err.message : "下载失败");
      } finally {
        setDownloading(false);
      }
    },
    [downloading],
  );

  const renderAttachment = (att: MessageAttachment, isUser: boolean) => {
    if (att.type === "image") {
      return (
        <View style={{ alignItems: "flex-start" }}>
          <Image source={{ uri: attachUrl(att.url) }} style={styles.msgImage} resizeMode="cover" />
          <TouchableOpacity
            style={styles.dlBtn}
            onPress={() => void downloadAttachment(att)}
            disabled={downloading}
            activeOpacity={0.7}
          >
            <Ionicons name="download-outline" size={13} color={isUser ? "#fff" : colors.primary} />
            <Text style={[styles.dlBtnText, isUser && { color: "#fff" }]}>
              {downloading ? "下载中…" : "下载"}
            </Text>
          </TouchableOpacity>
        </View>
      );
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
        <TouchableOpacity
          onPress={() => void downloadAttachment(att)}
          disabled={downloading}
          hitSlop={8}
        >
          <Ionicons
            name={downloading ? "hourglass-outline" : "download-outline"}
            size={18}
            color={isUser ? "#fff" : colors.primary}
          />
        </TouchableOpacity>
      </View>
    );
  };

  const renderMessage = ({ item }: { item: MessageItem }) => {
    const isUser = isMyMessage(item);
    const isRead = isUser && peerReadTs !== undefined && new Date(item.ts).getTime() <= peerReadTs;
    return (
      <View style={[styles.msgRow, isUser ? styles.msgRowUser : styles.msgRowAgent]}>
        <TouchableOpacity
          style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAgent]}
          activeOpacity={0.6}
          delayLongPress={350}
          onLongPress={() => setMenuMsg(item)}
        >
          {item.deleted ? (
            <Text style={[styles.bubbleText, styles.deletedText]}>消息已撤回</Text>
          ) : (
            <>
              {item.replyTo && (
                <View style={[styles.quoteBlock, isUser ? styles.quoteBlockUser : styles.quoteBlockAgent]}>
                  <Text style={[styles.quoteText, isUser && styles.quoteTextUser]} numberOfLines={2}>
                    {item.replyTo.agentName ? `${item.replyTo.agentName}: ` : ""}
                    {item.replyTo.content || "[附件]"}
                  </Text>
                </View>
              )}
              {!isUser && item.agentName && (
                <Text style={styles.bubbleAgentName}>{resolveSenderName(item.agentName)}</Text>
              )}
              {item.attachment && renderAttachment(item.attachment, isUser)}
              {!!item.content && (
                <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>{item.content}</Text>
              )}
            </>
          )}
          <View style={[styles.bubbleMeta, isUser && styles.bubbleMetaUser]}>
            <Text style={[styles.bubbleTime, isUser && styles.bubbleTimeUser]}>
              {new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </Text>
            {isUser && !item.deleted && isRead && <Text style={styles.bubbleRead}>已读</Text>}
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  const canSend = (inputText.trim() || !!draftAttachment) && isConnected && !isSending && !uploading;

  return (
    <View style={styles.container}>
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

      {/* 引用回复条 */}
      {quoting && (
        <View style={styles.draftBar}>
          <Ionicons name="return-down-back" size={16} color={colors.textMuted} />
          <Text style={styles.draftName} numberOfLines={1}>
            回复{quoting.agentName ? ` ${quoting.agentName}` : ""}: {quoting.content}
          </Text>
          <TouchableOpacity onPress={() => setQuoting(null)} hitSlop={8}>
            <Ionicons name="close" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* 输入栏（键盘弹出时 paddingBottom 顶起，避免被输入法遮挡） */}
      <View style={[styles.inputBar, { paddingBottom: keyboardHeight + spacing.md }]}>
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
          ref={inputRef}
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
          // editable 不随 isSending 切换（editable 变 false 会让输入框失焦收起键盘）
          editable={isConnected && !uploading}
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

      {/* 长按消息操作菜单：引用 / 转发 / 撤回（仅自己的消息） */}
      <Modal
        transparent
        visible={!!menuMsg}
        animationType="fade"
        onRequestClose={() => setMenuMsg(null)}
      >
        <TouchableOpacity
          style={styles.menuOverlay}
          activeOpacity={1}
          onPress={() => setMenuMsg(null)}
        >
          <View style={styles.actionSheet}>
            <TouchableOpacity style={styles.actionItem} onPress={startQuote} activeOpacity={0.7}>
              <Ionicons name="chatbox-ellipses-outline" size={20} color={colors.text} />
              <Text style={styles.actionText}>引用</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionItem} onPress={startForward} activeOpacity={0.7}>
              <Ionicons name="arrow-redo-outline" size={20} color={colors.text} />
              <Text style={styles.actionText}>转发</Text>
            </TouchableOpacity>
            {menuMsg && isMyMessage(menuMsg) && !menuMsg.deleted && (
              <TouchableOpacity
                style={styles.actionItem}
                onPress={() => {
                  setMenuMsg(null);
                  recallMessage(menuMsg);
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
                <Text style={[styles.actionText, { color: colors.danger }]}>撤回</Text>
              </TouchableOpacity>
            )}
            <View style={styles.actionDivider} />
            <TouchableOpacity
              style={styles.actionItem}
              onPress={() => setMenuMsg(null)}
              activeOpacity={0.7}
            >
              <Text style={[styles.actionText, styles.actionCancel]}>取消</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 转发目标会话选择 */}
      <Modal
        transparent
        visible={!!forwardMsg}
        animationType="slide"
        onRequestClose={() => {
          setForwardMsg(null);
          setForwardConversations([]);
        }}
      >
        <View style={styles.forwardOverlay}>
          <View style={styles.forwardSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>转发到…</Text>
              <TouchableOpacity
                onPress={() => {
                  setForwardMsg(null);
                  setForwardConversations([]);
                }}
                hitSlop={8}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {forwardConversations.length === 0 ? (
              <EmptyState
                icon={<Ionicons name="chatbubbles-outline" size={28} color={colors.textFaint} />}
                title="暂无其他会话"
                subtitle="先创建会话再转发"
              />
            ) : (
              <FlatList
                data={forwardConversations}
                keyExtractor={(c) => c.id}
                extraData={usersById}
                renderItem={({ item: c }) => (
                  <TouchableOpacity
                    style={styles.forwardItem}
                    onPress={() => void doForward(c)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.forwardAvatar}>
                      <Ionicons
                        name={c.runId.startsWith("conv_") ? "person" : c.type === "group" ? "people" : "flash"}
                        size={20}
                        color={colors.primary}
                      />
                    </View>
                    <Text style={styles.forwardTitle} numberOfLines={1}>
                      {targetTitle(c)}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
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
  deletedText: { fontStyle: "italic", opacity: 0.5 },
  bubbleMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  bubbleMetaUser: { justifyContent: "flex-end" },
  bubbleTime: { color: colors.textFaint, fontSize: 10 },
  bubbleTimeUser: { color: "rgba(255,255,255,0.7)" },
  bubbleRead: { color: "#fff", fontSize: 10, fontWeight: "600" },
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
  dlBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  dlBtnText: { color: colors.primary, fontSize: 11, fontWeight: "600" },
  // 引用回复块
  quoteBlock: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginBottom: 4,
    borderLeftWidth: 3,
  },
  quoteBlockAgent: { backgroundColor: colors.surfaceAlt, borderLeftColor: colors.primary },
  quoteBlockUser: { backgroundColor: "rgba(255,255,255,0.18)", borderLeftColor: "#fff" },
  quoteText: { color: colors.textMuted, fontSize: fontSize.xs, lineHeight: 16 },
  quoteTextUser: { color: "rgba(255,255,255,0.85)" },
  // 长按操作菜单
  menuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  actionSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingBottom: spacing.xl,
  },
  actionItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
  actionCancel: { color: colors.textMuted, textAlign: "center", flex: 1 },
  actionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  // 转发目标选择
  forwardOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  forwardSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: "70%",
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
  forwardItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  forwardAvatar: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  forwardTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: "500", flex: 1 },
});
