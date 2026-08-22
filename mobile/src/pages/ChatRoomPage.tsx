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
  PanResponder,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api, type Conversation, type UserInfo } from "../services/api";
import { useDeviceStore } from "../store/deviceStore";
import { useUnreadStore } from "../store/unreadStore";
import { useMeStore } from "../store/meStore";
import { wsLink } from "../services/wslink";
import { startCall } from "../services/callService";
import { EmptyState } from "../components/ui";
import { Avatar } from "../components/Avatar";
import { EmojiPicker } from "../components/EmojiPicker";
import { SmartMenu } from "../components/SmartMenu";
import { VoiceRecorder } from "../components/VoiceRecorder";
import { VoiceMessage } from "../components/VoiceMessage";
import { timeAgo } from "../utils/timeAgo";
import { convTitle } from "../utils/convTitle";
import { saveDraft, loadDraft, clearDraft } from "../utils/draft";
import { colors, spacing, radius, fontSize } from "../theme";
import { LiquidGlass } from "../components/Glass";
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
  mentions?: string[];
  deleted?: boolean;
  ts: string;
};

/** 相邻去重：WS 回显 + 乐观追加会产生相同消息（如群聊/agent 会话里自己的发言），按 content + role 合并 */
function appendMessage(list: MessageItem[], msg: MessageItem): MessageItem[] {
  const last = list[list.length - 1];
  if (last && last.content === msg.content && last.role === msg.role) return list;
  const next = [...list, msg];
  // 消息裁剪：超过 100 条时裁剪为最新 50 条（防内存溢出，对齐 box-im/V-IM）
  return next.length > 100 ? next.slice(-50) : next;
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
  const [showDetailModal, setShowDetailModal] = useState(false);
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
  // 多选模式（合并转发）
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 附件下载中（防重复点击）
  const [downloading, setDownloading] = useState(false);
  // 「+」扩展栏（相册/视频/文件）与全屏查看附件
  const [showExtend, setShowExtend] = useState(false);
  const [viewerAttachment, setViewerAttachment] = useState<MessageAttachment | null>(null);
  // 表情面板
  const [showEmoji, setShowEmoji] = useState(false);
  // 语音录制模式
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  // 联系人资料面板（左滑触发）
  const [showProfile, setShowProfile] = useState(false);
  // 右上角 ≡ 菜单
  // 消息分页：首屏 20 条，滚动到顶部加载更多
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // @提及：输入框中 @ 触发参与者选择列表
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  // 已读回执：当前用户 id + 对方最后已读时间（自己消息 ts ≤ 该时间 → 显示「已读」）
  const [meId, setMeId] = useState<string | undefined>();
  const [peerReadTs, setPeerReadTs] = useState<number | undefined>();
  // 群聊已读：每个成员的最后已读时间 Map<userId, timestamp>
  const [groupReadTs, setGroupReadTs] = useState<Map<string, number>>(new Map());
  // 用户/Agent 列表（消息发送者昵称解析）
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const flatListRef = useRef<FlatList>(null);
  const scrollYRef = useRef(0);
  const inputRef = useRef<TextInput>(null);
  const activeRunIdRef = useRef<string | null>(null);
  // 防重复提交：记录最后一次发送内容和时间
  const lastSendRef = useRef<{ content: string; ts: number }>({ content: "", ts: 0 });
  // 左滑手势：从右边缘向左滑动触发联系人资料面板
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // 从屏幕右半部分开始，向左滑动超过 50px
        return gestureState.dx < -50 && Math.abs(gestureState.dy) < 30;
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -80) {
          setShowProfile(true);
        }
      },
    }),
  ).current;

  const isConnected = connectionState === "connected";
  // 附件仅支持用户-用户会话（agent 链路只处理文本）；用户会话 runId 以 conv_ 开头
  const canSendAttachment = !!conv && conv.runId.startsWith("conv_");

  // 会话信息（runId/标题），设置导航标题；群聊显示设置按钮
  useEffect(() => {
    activeRunIdRef.current = runId ?? null;
    if (title) navigation.setOptions({ title });
    void api.getConversations().then((res) => {
      const c = res.data?.find((x) => x.id === convId);
      if (c) {
        setConv(c);
        activeRunIdRef.current = c.runId;
        // 当前会话新消息不弹通知、不计未读；该会话未读从总数中扣除
        useUnreadStore.getState().setLastActiveConvId(c.runId);
        if (c.unread > 0) {
          const cur = useUnreadStore.getState().totalUnread;
          useUnreadStore.getState().setTotalUnread(Math.max(0, cur - c.unread));
        }
        // 标题优先用进入时传入的（ChatPage 已解析为昵称）；缺省回退会话 title
        if (!title) navigation.setOptions({ title: c.title || "聊天" });
        // header 右侧：横三杠「≡」按钮 → 用户/群聊详情页
        navigation.setOptions({
          headerRight: () => (
            <TouchableOpacity
              onPress={() => {
                if (!c.runId.startsWith("conv_")) {
                  // 群聊 → 群聊详情页
                  navigation.navigate("GroupSettings", { convId: c.id, title: c.title || title });
                } else {
                  // 1:1 用户会话 → 用户详情页
                  const peer = callPeer(c);
                  const u = peer ? usersById.get(peer.userId) : undefined;
                  navigation.navigate("UserProfile", {
                    userId: peer?.userId ?? "",
                    name: u?.displayName || u?.username || peer?.name || "",
                    username: u?.username ?? "",
                    displayName: u?.displayName ?? "",
                  });
                }
              }}
              hitSlop={8}
              style={{ marginRight: 4 }}
            >
              <Ionicons name="menu" size={24} color={colors.primary} />
            </TouchableOpacity>
          ),
        });
      }
    });
  }, [convId, runId, title, navigation]);

  // 退出会话：清除活跃标记（恢复通知 / 未读统计）
  useEffect(() => {
    return () => useUnreadStore.getState().setLastActiveConvId(null);
  }, []);

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

  /** 1:1 用户会话的对方（发起方 userId / participantIds 中非我者的真实用户），供语音通话发起 */
  function callPeer(c: Conversation | null) {
    if (!c) return null;
    const me = useMeStore.getState().me?.id;
    const candidates: string[] = [];
    if (c.participantIds) candidates.push(...c.participantIds);
    if (c.userId) candidates.push(c.userId);
    for (const uid of candidates) {
      if (!uid || uid === me) continue;
      const u = usersById.get(uid);
      if (u) return { userId: uid, name: u.displayName || u.username || uid };
    }
    return null;
  }

  // @提及：可@的参与者列表（排除自己）
  const mentionableParticipants = useMemo(() => {
    if (!conv) return [];
    const me = useDeviceStore.getState().connectedDevice?.id;
    const items: Array<{ id: string; name: string }> = [];
    for (const pid of conv.participantIds) {
      if (pid === meId) continue;
      const u = usersById.get(pid);
      if (u) { items.push({ id: pid, name: u.displayName || u.username || pid }); continue; }
      const a = agentsById.get(pid);
      if (a) items.push({ id: pid, name: a.name });
    }
    return items;
  }, [conv, usersById, agentsById, meId]);

  // @提及：输入框输入时检测 @，显示/隐藏 picker，支持按名称过滤；同时保存草稿
  const onInputChange = useCallback((text: string) => {
    setInputText(text);
    if (sendError) setSendError(null);
    // 保存草稿（防抖：直接保存，AsyncStorage 写入很快）
    void saveDraft(convId, text);
    // 检测最后一个 @ 触发 picker（@ 在最后一个 \n 或空格之后）
    const lastAt = text.lastIndexOf("@");
    if (lastAt >= 0 && (lastAt === 0 || /[\s\n]/.test(text[lastAt - 1]))) {
      const query = text.slice(lastAt + 1);
      if (!/[\s\n]/.test(query) && mentionableParticipants.length > 0) {
        setMentionFilter(query);
        setShowMentionPicker(true);
        return;
      }
    }
    setShowMentionPicker(false);
  }, [sendError, mentionableParticipants]);

  // @提及：选中参与者后，替换 @query 为 @名称 + 空格
  const selectMention = useCallback((item: { id: string; name: string }) => {
    const lastAt = inputText.lastIndexOf("@");
    if (lastAt < 0) { setShowMentionPicker(false); return; }
    const before = inputText.slice(0, lastAt);
    const newText = `${before}@${item.name} `;
    setInputText(newText);
    setShowMentionPicker(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [inputText]);

  /** 解析文本中的 @提及 → 被@的参与者 ID 列表 */
  const parseMentions = useCallback(
    (text: string): string[] => {
      if (!conv) return [];
      const mentioned: string[] = [];
      const re = /@([\p{L}\p{N}_]{1,20})/gu;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const name = m[1];
        for (const p of mentionableParticipants) {
          if (!mentioned.includes(p.id) && p.name === name) {
            mentioned.push(p.id);
          }
        }
      }
      return mentioned;
    },
    [conv, mentionableParticipants],
  );

  /** 发送者显示名：用户显示昵称，agent 显示名（群聊 / 混合群通用） */
  const resolveSenderName = useCallback(
    (agentId: string): string => {
      const u = usersById.get(agentId);
      if (u) return u.displayName || u.username || agentId;
      const a = agentsById.get(agentId);
      return a ? a.name : agentId;
    },
    [usersById, agentsById],
  );

  /** 是否自己发送的消息（用户-用户会话按发送者 id；direct agent / 群聊按发送者判定） */
  const isMyMessage = useCallback(
    (item: MessageItem): boolean => {
      const isUserConv = !!conv && conv.runId.startsWith("conv_");
      if (isUserConv) return item.agentName === meId || item.id.startsWith("u-");
      // direct agent / 群聊（含人+Agent 混合群）：用户消息按发送者判定（自己 / "user" 回显 / 乐观追加）
      return (
        item.role === "user" &&
        (item.agentName === meId || item.agentName === "user" || item.id.startsWith("u-"))
      );
    },
    [conv, meId],
  );

  // 加载消息历史（首屏 20 条）+ 已读回执（readers）+ 已读清零
  const loadMessages = useCallback(async () => {
    const [histRes, meRes] = await Promise.all([
      api.getConversationMessages(convId, undefined, 20),
      api.getMe(),
    ]);
    if (histRes.data) {
      setMessages(
        histRes.data.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          agentName: m.agentId,
          attachment: m.attachment,
          replyTo: m.replyTo,
          mentions: m.mentions,
          deleted: m.deleted,
          ts: m.ts,
        })),
      );
      setHasMore(histRes.data.messages.length >= 20);
      const me = meRes.data?.id;
      if (me) setMeId(me);
      const readers = histRes.data.readers ?? [];
      const isGroup = conv && !conv.runId.startsWith("conv_");
      if (isGroup) {
        // 群聊：收集所有成员已读时间
        const readMap = new Map<string, number>();
        for (const r of readers) {
          if (r.userId !== me && r.readTs) {
            const ts = new Date(r.readTs).getTime();
            if (!Number.isNaN(ts)) readMap.set(r.userId, ts);
          }
        }
        setGroupReadTs(readMap);
      } else {
        // 私聊：找对方已读时间
        const peer = readers.find((r) => r.userId !== me);
        setPeerReadTs(peer?.readTs ? new Date(peer.readTs).getTime() : undefined);
      }
    }
    void api.markConversationRead(convId);
  }, [convId]);

  // 加载更多消息（滚动到顶部时调用，保持视口位置）
  const loadMoreMessages = useCallback(async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = messages[0];
      // 记录当前滚动位置（加载后恢复）；FlatList 无 getScrollOffset，改用 onScroll 跟踪
      const scrollOffset = scrollYRef.current;
      const res = await api.getConversationMessages(convId, oldest.ts, 20);
      if (res.data && res.data.messages.length > 0) {
        const older = res.data.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          agentName: m.agentId,
          attachment: m.attachment,
          replyTo: m.replyTo,
          mentions: m.mentions,
          deleted: m.deleted,
          ts: m.ts,
        }));
        const prevCount = messages.length;
        setMessages((prev) => [...older, ...prev]);
        setHasMore(res.data.messages.length >= 20);
        // 恢复滚动位置（新消息插入后视口不动）
        const addedCount = older.length;
        if (addedCount > 0) {
          setTimeout(() => {
            flatListRef.current?.scrollToOffset({ offset: scrollOffset + addedCount * 80, animated: false });
          }, 50);
        }
      } else {
        setHasMore(false);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [convId, messages, loadingMore, hasMore]);

  useEffect(() => {
    void loadMessages();
    // 加载草稿
    void loadDraft(convId).then((draft) => {
      if (draft) setInputText(draft);
    });
  }, [loadMessages, convId]);

  // WS 实时：新消息推送到当前会话
  useEffect(() => {
    const unsub = wsLink.on({
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
              mentions: msg.mentions,
              ts: new Date().toISOString(),
            }),
          );
          // 正在看当前会话：收到消息即时重新标记已读（对方实时看到「已读」）
          void api.markConversationRead(convId);
        }
      },
    });
    return unsub;
  }, [convId]);

  // 已读回执实时更新：对方读了会话 → 更新已读状态
  useEffect(() => {
    const unsub = wsLink.on({
      onChatRead: ({ runId, userId, readTs }) => {
        if (runId === activeRunIdRef.current && userId !== meId) {
          const ts = new Date(readTs).getTime();
          if (!Number.isNaN(ts)) {
            const isGroup = conv && !conv.runId.startsWith("conv_");
            if (isGroup) {
              setGroupReadTs((prev) => new Map(prev).set(userId, ts));
            } else {
              setPeerReadTs((prev) => (prev === undefined || ts > prev ? ts : prev));
            }
          }
        }
      },
    });
    return unsub;
  }, [meId, conv]);

  // 断线重连后增量补拉当前会话新消息（只拉最后一条消息之后的）
  const prevConnRef = useRef(connectionState);
  useEffect(() => {
    const prev = prevConnRef.current;
    prevConnRef.current = connectionState;
    if (connectionState === "connected" && prev !== "connected") {
      // 增量拉取：用最后一条消息的时间戳作为 before 游标
      const lastTs = messages.length > 0 ? messages[messages.length - 1].ts : undefined;
      if (lastTs) {
        void (async () => {
          const res = await api.getConversationMessages(convId, undefined, 100);
          if (res.data) {
            const newMsgs = res.data.messages
              .filter((m) => m.ts > lastTs)
              .map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                agentName: m.agentId,
                attachment: m.attachment,
                replyTo: m.replyTo,
                mentions: m.mentions,
                deleted: m.deleted,
                ts: m.ts,
              }));
            if (newMsgs.length > 0) {
              setMessages((prev) => {
                const existingIds = new Set(prev.map((m) => m.id));
                const fresh = newMsgs.filter((m) => !existingIds.has(m.id));
                return fresh.length > 0 ? [...prev, ...fresh] : prev;
              });
            }
          }
          void api.markConversationRead(convId);
        })();
      } else {
        void loadMessages();
      }
    }
  }, [connectionState, loadMessages, convId, messages]);

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

  // 发送文本 / 附件（带重试：最多 3 次）
  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if ((!text && !draftAttachment) || !isConnected || isSending || uploading) return;
    // 防重复提交：2 秒内相同内容不重复发送
    if (text && text === lastSendRef.current.content && Date.now() - lastSendRef.current.ts < 2000) return;
    lastSendRef.current = { content: text, ts: Date.now() };
    setIsSending(true);
    setSendError(null);
    const tempId = `u-${Date.now()}`;
    const mentions = parseMentions(text);
    // 乐观追加（临时 ID）
    setMessages((prev) =>
      appendMessage(prev, {
        id: tempId,
        role: "user",
        content: text,
        attachment: draftAttachment ?? undefined,
        replyTo: quoting ?? undefined,
        mentions: mentions.length > 0 ? mentions : undefined,
        ts: new Date().toISOString(),
      }),
    );
    setInputText("");
    setDraftAttachment(null);
    setQuoting(null);
    setShowMentionPicker(false);
    setTimeout(() => inputRef.current?.focus(), 80);

    // 重试逻辑：最多 3 次，间隔递增
    let lastError: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await api.sendConversationMessage(
          convId,
          text,
          draftAttachment ?? undefined,
          quoting ?? undefined,
          mentions.length > 0 ? mentions : undefined,
        );
        if (res.error) {
          lastError = res.error;
          if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        // 发送成功：用真实 msgId 替换乐观消息
        if (res.data?.msgId) {
          setMessages((prev) => prev.map((m) => m.id === tempId ? { ...m, id: res.data!.msgId! } : m));
        }
        void clearDraft(convId);
        setIsSending(false);
        void loadMessages();
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : "发送失败";
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    // 3 次都失败
    setSendError(lastError || "发送失败，请重试");
    setIsSending(false);
  }, [inputText, convId, draftAttachment, quoting, isConnected, isSending, uploading, loadMessages, parseMentions]);

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

  /** 长按菜单 → 多选转发：进入多选模式 */
  const startMultiSelect = useCallback(() => {
    if (!menuMsg) return;
    setMenuMsg(null);
    setSelectMode(true);
    setSelectedIds(new Set([menuMsg.id]));
  }, [menuMsg]);

  /** 多选模式：切换选中状态 */
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  /** 多选模式：合并转发选中消息 */
  const forwardSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    void api.getConversations().then((res) => {
      setForwardConversations((res.data ?? []).filter((c) => c.id !== convId));
    });
  }, [selectedIds, convId]);

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

  /** 转发消息到目标会话（文本 + 附件原样发送；多选时合并文本） */
  const doForward = useCallback(
    async (target: Conversation) => {
      if (selectMode && selectedIds.size > 0) {
        // 合并转发：拼接多条消息文本
        const selected = messages.filter((m) => selectedIds.has(m.id) && !m.deleted);
        const merged = selected.map((m) => {
          const name = m.agentName ? resolveSenderName(m.agentName) : "";
          return `${name ? name + ": " : ""}${m.content || "[附件]"}`;
        }).join("\n");
        const res = await api.sendConversationMessage(target.id, merged);
        setSelectMode(false);
        setSelectedIds(new Set());
        setForwardConversations([]);
        if (res.error) { setSendError(res.error); } else { Alert.alert("已转发", `已转发到「${targetTitle(target)}」`); }
        return;
      }
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
    [forwardMsg, targetTitle, selectMode, selectedIds, messages, resolveSenderName],
  );

  // WS 撤回事件：对方撤回时实时标记
  useEffect(() => {
    const unsub = wsLink.on({
      onChatDeleted: ({ msgId }) => {
        setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, deleted: true } : m)));
      },
    });
    return unsub;
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
    setSendError(null);
    try {
      const sizeMB = Math.round((base64.length * 3) / 4 / 1024 / 1024);
      if (sizeMB > 10) setSendError(`上传中…（${sizeMB}MB）`);
      const res = await api.uploadAttachment({ name, mime, data: base64 });
      if (res.error) {
        setSendError(res.error);
        return;
      }
      const up = res.data!;
      setDraftAttachment({
        type: up.type === "image" ? "image" : up.mime?.startsWith("audio/") ? "audio" as any : "file",
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
    if ((asset.fileSize ?? 0) > 100 * 1024 * 1024) {
      setSendError("图片过大（上限 100MB）");
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
    if ((asset.size ?? 0) > 100 * 1024 * 1024) {
      setSendError("文件过大（上限 100MB）");
      return;
    }
    const base64 = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await doUpload(asset.name ?? "file", asset.mimeType ?? "application/octet-stream", base64);
  }, [doUpload]);

  // 选择视频（expo-image-picker 视频不返回 base64，经 FileSystem 读取上传）
  const pickVideo = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setSendError("需要相册权限才能发送视频");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"] });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if ((asset.fileSize ?? 0) > 100 * 1024 * 1024) {
      setSendError("视频过大（上限 100MB）");
      return;
    }
    const base64 = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await doUpload(asset.fileName ?? "video.mp4", asset.mimeType ?? "video/mp4", base64);
  }, [doUpload]);

  // 选择音频文件
  const pickAudio = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: "audio/*",
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if ((asset.size ?? 0) > 50 * 1024 * 1024) {
      setSendError("音频过大（上限 50MB）");
      return;
    }
    const base64 = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await doUpload(asset.name ?? "audio.mp3", asset.mimeType ?? "audio/mpeg", base64);
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

  const renderAttachment = (att: MessageAttachment, isUser: boolean, content?: string) => {
    if (att.type === "image") {
      // 图片完整显示，点击全屏查看（全屏界面可下载）
      return (
        <TouchableOpacity onPress={() => setViewerAttachment(att)} activeOpacity={0.85} disabled={!!downloading}>
          <Image source={{ uri: attachUrl(att.url) }} style={styles.msgImage} resizeMode="contain" />
        </TouchableOpacity>
      );
    }
    if (att.type === "audio") {
      // 语音消息：点击播放/暂停
      return <VoiceMessage url={attachUrl(att.url)} isUser={isUser} durationText={content} />;
    }
    return (
      <TouchableOpacity
        style={styles.fileCard}
        onPress={() => setViewerAttachment(att)}
        activeOpacity={0.85}
        disabled={!!downloading}
      >
        <Ionicons
          name={att.type === "video" ? "videocam" : "document-text"}
          size={20}
          color={isUser ? "#fff" : colors.primary}
        />
        <View style={{ flex: 1, marginLeft: spacing.sm }}>
          <Text style={[styles.fileName, isUser && { color: "#fff" }]} numberOfLines={1}>
            {att.name}
          </Text>
          <Text style={[styles.fileSize, isUser && { color: "rgba(255,255,255,0.7)" }]}>
            {fmtSize(att.size)}
          </Text>
        </View>
        <TouchableOpacity
          onPress={(e) => {
            e.stopPropagation();
            void downloadAttachment(att);
          }}
          disabled={downloading}
          hitSlop={8}
        >
          <Ionicons
            name={downloading ? "hourglass-outline" : "download-outline"}
            size={18}
            color={isUser ? "#fff" : colors.primary}
          />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderMessage = ({ item }: { item: MessageItem }) => {
    const isUser = isMyMessage(item);
    const isGroup = conv && !conv.runId.startsWith("conv_");
    // 已读状态：私聊看 peerReadTs，群聊看多少人已读
    const msgTs = new Date(item.ts).getTime();
    let readLabel = "";
    if (isUser && !item.deleted) {
      if (isGroup) {
        const readCount = [...groupReadTs.values()].filter((ts) => ts >= msgTs).length;
        readLabel = readCount > 0 ? `已读 ${readCount}人` : "未读";
      } else {
        readLabel = peerReadTs !== undefined ? (msgTs <= peerReadTs ? "已读" : "未读") : "";
      }
    }
    const senderName = item.agentName ? resolveSenderName(item.agentName) : "";
    const senderAvatar = item.agentName ? usersById.get(item.agentName)?.avatarUrl : undefined;
    return (
      <View style={[styles.msgRow, isUser ? styles.msgRowUser : styles.msgRowAgent]}>
        {/* 多选模式：点击选中/取消 */}
        {selectMode && (
          <TouchableOpacity onPress={() => toggleSelect(item.id)} style={styles.selectCheck} hitSlop={8}>
            <Ionicons
              name={selectedIds.has(item.id) ? "checkbox" : "square-outline"}
              size={22}
              color={selectedIds.has(item.id) ? colors.primary : colors.textMuted}
            />
          </TouchableOpacity>
        )}
        {!isUser && (
          <Avatar name={senderName} avatarUrl={senderAvatar} size={32} />
        )}
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
              {item.attachment && renderAttachment(item.attachment, isUser, item.content)}
              {!!item.content && (
                <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>
                  {item.content.split(/(@[\p{L}\p{N}_]{1,20})/gu).map((part, i) =>
                    /^@[\p{L}\p{N}_]{1,20}$/u.test(part) ? (
                      <Text key={i} style={[styles.mentionText, isUser && styles.mentionTextUser]}>{part}</Text>
                    ) : (
                      <Text key={i}>{part}</Text>
                    ),
                  )}
                </Text>
              )}
            </>
          )}
          <View style={[styles.bubbleMeta, isUser && styles.bubbleMetaUser]}>
            <Text style={[styles.bubbleTime, isUser && styles.bubbleTimeUser]}>
              {timeAgo(item.ts)}
            </Text>
            {isUser && !item.deleted && readLabel ? (
              <Text style={readLabel.startsWith("已读") ? styles.bubbleRead : styles.bubbleUnread}>
                {readLabel}
              </Text>
            ) : null}
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  const canSend = (inputText.trim() || !!draftAttachment) && isConnected && !isSending && !uploading;

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      {/* 右上角汉堡菜单按钮 */}
      <TouchableOpacity
        style={{ position: "absolute", top: 8, right: 8, zIndex: 100, padding: 8, backgroundColor: colors.surface, borderRadius: 20, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 }}
        onPress={() => setShowDetailModal(true)}
        hitSlop={12}
      >
        <Ionicons name="menu" size={22} color={colors.text} />
      </TouchableOpacity>

      {/* 详细信息弹窗 — 液态玻璃 */}
      <Modal visible={showDetailModal} transparent animationType="fade" onRequestClose={() => setShowDetailModal(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.2)" }} activeOpacity={1} onPress={() => setShowDetailModal(false)}>
          <LiquidGlass
            blur={40}
            radiusValue={18}
            style={{ position: "absolute", top: 80, right: 16, minWidth: 260 }}
            contentStyle={{ padding: 20 }}
          >
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 16 }}>{conv?.type === "group" ? "群聊信息" : "聊天信息"}</Text>

            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>{conv?.type === "group" ? "群名称" : "会话名称"}</Text>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: "600", marginTop: 2 }}>{title || conv?.title || "未命名"}</Text>
            </View>

            {conv?.type === "group" && (
              <View style={{ marginBottom: 12 }}>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>成员数量</Text>
                <Text style={{ color: colors.text, fontSize: 16, fontWeight: "600", marginTop: 2 }}>{(conv.participantIds ?? []).length} 人</Text>
              </View>
            )}

            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>会话类型</Text>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: "600", marginTop: 2 }}>{conv?.type === "group" ? "群聊" : "私聊"}</Text>
            </View>

            {conv?.announcement ? (
              <View style={{ marginBottom: 12 }}>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>公告</Text>
                <Text style={{ color: colors.text, fontSize: 14, marginTop: 2, lineHeight: 20 }}>{conv.announcement}</Text>
              </View>
            ) : null}

            <TouchableOpacity style={{ marginTop: 16, alignItems: "center", paddingVertical: 8 }} onPress={() => setShowDetailModal(false)}>
              <Text style={{ color: colors.textMuted, fontSize: 14 }}>关闭</Text>
            </TouchableOpacity>
          </LiquidGlass>
        </TouchableOpacity>
      </Modal>

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messageList}
        // 虚拟滚动优化：仅渲染可视区域±屏幕高度的项
        windowSize={11}
        maxToRenderPerBatch={15}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews={true}
        initialNumToRender={20}
        inverted={false}
        onScroll={(e) => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={16}
        onEndReached={loadMoreMessages}
        onEndReachedThreshold={0.3}
        ListFooterComponent={loadingMore ? (
          <View style={styles.loadingMore}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : null}
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

      {/* 「+」扩展栏：语音通话 / 相册 / 视频 / 文件 */}
      {showExtend && (
        <View style={styles.extendBar}>
          {canSendAttachment && (
            <TouchableOpacity
              style={styles.extendItem}
              onPress={() => {
                const peer = callPeer(conv);
                if (peer) void startCall(peer);
              }}
              activeOpacity={0.7}
            >
              <View style={styles.extendIcon}>
                <Ionicons name="call" size={24} color={colors.success} />
              </View>
              <Text style={styles.extendLabel}>语音通话</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.extendItem} onPress={pickImage} disabled={!canSendAttachment || uploading || isSending} activeOpacity={0.7}>
            <View style={styles.extendIcon}>
              <Ionicons name="image-outline" size={24} color={colors.primary} />
            </View>
            <Text style={styles.extendLabel}>相册</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.extendItem} onPress={pickVideo} disabled={!canSendAttachment || uploading || isSending} activeOpacity={0.7}>
            <View style={styles.extendIcon}>
              <Ionicons name="videocam-outline" size={24} color={colors.primary} />
            </View>
            <Text style={styles.extendLabel}>视频</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.extendItem} onPress={pickFile} disabled={!canSendAttachment || uploading || isSending} activeOpacity={0.7}>
            <View style={styles.extendIcon}>
              <Ionicons name="document-outline" size={24} color={colors.primary} />
            </View>
            <Text style={styles.extendLabel}>文件</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.extendItem} onPress={pickAudio} disabled={uploading || isSending} activeOpacity={0.7}>
            <View style={styles.extendIcon}>
              <Ionicons name="musical-notes-outline" size={24} color={colors.primary} />
            </View>
            <Text style={styles.extendLabel}>音频</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 表情面板 */}
      {showEmoji && (
        <EmojiPicker
          onSelect={(emoji) => {
            setInputText((prev) => prev + emoji);
            void saveDraft(convId, inputText + emoji);
            inputRef.current?.focus();
          }}
        />
      )}

      {/* 输入栏 */}
      <View style={[styles.inputBar, { paddingBottom: keyboardHeight + spacing.md }]}>
        <TouchableOpacity
          style={styles.emojiBtn}
          onPress={() => { setShowEmoji((v) => !v); if (showExtend) setShowExtend(false); }}
          activeOpacity={0.7}
        >
          <Ionicons name={showEmoji ? "close-circle" : "happy-outline"} size={24} color={showEmoji ? colors.primary : colors.text} />
        </TouchableOpacity>
        {showVoiceRecorder ? (
          /* 按住说话 */
          <VoiceRecorder
            onSend={(url, dur) => {
              setShowVoiceRecorder(false);
              void api.sendConversationMessage(convId, `[语音 ${dur}s]`, { type: "audio", name: "voice.m4a", size: 0, mime: "audio/m4a", url });
              void loadMessages();
            }}
            onCancel={() => {}}
          />
        ) : (
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="输入消息…"
            placeholderTextColor={colors.textFaint}
            value={inputText}
            onChangeText={onInputChange}
            multiline
            maxLength={2000}
            // editable 不随 isSending 切换（editable 变 false 会让输入框失焦收起键盘）
            editable={isConnected && !uploading}
          />
        )}
        {!showVoiceRecorder && (isSending || uploading ? (
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
        ))}
        <TouchableOpacity
          style={styles.expandBtn}
          onPress={() => { setShowExtend((v) => !v); if (showVoiceRecorder) setShowVoiceRecorder(false); }}
          disabled={!canSendAttachment || uploading || isSending}
          activeOpacity={0.7}
        >
          <Ionicons
            name={showExtend ? "close" : "add"}
            size={26}
            color={showExtend ? colors.primary : colors.text}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.expandBtn}
          onPress={() => { setShowVoiceRecorder((v) => !v); if (showExtend) setShowExtend(false); }}
          activeOpacity={0.7}
        >
          <Ionicons name={showVoiceRecorder ? "keypad" : "mic"} size={24} color={showVoiceRecorder ? colors.primary : colors.text} />
        </TouchableOpacity>
      </View>

      {/* @提及选择列表（输入框上方弹出） */}
      {showMentionPicker && mentionableParticipants.length > 0 && (
        <View style={styles.mentionPicker}>
          {mentionableParticipants
            .filter((p) => !mentionFilter || p.name.toLowerCase().includes(mentionFilter.toLowerCase()))
            .slice(0, 8)
            .map((p) => (
              <TouchableOpacity
                key={p.id}
                style={styles.mentionItem}
                onPress={() => selectMention(p)}
                activeOpacity={0.7}
              >
                <View style={styles.mentionAvatar}>
                  <Ionicons name="person" size={16} color={colors.primary} />
                </View>
                <Text style={styles.mentionName}>{p.name}</Text>
              </TouchableOpacity>
            ))}
        </View>
      )}

      {/* 长按消息操作菜单：引用 / 转发 / 撤回（仅自己的消息） */}
      <SmartMenu
        visible={!!menuMsg}
        onClose={() => setMenuMsg(null)}
        items={[
          { icon: "chatbubble-ellipses-outline", label: "引用", onPress: startQuote },
          { icon: "arrow-redo-outline", label: "转发", onPress: startForward },
          { icon: "checkmark-circle-outline", label: "多选转发", onPress: startMultiSelect },
          ...(menuMsg && isMyMessage(menuMsg) && !menuMsg.deleted
            ? [{ icon: "trash-outline", label: "撤回", color: colors.danger, onPress: () => recallMessage(menuMsg!) }]
            : []),
        ]}
      />

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

      {/* 多选模式工具栏 */}
      {selectMode && (
        <View style={styles.selectBar}>
          <TouchableOpacity onPress={() => { setSelectMode(false); setSelectedIds(new Set()); }} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.selectCount}>已选 {selectedIds.size} 条</Text>
          <TouchableOpacity
            onPress={forwardSelected}
            disabled={selectedIds.size === 0}
            style={[styles.selectForwardBtn, selectedIds.size === 0 && { opacity: 0.4 }]}
            activeOpacity={0.7}
          >
            <Text style={styles.selectForwardText}>转发</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 群公告提示 */}
        {conv?.announcement && !conv.runId.startsWith("conv_") && (
          <View style={styles.announcementBanner}>
            <Ionicons name="megaphone" size={14} color={colors.primary} />
            <Text style={styles.announcementText} numberOfLines={2}>
              {conv.announcement}
            </Text>
          </View>
        )}

      {/* 全屏查看附件（图片/视频/文件），可下载 */}
      <Modal transparent visible={!!viewerAttachment} animationType="fade" onRequestClose={() => setViewerAttachment(null)}>
        <View style={styles.viewerOverlay}>
          <TouchableOpacity style={styles.viewerClose} onPress={() => setViewerAttachment(null)} hitSlop={10}>
            <Ionicons name="close" size={30} color="#fff" />
          </TouchableOpacity>
          {viewerAttachment?.type === "image" ? (
            <Image
              source={{ uri: viewerAttachment ? attachUrl(viewerAttachment.url) : "" }}
              style={styles.viewerImage}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.viewerInfo}>
              <Ionicons
                name={viewerAttachment?.type === "video" ? "videocam" : "document-text"}
                size={56}
                color="#fff"
              />
              <Text style={styles.viewerName} numberOfLines={2}>
                {viewerAttachment?.name}
              </Text>
              <Text style={styles.viewerMeta}>{viewerAttachment ? fmtSize(viewerAttachment.size) : ""}</Text>
            </View>
          )}
          {viewerAttachment && (
            <TouchableOpacity
              style={styles.viewerDownload}
              onPress={() => void downloadAttachment(viewerAttachment)}
              disabled={downloading}
              activeOpacity={0.8}
            >
              <Ionicons name={downloading ? "hourglass-outline" : "download-outline"} size={20} color="#fff" />
              <Text style={styles.viewerDownloadText}>{downloading ? "下载中…" : "下载"}</Text>
            </TouchableOpacity>
          )}
        </View>
      </Modal>
      {/* 联系人资料面板（左滑触发） */}
      <Modal
        transparent
        visible={showProfile}
        animationType="slide"
        onRequestClose={() => setShowProfile(false)}
      >
        <View style={styles.profileOverlay}>
          <View style={styles.profilePanel}>
            <View style={styles.profileHeader}>
              <Text style={styles.profileTitle}>{conv ? convTitle(conv, usersById) : "资料"}</Text>
              <TouchableOpacity onPress={() => setShowProfile(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {conv && (
              <View style={styles.profileBody}>
                {/* 头像 */}
                <View style={styles.profileAvatarWrap}>
                  <Avatar
                    name={convTitle(conv, usersById)}
                    avatarUrl={conv.runId.startsWith("conv_") ? usersById.get(conv.participantIds.find((p) => p !== meId) || "")?.avatarUrl : undefined}
                    size={80}
                  />
                </View>
                {/* 名称 */}
                <Text style={styles.profileName}>{convTitle(conv, usersById)}</Text>
                {/* 群信息 */}
                {!conv.runId.startsWith("conv_") && (
                  <Text style={styles.profileSubtitle}>
                    群聊 · {conv.participantIds.length} 人
                    {conv.groupOwner ? " · 群主: " + resolveSenderName(conv.groupOwner) : ""}
                  </Text>
                )}
                {/* 操作按钮 */}
                <View style={styles.profileActions}>
                  <TouchableOpacity
                    style={styles.profileActionBtn}
                    onPress={() => { setShowProfile(false); if (!conv.runId.startsWith("conv_")) navigation.navigate("GroupSettings", { convId: conv.id, title: conv.title || "" }); }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name={conv.runId.startsWith("conv_") ? "person" : "people"} size={24} color={colors.primary} />
                    <Text style={styles.profileActionText}>{conv.runId.startsWith("conv_") ? "个人资料" : "群设置"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.profileActionBtn}
                    onPress={() => setShowProfile(false)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="search" size={24} color={colors.primary} />
                    <Text style={styles.profileActionText}>搜索聊天</Text>
                  </TouchableOpacity>
                </View>
              </View>
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
  loadingMore: { paddingVertical: spacing.md, alignItems: "center" },
  announcementBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: radius.md,
  },
  announcementText: { color: colors.text, fontSize: fontSize.xs, flex: 1 },
  // 多选模式
  selectBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  selectCount: { flex: 1, color: colors.text, fontSize: fontSize.md, fontWeight: "600" },
  selectForwardBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 6 },
  selectForwardText: { color: "#fff", fontSize: fontSize.sm, fontWeight: "600" },
  selectCheck: { marginRight: spacing.xs },
  // 联系人资料面板
  profileOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  profilePanel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingBottom: spacing.xl,
    maxHeight: "60%",
  },
  profileHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  profileTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: "600" },
  profileBody: { alignItems: "center", padding: spacing.xl },
  profileAvatarWrap: { marginBottom: spacing.md },
  profileName: { color: colors.text, fontSize: fontSize.xl, fontWeight: "700", marginBottom: 4 },
  profileSubtitle: { color: colors.textMuted, fontSize: fontSize.sm, marginBottom: spacing.lg },
  profileActions: { flexDirection: "row", gap: spacing.xl },
  profileActionBtn: { alignItems: "center", gap: spacing.sm },
  profileActionText: { color: colors.text, fontSize: fontSize.sm },
  msgRow: { flexDirection: "row", alignItems: "flex-end", marginBottom: spacing.md },
  msgRowUser: { justifyContent: "flex-end" },
  msgRowAgent: { justifyContent: "flex-start", gap: spacing.xs },
  bubble: {
    maxWidth: "78%",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.xl,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  bubbleUser: { backgroundColor: colors.primaryBubble, borderBottomRightRadius: radius.sm },
  bubbleAgent: {
    backgroundColor: colors.bubbleOther,
    borderBottomLeftRadius: radius.sm,
  },
  bubbleAgentName: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: "600", marginBottom: 3 },
  bubbleText: { color: colors.text, fontSize: fontSize.md, lineHeight: 22 },
  bubbleTextUser: { color: "#fff" },
  deletedText: { fontStyle: "italic", opacity: 0.5 },
  bubbleMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  bubbleMetaUser: { justifyContent: "flex-end" },
  bubbleTime: { color: colors.textFaint, fontSize: 10 },
  bubbleTimeUser: { color: "rgba(255,255,255,0.7)" },
  bubbleRead: { color: "#fff", fontSize: 10, fontWeight: "600" },
  bubbleUnread: { color: "rgba(255,255,255,0.5)", fontSize: 10 },
  msgImage: {
    width: 260,
    height: 320,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
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
    padding: spacing.sm + 2,
    paddingTop: spacing.sm,
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
    width: 38,
    height: 38,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  sendBtnDisabled: { backgroundColor: colors.surfaceAlt },
  expandBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  emojiBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  extendBar: {
    flexDirection: "row",
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  extendItem: { alignItems: "center", gap: 4 },
  extendIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  extendLabel: { color: colors.textMuted, fontSize: fontSize.xs },
  // @提及选择列表
  mentionPicker: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    maxHeight: 220,
  },
  mentionItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  mentionAvatar: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  mentionName: { color: colors.text, fontSize: fontSize.md },
  mentionText: { color: colors.primary, fontWeight: "600" },
  mentionTextUser: { color: "#e0e0ff" },
  viewerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  viewerClose: { position: "absolute", top: 50, right: 20, zIndex: 10 },
  viewerImage: { width: "100%", height: "70%" },
  viewerInfo: { alignItems: "center", paddingHorizontal: spacing.xl },
  viewerName: { color: "#fff", fontSize: fontSize.md, marginTop: spacing.md, textAlign: "center" },
  viewerMeta: { color: "rgba(255,255,255,0.6)", fontSize: fontSize.sm, marginTop: 4 },
  viewerDownload: {
    position: "absolute",
    bottom: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.xl,
    paddingVertical: 10,
  },
  viewerDownloadText: { color: "#fff", fontSize: fontSize.md, fontWeight: "600" },
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
