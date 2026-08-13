/**
 * IM 即时通讯页面
 * - 左侧：联系人列表（智能体 + 我的设备 + 群聊）
 * - 右侧：聊天窗口
 *
 * 群聊消息持久化：关联后端 chat 模式 Run，消息存储在 useRunStore + SQLite。
 * 单聊消息：本地 state 管理（实时对话，不持久化）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot, MessageSquare, Plus, Send, Users, Smartphone, Brain, Archive, User as UserIcon,
  Image as ImageIcon, Paperclip, File as FileIcon, X
} from "lucide-react";
import { api } from "../lib/api";
import { wsClient } from "../lib/ws";
import { useRunStore } from "../store/runs";
import { loadRunDetail } from "../lib/loadRunDetail";
import { useAuth } from "../lib/auth";
import type { Agent } from "../types";
import { Button, Card, Input, Label, Modal, Spinner, cls, showToast } from "../components/ui";

/** 联系人类型 */
type ContactType = "agent" | "device" | "group" | "user";

/** 聊天消息 */
interface ChatMessage {
  id: string;
  contactId: string;
  content: string;
  sender: "user" | "assistant";
  agentId?: string; // 群聊/用户会话中标识发送者
  senderName?: string; // 用户会话显示发送者昵称
  attachment?: MessageAttachment;
  timestamp: number;
}

/** 消息附件（图片/文件） */
interface MessageAttachment {
  type: "image" | "file";
  name: string;
  size: number;
  mime?: string;
  url: string;
}

/** 注册用户（/api/auth/users） */
interface UserInfo {
  id: string;
  username: string;
  displayName?: string;
  role?: string;
}

/** 解析用户昵称（渲染发送者名） */
function userName(usersById: Map<string, UserInfo>, id?: string): string | undefined {
  if (!id) return undefined;
  const u = usersById.get(id);
  return u ? (u.displayName || u.username) : undefined;
}

/** 联系人 */
interface Contact {
  id: string;
  type: ContactType;
  name: string;
  avatar?: string;
  status?: "online" | "offline" | "busy";
  lastMessage?: string;
  lastTime?: string;
  unread?: number;
  /** 群聊关联的 Run ID（用于消息持久化和 WebSocket 订阅） */
  runId?: string;
  /** 群聊参与者 agent ID 列表 */
  participantIds?: string[];
  /** 会话 ID（conversations API，企业级会话持久化） */
  convId?: string;
}

/** 创建群聊对话框 */
function CreateGroupDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (group: Contact) => void }) {
  const [name, setName] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void api.get<Agent[]>("/agents").then(setAgents);
  }, []);

  function toggleAgent(id: string) {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  async function create() {
    if (!name.trim() || selected.length < 2) return;
    setCreating(true);
    try {
      // 创建企业级群聊会话（conversations API，持久化 + 未读）
      const conv = await api.post<any>("/conversations", {
        type: "group",
        title: name,
        participantIds: selected,
        prompt: `群聊「${name}」已创建，请开始讨论。`,
      });
      onCreated({
        id: `conv-${conv.id}`,
        type: "group",
        name,
        status: "online",
        runId: conv.runId,
        convId: conv.id,
        participantIds: selected,
      });
      onClose();
    } catch (e) {
      console.error("创建群聊失败:", e);
      showToast("创建群聊失败: " + (e as Error).message, "error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>群聊名称</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="头脑风暴：XXX" />
      </div>
      <div>
        <Label>选择智能体（≥2）</Label>
        <div className="flex flex-wrap gap-2">
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => toggleAgent(a.id)}
              className={cls(
                "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                selected.includes(a.id)
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted hover:border-primary/50",
              )}
            >
              {a.name}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button onClick={create} disabled={!name.trim() || selected.length < 2 || creating}>
          {creating ? <Spinner /> : "创建群聊"}
        </Button>
      </div>
    </div>
  );
}

/** 联系人列表项 */
function ContactItem({
  contact,
  active,
  onClick,
  onArchive,
}: {
  contact: Contact;
  active: boolean;
  onClick: () => void;
  onArchive?: (contact: Contact) => void;
}) {
  const icon = contact.type === "agent" ? Bot : contact.type === "device" ? Smartphone : contact.type === "user" ? UserIcon : Users;
  const Icon = icon;
  const statusColor = contact.status === "online" ? "bg-success" : contact.status === "busy" ? "bg-warning" : "bg-muted";

  return (
    <button
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cls(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all",
        active ? "bg-primary/10" : "hover:bg-muted/10",
      )}
    >
      <div className="relative">
        <div className={cls(
          "flex h-10 w-10 items-center justify-center rounded-full",
          contact.type === "agent" ? "bg-violet-500/10 text-violet-500" :
          contact.type === "device" ? "bg-primary/10 text-primary" :
          contact.type === "user" ? "bg-accent/10 text-accent" :
          "bg-success/10 text-success",
        )}>
          <Icon className="h-5 w-5" />
        </div>
        <span className={cls("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface", statusColor)} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={cls("text-sm font-medium truncate", active ? "text-primary" : "text-fg")}>{contact.name}</span>
          {contact.lastTime && <span className="text-[10px] text-muted">{contact.lastTime}</span>}
        </div>
        {contact.lastMessage && (
          <div className="mt-0.5 text-xs text-muted truncate">{contact.lastMessage}</div>
        )}
      </div>
      {(contact.unread ?? 0) > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] text-primary-fg">
          {contact.unread}
        </span>
      )}
      {contact.convId && onArchive && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onArchive(contact);
          }}
          className="ml-1 rounded p-1 text-muted transition-colors hover:text-fg"
          title="归档会话"
          aria-label="归档会话"
        >
          <Archive className="h-3.5 w-3.5" />
        </button>
      )}
    </button>
  );
}

/** 高亮消息中的 @提及（@agent 或 @agent:任务），服务端据此解析委派 */
function renderContent(text: string): React.ReactNode {
  const parts = text.split(/(@[a-zA-Z0-9-]+(?:\s*[:：]\s*\S+)?)/g);
  return parts.map((part, i) =>
    /^@[a-zA-Z0-9-]+/.test(part) ? (
      <span key={i} className="font-medium text-primary">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** 文件大小格式化 */
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 消息附件渲染（图片缩略图 / 文件卡片） */
function AttachmentView({ att }: { att: MessageAttachment }) {
  if (att.type === "image") {
    return (
      <div className="mb-2">
        <img src={att.url} alt={att.name} className="max-h-56 w-auto rounded-lg object-contain" />
        <div className="mt-1 text-[10px] opacity-70">{att.name} · {fmtSize(att.size)}</div>
      </div>
    );
  }
  return (
    <a
      href={att.url}
      download={att.name}
      target="_blank"
      rel="noreferrer"
      className="mb-2 flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-xs transition-colors hover:bg-black/10"
    >
      <FileIcon className="h-4 w-4 shrink-0" />
      <span className="truncate">{att.name}</span>
      <span className="shrink-0 text-muted">{fmtSize(att.size)}</span>
    </a>
  );
}

export default function ChatPage() {
  const { state: authState } = useAuth();
  // 当前登录用户（用户-用户 IM 的方向判定；本地桌面模式无用户）
  const me = authState.user;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  // 单聊消息（本地管理）
  const [singleMessages, setSingleMessages] = useState<Record<string, ChatMessage[]>>({});
  // 企业级会话历史（conversations API，原始数据；方向/昵称在渲染时解析）
  const [convHistory, setConvHistory] = useState<Record<string, Array<{ id: string; content: string; agentId?: string; role: string; ts: string; attachment?: MessageAttachment }>>>({});
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [draftAttachment, setDraftAttachment] = useState<MessageAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastContactsReload = useRef(0);

  // 用户 id → 用户信息（渲染发送者昵称）
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const loadContacts = useCallback(async () => {
    const [agents, conversations, allUsers] = await Promise.all([
      api.get<Agent[]>("/agents"),
      api.get<any[]>("/conversations").catch(() => []),
      api.get<UserInfo[]>("/auth/users").catch(() => []),
    ]);
    setUsers(allUsers ?? []);
    const usersByIdMap = new Map((allUsers ?? []).map((u) => [u.id, u]));

    const agentContacts: Contact[] = (agents ?? []).map((a) => ({
      id: a.id,
      type: "agent" as const,
      name: a.name,
      status: a.enabled ? "online" : "offline",
    }));

    // 企业级会话（conversations）：用户会话进"用户"分区，其余（群聊/agent 直连）进"群聊"
    const groupContacts: Contact[] = [];
    const userContactByUser = new Map<string, Contact>();
    for (const c of (conversations ?? [])) {
      const pids = Array.isArray(c.participantIds) ? c.participantIds : [];
      const isUserConv = pids.length > 0 && pids.every((id: string) => usersByIdMap.has(id));
      if (isUserConv) {
        for (const pid of pids) {
          const u = usersByIdMap.get(pid);
          if (!u || (me && pid === me.id)) continue;
          userContactByUser.set(pid, {
            id: `user-${pid}`,
            type: "user" as const,
            name: u.displayName || u.username,
            status: "online",
            runId: c.runId,
            convId: c.id,
            participantIds: pids,
            unread: c.unread ?? 0,
            lastMessage: c.lastMessage,
            lastTime: c.lastMessageTs,
          });
        }
      } else {
        groupContacts.push({
          id: `conv-${c.id}`,
          type: "group" as const,
          name: c.title ?? (pids.join(", ") || "会话"),
          status: "online",
          runId: c.runId,
          convId: c.id,
          participantIds: pids,
          unread: c.unread ?? 0,
          lastMessage: c.lastMessage,
          lastTime: c.lastMessageTs,
        });
      }
    }

    // 用户列表（未建会话的也列出，首次发送时创建会话）
    const userContacts: Contact[] = [];
    if (me) {
      for (const u of (allUsers ?? [])) {
        if (u.id === me.id) continue;
        userContacts.push(
          userContactByUser.get(u.id) ?? {
            id: `user-${u.id}`,
            type: "user" as const,
            name: u.displayName || u.username,
            status: "online",
            participantIds: [u.id],
          },
        );
      }
    }

    // 我的设备（预留手机端）
    const deviceContacts: Contact[] = [
      { id: "this-pc", type: "device", name: "本机（电脑端）", status: "online" },
    ];

    setContacts([...deviceContacts, ...userContacts, ...groupContacts, ...agentContacts]);
  }, [me]);

  // 从 Zustand store 读取群聊消息
  const groupLive = useRunStore((s) => activeContact?.runId ? s.live[activeContact.runId] : undefined);
  const groupMessages = groupLive?.messages ?? [];

  // 稳定的群聊时间戳基准：仅在消息数量变化时更新，避免每轮渲染产生新时间戳
  const groupBaseTs = useRef(Date.now());
  const prevGroupLen = useRef(groupMessages.length);
  if (groupMessages.length !== prevGroupLen.current) {
    groupBaseTs.current = Date.now();
    prevGroupLen.current = groupMessages.length;
  }

  // 当前显示的消息（企业级会话 = 历史 + 实时；单聊用本地 state；旧群聊用 store）
  const messages = useMemo(() => {
    if (activeContact?.convId) {
      // 用户-用户会话：双方 role 都是 user，方向按发送者是否为自己判定
      const isUserConv = activeContact.type === "user";
      const rawHistory = convHistory[activeContact.convId] ?? [];
      const history: ChatMessage[] = rawHistory.map((m) => ({
        id: m.id,
        contactId: activeContact.id,
        content: m.content,
        sender: isUserConv
          ? (m.agentId === me?.id ? "user" as const : "assistant" as const)
          : (m.role === "user" ? "user" as const : "assistant" as const),
        agentId: m.agentId,
        senderName: isUserConv ? userName(usersById, m.agentId) : undefined,
        attachment: m.attachment,
        timestamp: new Date(m.ts).getTime(),
      }));
      // 相邻去重：WS 回显 + 乐观追加会产生相同消息（如群聊里自己的发言）
      const deduped = groupMessages.filter((m, i) => {
        if (i === 0) return true;
        const prev = groupMessages[i - 1];
        return !(m.agentId === prev.agentId && m.content === prev.content);
      });
      const live: ChatMessage[] = deduped.map((m, i) => ({
        id: `live-${i}`,
        contactId: activeContact.id,
        content: m.content,
        sender: m.agentId === me?.id || m.agentId === "user" ? "user" as const : "assistant" as const,
        agentId: m.agentId,
        senderName: isUserConv && m.agentId ? userName(usersById, m.agentId) : undefined,
        attachment: m.attachment,
        timestamp: groupBaseTs.current - (deduped.length - 1 - i) * 60000,
      }));
      // 历史 + 实时（打开会话时已清空旧 live，历史为准）
      return [...history, ...live];
    }
    if (activeContact?.type === "group") {
      return groupMessages.map((m, i) => ({
        id: `group-${i}`,
        contactId: activeContact.id,
        content: m.content,
        sender: m.agentId === "user" ? "user" as const : "assistant" as const,
        agentId: m.agentId,
        senderName: undefined,
        attachment: m.attachment,
        timestamp: groupBaseTs.current - (groupMessages.length - 1 - i) * 60000,
      }));
    }
    return singleMessages[activeContact?.id ?? ""] ?? [];
  }, [activeContact?.type, activeContact?.id, activeContact?.convId, groupMessages, singleMessages, convHistory, me?.id, usersById]);

  // 加载联系人
  useEffect(() => {
    void loadContacts();
  }, []);

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // 加载企业级会话历史 + 清零未读（打开会话 / 断线重连补拉共用）
  const loadConvHistory = useCallback(async (contact: Contact) => {
    if (!contact.convId || !contact.runId) return;
    const d = await api.get<any>(`/conversations/${contact.convId}/messages`);
    if (d?.messages) {
      setConvHistory((prev) => ({
        ...prev,
        [contact.convId!]: d.messages.map((m: any) => ({
          id: m.id,
          content: m.content,
          agentId: m.agentId,
          role: m.role,
          ts: m.ts,
          attachment: m.attachment,
        })),
      }));
      // 历史为准：清空打开前残留的 live，只保留打开后到达的新消息
      useRunStore.getState().clearMessages(contact.runId);
    }
    // 未读清零（此前 web 端从不调用 /read，未读数只增不清）
    void api.post(`/conversations/${contact.convId}/read`).then(() => {
      setContacts((prev) =>
        prev.map((c) => (c.convId === contact.convId ? { ...c, unread: 0 } : c)),
      );
    });
  }, []);

  // 当前联系人 ref（断线重连回调取最新值，避免闭包陈旧）
  const activeContactRef = useRef(activeContact);
  activeContactRef.current = activeContact;

  // 断线重连后补拉活跃会话（chat.message 不走 run_events/seq，catchUp 补不回，重拉历史兜底）
  useEffect(() => {
    wsClient.onOpen(() => {
      const c = activeContactRef.current;
      if (!c) return;
      if (c.convId) {
        void loadConvHistory(c);
      } else if (c.runId) {
        void loadRunDetail(c.runId, { loadEvents: false, loadChatMessages: true });
      }
    });
  }, [loadConvHistory]);

  // 切换联系人：订阅 WebSocket + 加载历史消息
  useEffect(() => {
    if (!activeContact?.runId) return;
    const runId = activeContact.runId;
    // 订阅 WebSocket
    wsClient.subscribe(runId);
    if (activeContact.convId) {
      void loadConvHistory(activeContact);
    } else {
      // 旧式群聊：加载历史消息（如果 store 中还没有）
      void loadRunDetail(runId, { loadEvents: false, loadChatMessages: true });
    }
    return () => {
      wsClient.unsubscribe(runId);
    };
  }, [activeContact?.runId, activeContact?.convId, loadConvHistory]);

  // 新消息到达 → 刷新会话列表（未读 / 最后消息），节流避免高频重载
  useEffect(() => {
    const activeRunId = activeContact?.runId;
    return useRunStore.subscribe((state, prev) => {
      for (const [runId, run] of Object.entries(state.live)) {
        const prevCount = prev.live[runId]?.messages.length ?? 0;
        if (run && run.messages.length > prevCount && runId !== activeRunId) {
          if (Date.now() - lastContactsReload.current > 2000) {
            lastContactsReload.current = Date.now();
            void loadContacts();
          }
          return;
        }
      }
    });
  }, [activeContact?.runId, loadContacts]);

  /** 归档会话（企业级会话，非本地 group） */
  async function archiveContact(contact: Contact) {
    if (!contact.convId) return;
    try {
      await api.post(`/conversations/${contact.convId}/archive`, { archived: true });
      void loadContacts();
    } catch (e) {
      showToast("归档失败: " + (e as Error).message, "error");
    }
  }

  /** 上传附件到服务器（base64 JSON），返回可直接引用的附件对象 */
  async function uploadFile(file: File, asImage: boolean): Promise<MessageAttachment | null> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("读取文件失败"));
      reader.readAsDataURL(file);
    });
    const base64 = dataUrl.split(",")[1] ?? "";
    setUploading(true);
    try {
      const up = await api.post<any>("/upload", {
        name: file.name,
        mime: file.type || (asImage ? "image/jpeg" : "application/octet-stream"),
        data: base64,
      });
      return {
        type: up.type === "image" ? "image" : "file",
        name: up.name,
        size: up.size,
        mime: up.mime,
        url: up.url,
      };
    } catch (e) {
      showToast("上传失败: " + (e as Error).message, "error");
      return null;
    } finally {
      setUploading(false);
    }
  }

  /** 选择附件文件 → 上传 → 设为待发送 */
  async function handlePickFile(file: File | undefined, asImage: boolean) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      showToast("文件过大（上限 20MB）", "error");
      return;
    }
    const att = await uploadFile(file, asImage);
    if (att) setDraftAttachment(att);
  }

  // 发送消息
  async function sendMessage() {
    if ((!inputText.trim() && !draftAttachment) || !activeContact || sending || uploading) return;
    if (draftAttachment && activeContact.type !== "user") {
      showToast("附件仅支持用户-用户会话（Agent 暂不支持）", "error");
      return;
    }
    const text = inputText;
    setInputText("");
    setDraftAttachment(null);
    setSending(true);

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      contactId: activeContact.id,
      content: text,
      sender: "user",
      timestamp: Date.now(),
    };

    try {
      if (activeContact.convId) {
        // 企业级会话（群聊 / 用户-用户）：落库 + 广播
        const store = useRunStore.getState();
        store.appendMessage(activeContact.runId ?? activeContact.convId, {
          // 用户会话服务端不向发送者回显（agentId 用自己 user id）；agent/群聊用 "user" 标识，与回显一致以便去重
          agentId: activeContact.type === "user" ? (me?.id ?? "user") : "user",
          content: text,
          attachment: draftAttachment ?? undefined,
        });
        void api.post(`/conversations/${activeContact.convId}/messages`, {
          content: text,
          ...(draftAttachment ? { attachment: draftAttachment } : {}),
        }).catch((e) => {
          showToast("发送失败: " + (e as Error).message, "error");
        });
      } else if (activeContact.type === "user") {
        // 用户-用户：首次发送时创建会话（无 run，消息直接落库 + 定向推送）
        const conv = await api.post<{ id: string; runId: string }>("/conversations", {
          type: "direct",
          participantIds: activeContact.participantIds,
        });
        await api.post(`/conversations/${conv.id}/messages`, {
          content: text,
          ...(draftAttachment ? { attachment: draftAttachment } : {}),
        });
        const patch = { convId: conv.id, runId: conv.runId } as const;
        setContacts((prev) => prev.map((c) => (c.id === activeContact.id ? { ...c, ...patch } : c)));
        setActiveContact((prev) => (prev && prev.id === activeContact.id ? { ...prev, ...patch } : prev));
        void loadContacts();
      } else if (activeContact.type === "group" && activeContact.runId) {
        // 旧式群聊（无会话）：本地立即显示 + WS steer
        const store = useRunStore.getState();
        store.appendMessage(activeContact.runId, {
          agentId: "user",
          content: text,
        });
        wsClient.steer(activeContact.runId, text);
      } else if (activeContact.type === "agent") {
        // 单聊：立即显示用户消息
        setSingleMessages((prev) => ({
          ...prev,
          [activeContact.id]: [...(prev[activeContact.id] ?? []), userMsg],
        }));

        // 调用 API 获取智能体回复
        const response = await api.post<{ reply: string; agentId: string }>("/chat", {
          agentId: activeContact.id,
          message: text,
        });

        if (response?.reply) {
          const agentMsg: ChatMessage = {
            id: `msg-${Date.now()}-agent`,
            contactId: activeContact.id,
            content: response.reply,
            sender: "assistant",
            agentId: response.agentId,
            timestamp: Date.now(),
          };
          setSingleMessages((prev) => ({
            ...prev,
            [activeContact.id]: [...(prev[activeContact.id] ?? []), agentMsg],
          }));

          // 更新联系人最后消息
          setContacts((prev) =>
            prev.map((c) =>
              c.id === activeContact.id
                ? { ...c, lastMessage: response.reply.slice(0, 50), lastTime: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) }
                : c
            )
          );
        }
      }
    } catch (e) {
      console.error("发送失败:", e);
      showToast("发送失败: " + (e as Error).message, "error");
      setInputText(text); // restore user's message on failure
    } finally {
      setSending(false);
    }
  }

  // 联系人分组
  const deviceContacts = contacts.filter((c) => c.type === "device");
  const userContacts = contacts.filter((c) => c.type === "user");
  const agentContacts = contacts.filter((c) => c.type === "agent");
  const groupContacts = contacts.filter((c) => c.type === "group");

  return (
    <div className="flex h-full">
      {/* 左侧联系人列表 */}
      <aside className="flex w-72 flex-col border-r border-border bg-surface">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-fg">消息</h2>
          <button
            onClick={() => setShowCreateGroup(true)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-muted/10 hover:text-fg"
            aria-label="创建群聊"
            title="创建群聊（头脑风暴）"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
          {/* 我的设备 */}
          {deviceContacts.length > 0 && (
            <div>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase text-muted">
                我的设备
              </div>
              {deviceContacts.map((c) => (
                <ContactItem
                onArchive={archiveContact}
                  key={c.id}
                  contact={c}
                  active={activeContact?.id === c.id}
                  onClick={() => setActiveContact(c)}
                />
              ))}
            </div>
          )}

          {/* 用户 */}
          {userContacts.length > 0 && (
            <div>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase text-muted">
                用户
              </div>
              {userContacts.map((c) => (
                <ContactItem
                onArchive={archiveContact}
                  key={c.id}
                  contact={c}
                  active={activeContact?.id === c.id}
                  onClick={() => setActiveContact(c)}
                />
              ))}
            </div>
          )}

          {/* 智能体 */}
          {agentContacts.length > 0 && (
            <div>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase text-muted">
                智能体
              </div>
              {agentContacts.map((c) => (
                <ContactItem
                onArchive={archiveContact}
                  key={c.id}
                  contact={c}
                  active={activeContact?.id === c.id}
                  onClick={() => setActiveContact(c)}
                />
              ))}
            </div>
          )}

          {/* 群聊 */}
          {groupContacts.length > 0 && (
            <div>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase text-muted">
                群聊
              </div>
              {groupContacts.map((c) => (
                <ContactItem
                onArchive={archiveContact}
                  key={c.id}
                  contact={c}
                  active={activeContact?.id === c.id}
                  onClick={() => setActiveContact(c)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* 右侧聊天窗口 */}
      <div className="flex flex-1 flex-col">
        {activeContact ? (
          <>
            {/* 聊天头部 */}
            <div className="flex items-center gap-3 border-b border-border px-6 py-3">
              <div className={cls(
                "flex h-9 w-9 items-center justify-center rounded-full",
                activeContact.type === "agent" ? "bg-violet-500/10 text-violet-500" :
                activeContact.type === "device" ? "bg-primary/10 text-primary" :
                activeContact.type === "user" ? "bg-accent/10 text-accent" :
                "bg-success/10 text-success",
              )}>
                {activeContact.type === "agent" ? <Bot className="h-4 w-4" /> :
                 activeContact.type === "device" ? <Smartphone className="h-4 w-4" /> :
                 activeContact.type === "user" ? <UserIcon className="h-4 w-4" /> :
                 <Users className="h-4 w-4" />}
              </div>
              <div>
                <div className="text-sm font-semibold text-fg">{activeContact.name}</div>
                <div className="text-xs text-muted">
                  {activeContact.status === "online" ? "在线" : activeContact.status === "busy" ? "忙碌" : "离线"}
                  {activeContact.type === "group" && activeContact.participantIds && (
                    <span> · {activeContact.participantIds.length} 位参与者</span>
                  )}
                </div>
              </div>
            </div>

            {/* 消息列表 */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <div className="text-center">
                    <MessageSquare className="mx-auto h-12 w-12 text-muted/30" />
                    <p className="mt-2 text-sm text-muted">开始与 {activeContact.name} 对话</p>
                  </div>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cls(
                      "flex",
                      msg.sender === "user" ? "justify-end" : "justify-start",
                    )}
                  >
                    <div
                      className={cls(
                        "max-w-[70%] rounded-2xl px-4 py-2.5",
                        msg.sender === "user"
                          ? "bg-primary text-primary-fg rounded-br-md"
                          : "bg-muted/20 text-fg rounded-bl-md",
                      )}
                    >
                      {(activeContact.type === "group" || activeContact.type === "user") && msg.agentId && msg.agentId !== "user" && msg.agentId !== me?.id && (
                        <div className="mb-1 text-[11px] font-semibold text-violet-600">
                          {activeContact.type === "user" ? (msg.senderName ?? msg.agentId) : `@${msg.agentId}`}
                        </div>
                      )}
                      {msg.attachment && <AttachmentView att={msg.attachment} />}
                      {msg.content && <div className="whitespace-pre-wrap text-sm leading-relaxed">{renderContent(msg.content)}</div>}
                      <div className={cls(
                        "mt-1 text-[10px]",
                        msg.sender === "user" ? "text-primary-fg/70" : "text-muted",
                      )}>
                        {new Date(msg.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  </div>
                ))
              )}
              {/* 群聊运行中提示 */}
              {activeContact.type === "group" && groupLive?.status === "running" && (
                <div className="flex items-center gap-2 text-muted">
                  <Spinner label="Agent 们正在对话…" />
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* 输入框 */}
            <div className="border-t border-border px-6 py-4">
              {/* 待发送附件预览 */}
              {draftAttachment && (
                <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted/20 px-3 py-2">
                  {draftAttachment.type === "image" ? <ImageIcon className="h-4 w-4 text-muted" /> : <Paperclip className="h-4 w-4 text-muted" />}
                  <span className="flex-1 truncate text-xs text-muted">{draftAttachment.name}</span>
                  <button
                    onClick={() => setDraftAttachment(null)}
                    className="rounded p-1 text-muted transition-colors hover:text-fg"
                    aria-label="取消附件"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    void handlePickFile(e.target.files?.[0], true);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    void handlePickFile(e.target.files?.[0], false);
                    e.target.value = "";
                  }}
                />
                <button
                  onClick={() => imageInputRef.current?.click()}
                  className="rounded-lg p-2 text-muted transition-colors hover:bg-muted/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                  title={activeContact.type === "user" ? "发送图片" : "附件仅支持用户-用户会话"}
                  aria-label="发送图片"
                  disabled={uploading || sending || activeContact.type !== "user"}
                >
                  <ImageIcon className="h-5 w-5" />
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg p-2 text-muted transition-colors hover:bg-muted/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                  title={activeContact.type === "user" ? "发送文件" : "附件仅支持用户-用户会话"}
                  aria-label="发送文件"
                  disabled={uploading || sending || activeContact.type !== "user"}
                >
                  <Paperclip className="h-5 w-5" />
                </button>
                <Input
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                  placeholder={`发送给 ${activeContact.name}...`}
                  className="flex-1"
                  disabled={sending || uploading}
                />
                <Button
                  onClick={sendMessage}
                  disabled={(!inputText.trim() && !draftAttachment) || sending || uploading}
                  className="px-4"
                  aria-label="发送消息"
                >
                  {sending || uploading ? <Spinner /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <Brain className="mx-auto h-16 w-16 text-muted/20" />
              <h3 className="mt-4 text-lg font-medium text-fg">选择联系人开始对话</h3>
              <p className="mt-1 text-sm text-muted">与智能体聊天或创建群聊进行头脑风暴</p>
            </div>
          </div>
        )}
      </div>

      {/* 创建群聊对话框 */}
      <Modal open={showCreateGroup} onClose={() => setShowCreateGroup(false)} title="创建群聊（头脑风暴）">
        <CreateGroupDialog
          onClose={() => setShowCreateGroup(false)}
          onCreated={(group) => {
            setContacts((prev) => [...prev, group]);
            setActiveContact(group);
          }}
        />
      </Modal>
    </div>
  );
}
