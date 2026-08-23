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
  Bot, MessageSquare, Plus, Send, Smartphone, Brain,
  Image as ImageIcon, Paperclip, File as FileIcon, X, Menu, Info, Settings2, UserPlus, Phone
} from "lucide-react";
import { GroupSettingsDialog } from "../components/GroupSettingsDialog";
import { ContactInfoDialog } from "../components/ContactInfoDialog";
import { FriendsDialog } from "../components/FriendsDialog";
import { Avatar } from "../components/Avatar";
import { PluginCardView } from "../components/PluginCard";
import { isPluginCard, type PluginCardPayload } from "../types";
import { api } from "../lib/api";
import { wsClient } from "../lib/ws";
import {
  canEncryptWith, encryptMessage, decryptMessage, isE2eContent, DECRYPT_FAILED_PLACEHOLDER,
} from "../lib/e2e";
import { useRunStore } from "../store/runs";
import { loadRunDetail } from "../lib/loadRunDetail";
import { useAuth } from "../lib/auth";
import { startCall } from "../lib/callService";
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
  deleted?: boolean; // 已撤回
  replyTo?: { id: string; content: string; senderName?: string };
  timestamp: number;
}

/** 消息附件（图片/文件/音频/插件卡片） */
interface MessageAttachment {
  type: "image" | "file" | "audio" | "plugin-card";
  name: string;
  size: number;
  mime?: string;
  url: string;
  /** 插件卡片载荷（type="plugin-card"；协议见 types.ts，与 shared 对齐） */
  card?: PluginCardPayload;
}

/** 注册用户（/api/auth/users） */
interface UserInfo {
  id: string;
  username: string;
  displayName?: string;
  role?: string;
  /** 用户自定义头像 URL（服务端返回；未设置则前端色块兜底） */
  avatarUrl?: string;
}

/** 解析用户昵称（渲染发送者名） */
function userName(usersById: Map<string, UserInfo>, id?: string): string | undefined {
  if (!id) return undefined;
  const u = usersById.get(id);
  return u ? (u.displayName || u.username) : undefined;
}

/** 为联系人信息弹窗构建展示数据（按联系人类型） */
function contactInfoFor(contact: Contact, usersById: Map<string, UserInfo>) {
  if (contact.type === "user") {
    const u = usersById.get((contact.participantIds ?? [])[0] ?? "");
    return {
      id: contact.id,
      type: "user" as const,
      name: contact.name || u?.displayName || u?.username || "用户",
      status: contact.status,
      username: u?.username,
      displayName: u?.displayName,
      role: u?.role,
    };
  }
  if (contact.type === "agent") {
    return {
      id: contact.id,
      type: "agent" as const,
      name: contact.name,
      status: contact.status,
    };
  }
  if (contact.type === "group") {
    return {
      id: contact.id,
      type: "group" as const,
      name: contact.name,
      participantCount: contact.participantIds?.length ?? 0,
    };
  }
  return { id: contact.id, type: "device" as const, name: contact.name, status: contact.status };
}

/** 联系人 */
interface Contact {
  id: string;
  type: ContactType;
  name: string;
  /** 自定义头像 URL（用户联系人来自 /auth/users；agent/device 无自定义头像走类型图标） */
  avatarUrl?: string;
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

/**
 * 联系人头像：统一渲染入口，不硬编码具体用户/群聊。
 * - user：真实头像优先（Avatar 组件），无则首字符色块兜底
 * - group：群名色块；成员头像在群设置弹窗里看
 * - agent / device：类型图标（无自定义头像概念），底色按类型区分
 */
function ContactAvatar({ contact, size = 40 }: { contact: Contact; size?: number }) {
  const is = contact.type;
  const wrapCls = cls(
    "flex shrink-0 items-center justify-center rounded-full",
    is === "agent" ? "bg-violet-500/10 text-violet-500" :
    is === "device" ? "bg-primary/10 text-primary" :
    is === "user" ? "bg-accent/10 text-accent" :
    "bg-success/10 text-success",
  );
  if (is === "agent") {
    return <div className={wrapCls} style={{ width: size, height: size }}><Bot className="h-[55%] w-[55%]" /></div>;
  }
  if (is === "device") {
    return <div className={wrapCls} style={{ width: size, height: size }}><Smartphone className="h-[55%] w-[55%]" /></div>;
  }
  // user / group：真实头像或首字符色块
  const inner = size - 4;
  return (
    <span className={wrapCls} style={{ width: size, height: size }}>
      <Avatar name={contact.name} avatarUrl={contact.avatarUrl} size={inner} />
    </span>
  );
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
}: {
  contact: Contact;
  active: boolean;
  onClick: () => void;
}) {
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
        <ContactAvatar contact={contact} size={40} />
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
      {/* 归档说明：普通 IM（用户/群聊）不提供归档；智能体协作沉淀在「归档处」（TasksPage 的 chat Run 列表） */}
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
function AttachmentView({ att, content, pluginId }: { att: MessageAttachment; content?: string; pluginId?: string }) {
  // 插件卡片（U1）：按 cardType 分派内置模板；未识别类型折叠框降级（永不白屏）
  if (att.type === "plugin-card") {
    if (att.card && isPluginCard(att)) {
      return <PluginCardView card={att.card} pluginId={pluginId || att.card.cardType} />;
    }
    return <div className="mb-1 text-xs italic opacity-60">卡片数据异常</div>;
  }
  if (att.type === "audio") {
    const url = (typeof window !== "undefined" && window.location && window.location.origin) ? att.url.startsWith("http") ? att.url : (window.location.origin + att.url) : att.url;
    return <VoiceBubble url={url} durationText={content} isUser={false} />;
  }
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

/**
 * 消息气泡变体（调研《UI组件层调研》：气泡表面 ≠ 消息容器）。
 * - mine：自己发言，主色实心
 * - theirs：他人/系统发言，muted 表面
 * - agent：群聊中 agent 发言，按身份 tint 区分（身份色从 agentId 稳定散列）
 * - ai-ghost：AI 助手消息趋向无框全宽 ghost 形态（弱化表面、强调内容）
 */
type BubbleVariant = "mine" | "theirs" | "agent" | "ai-ghost";

/** agentId → 身份 tint 色（稳定散列到固定色板；与调研建议的多 agent 身份色一致） */
const AGENT_TINTS = [
  "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  "bg-sky-500/10 text-sky-600 dark:text-sky-300",
  "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  "bg-rose-500/10 text-rose-600 dark:text-rose-300",
];
export function agentTint(agentId: string): string {
  let h = 0;
  for (let i = 0; i < agentId.length; i++) h = (h * 31 + agentId.charCodeAt(i)) >>> 0;
  return AGENT_TINTS[h % AGENT_TINTS.length];
}

/** Bubble 表面：内容载体，按变体着形。children 即消息内容区。 */
function Bubble({ variant, tint, children }: {
  variant: BubbleVariant;
  tint?: string;
  children: React.ReactNode;
}) {
  if (variant === "ai-ghost") {
    // AI 助手 ghost 形态：无框全宽、左侧细线标识来源，视觉重心在内容
    return (
      <div className={cls("w-full rounded-xl border-l-2 px-4 py-2.5", tint ?? "border-primary bg-muted/5")}>
        {children}
      </div>
    );
  }
  return (
    <div
      className={cls(
        "relative max-w-[70%] rounded-2xl px-4 py-2.5",
        variant === "mine" && "bg-primary text-primary-fg rounded-br-md",
        variant === "theirs" && "bg-muted/20 text-fg rounded-bl-md",
        variant === "agent" && cls("rounded-bl-md", tint ?? agentTint("agent")),
      )}
    >
      {children}
    </div>
  );
}

/** 判定消息的气泡变体（Message 容器层调用；分层接口对移动端同样适用） */
function bubbleVariantOf(msg: ChatMessage, contact: Contact, meId?: string): BubbleVariant {
  if (msg.sender === "user") return "mine";
  // AI 助手 ghost：agent 会话（1:1 与智能体对话）中的助手回复
  if (contact.type === "agent") return "ai-ghost";
  // 群聊中的 agent 发言 → 身份 tint；其余（用户会话对方 / 设备）→ theirs
  if (contact.type === "group" && msg.agentId && msg.agentId !== meId) return "agent";
  return "theirs";
}

/** 语音消息气泡：显示时长 + 播放按钮（播放移动端上传的 m4a，[语音 Xs] 内容） */
function VoiceBubble({ url, durationText, isUser }: { url?: string; durationText?: string; isUser: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const dur = (() => { const m = (durationText || "").match(/(\d+)\s*s/); return m ? m[1] : null; })();

  function toggle() {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); return; }
    void audioRef.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  return (
    <div className="mb-2 inline-flex items-center gap-2">
      <audio ref={audioRef}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        preload="none"
        src={url} />
      <button
        onClick={toggle}
        className="flex items-center gap-2 rounded-lg bg-black/5 px-3 py-1.5 text-xs transition-colors hover:bg-black/10"
        title="点击播放/暂停语音"
      >
        {playing ? <span className="h-2 w-2 rounded-full bg-primary animate-pulse" /> : <span className="inline-block h-2 w-2 rounded-full border border-current" />}
        <span>{dur ? `${dur}″` : "语音"}</span>
      </button>
    </div>
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
  const [convHistory, setConvHistory] = useState<Record<string, Array<{ id: string; content: string; agentId?: string; role: string; ts: string; attachment?: MessageAttachment; deleted?: boolean; replyTo?: { id: string; content: string } }>>>({});

  // ---- E2E 解密缓存（1:1 用户私聊；信封 content → 明文）----
  // 渲染层查表：命中显示明文，未命中显示占位并触发异步解密回填
  const [e2ePlain, setE2ePlain] = useState<Record<string, string>>({});
  const e2eDecrypting = useRef(new Set<string>());
  function resolveE2e(peerId: string | undefined, content: string): string {
    if (!peerId || !isE2eContent(content)) return content;
    const hit = e2ePlain[content];
    if (hit !== undefined) return hit;
    if (!e2eDecrypting.current.has(content)) {
      e2eDecrypting.current.add(content);
      void decryptMessage(peerId, content).then((plain) => {
        setE2ePlain((prev) => ({ ...prev, [content]: plain }));
        e2eDecrypting.current.delete(content);
      });
    }
    return DECRYPT_FAILED_PLACEHOLDER;
  }
  // 当前用户会话的对端 id（1:1 direct 会话参与者中非自己的那个）
  const e2ePeerId = useMemo(() => {
    if (activeContact?.type !== "user") return undefined;
    return activeContact.participantIds?.find((p) => p !== me?.id);
  }, [activeContact?.type, activeContact?.id, activeContact?.participantIds, me?.id]);
  // 各参与者最后已读时间（已读回执）
  const [convReaders, setConvReaders] = useState<Record<string, Array<{ userId: string; readTs?: string }>>>({});
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [friendsVersion, setFriendsVersion] = useState(0);
  const [draftAttachment, setDraftAttachment] = useState<MessageAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastContactsReload = useRef(0);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  // 引用/回复：当前被引用的消息（输入栏显示引用条，发送带 replyTo）
  const [replyTo, setReplyTo] = useState<{ id: string; content: string; senderName?: string } | null>(null);
  // 转发：选中要转发的消息
  const [forwardMsg, setForwardMsg] = useState<ChatMessage | null>(null);
  const [forwardTargets, setForwardTargets] = useState<Contact[]>([]);
  // 多选转发
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedMsgs, setSelectedMsgs] = useState<Set<string>>(new Set());
  // @提及：输入框 @ 触发参与者选择
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  // 表情面板
  const [showEmoji, setShowEmoji] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);

  // 点击菜单外部关闭（≡ 下拉）
  useEffect(() => {
    if (!showHeaderMenu) return;
    function onDocClick(e: MouseEvent) {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setShowHeaderMenu(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showHeaderMenu]);

  // 用户 id → 用户信息（渲染发送者昵称）
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const loadContacts = useCallback(async () => {
    const [agents, conversations, allUsers, friendsRes] = await Promise.all([
      api.get<Agent[]>("/agents"),
      api.get<any[]>("/conversations").catch(() => []),
      api.get<UserInfo[]>("/auth/users").catch(() => []),
      api.get<{ friends: Array<{ id: string }> }>("/privacy/friends").catch(() => ({ friends: [] })),
    ]);
    setUsers(allUsers ?? []);
    const usersByIdMap = new Map((allUsers ?? []).map((u) => [u.id, u]));
    const friendIds = new Set((friendsRes?.friends ?? []).map((f0) => f0.id));

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
        // 对方可能出现在 participantIds（我发起）或 c.userId（对方发起）。都收集并跳过自己。
        const candidateIds = [...(Array.isArray(c.participantIds) ? c.participantIds : []), c.userId].filter((x): x is string => !!x);
        for (const pid of new Set(candidateIds)) {
          const u = usersByIdMap.get(pid);
          if (!u || (me && pid === me.id)) continue;
          userContactByUser.set(pid, {
            id: `user-${pid}`,
            type: "user" as const,
            name: u.displayName || u.username,
            avatarUrl: u.avatarUrl,
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

    // 用户列表：仅显示有会话的好友，或已是好友的注册用户（不再自动罗列所有注册用户）
    const userContacts: Contact[] = [];
    if (me) {
      for (const u of (allUsers ?? [])) {
        if (u.id === me.id) continue;
        // 只纳入「已有会话」或「已互为好友」的用户
        const existing = userContactByUser.get(u.id);
        const isFriend = friendIds.has(u.id);
        if (!existing && !isFriend) continue;
        userContacts.push(
          existing ?? {
            id: `user-${u.id}`,
            type: "user" as const,
            name: u.displayName || u.username,
            avatarUrl: u.avatarUrl,
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
        content: resolveE2e(e2ePeerId, m.content),
        sender: isUserConv
          ? (m.agentId === me?.id ? "user" as const : "assistant" as const)
          : (m.role === "user" ? "user" as const : "assistant" as const),
        agentId: m.agentId,
        senderName: isUserConv ? userName(usersById, m.agentId) : undefined,
        attachment: m.attachment,
        deleted: m.deleted,
        replyTo: m.replyTo ? { id: m.replyTo.id, content: m.replyTo.content } : undefined,
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
        content: resolveE2e(e2ePeerId, m.content),
        sender: m.agentId === me?.id || m.agentId === "user" ? "user" as const : "assistant" as const,
        agentId: m.agentId,
        senderName: isUserConv && m.agentId ? userName(usersById, m.agentId) : undefined,
        attachment: m.attachment,
        deleted: undefined,
        replyTo: undefined,
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
        deleted: undefined,
        replyTo: undefined,
        timestamp: groupBaseTs.current - (groupMessages.length - 1 - i) * 60000,
      }));
    }
    return singleMessages[activeContact?.id ?? ""] ?? [];
  }, [activeContact?.type, activeContact?.id, activeContact?.convId, groupMessages, singleMessages, convHistory, me?.id, usersById, e2ePeerId, e2ePlain]);

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
          deleted: !!m.deleted,
          replyTo: m.replyTo,
        })),
      }));
      if (Array.isArray(d.readers)) {
        setConvReaders((prev) => ({ ...prev, [contact.convId!]: d.readers }));
      }
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

  /** 切换联系人：支持 View Transitions 的浏览器（Electron Chromium）走共享元素转场 */
  function selectContact(c: Contact) {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
    if (typeof doc.startViewTransition === "function" && window.matchMedia("(prefers-reduced-motion: no-preference)").matches) {
      doc.startViewTransition(() => setActiveContact(c));
    } else {
      setActiveContact(c);
    }
  }

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

  // E2E 懒注册：登录用户首次进入聊天页时生成/上传密钥（幂等；失败静默，收发自动回退明文）
  useEffect(() => {
    if (authState.status !== "authenticated") return;
    void import("../lib/e2e").then((m) => m.ensureEnrolled()).catch(() => {});
  }, [authState.status]);

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

  /** 撤回消息（发送者可撤） */
  async function recallMessage(msg: ChatMessage) {
    if (!activeContact?.convId) return;
    try {
      await api.del(`/conversations/${activeContact.convId}/messages/${msg.id}`);
      setConvHistory((prev) => ({
        ...prev,
        [activeContact.convId!]: (prev[activeContact.convId!] ?? []).map((m) =>
          m.id === msg.id ? { ...m, deleted: true } : m,
        ),
      }));
    } catch (e) {
      showToast("撤回失败: " + (e as Error).message, "error");
    }
  }

  // WS 撤回事件：把对应消息标记为已撤回（对方撤回时实时生效）
  useEffect(() => {
    wsClient.onChatDeleted(({ msgId }) => {
      setConvHistory((prev) => {
        let changed = false;
        const next: typeof prev = {};
        for (const [cid, msgs] of Object.entries(prev)) {
          next[cid] = msgs.map((m) => {
            if (m.id === msgId && !m.deleted) {
              changed = true;
              return { ...m, deleted: true };
            }
            return m;
          });
        }
        return changed ? next : prev;
      });
    });
  }, []);

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

  // ---- @提及 / 引用 / 转发 / 多选 / 表情 ----

  /** 解析文本中的 @提及 → 参与者 ID 列表（发送时服务端校验） */
  function parseMentions(text: string, participantIds: string[]): string[] {
    const re = /@([\p{L}\p{N}_]{1,20})/gu;
    const meId = me?.id;
    const out: string[] = [];
    for (const pid of participantIds || []) {
      if (pid === meId) continue;
      const u = usersById.get(pid);
      const name = u ? (u.displayName || u.username) : null;
      if (!name) continue;
      // 文本中出现了 @名字 或 @用户名 → 提及
      const body = text;
      const re2 = new RegExp('@' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u');
      if (re2.test(body)) out.push(pid);
    }
    return out;
  }

  /** 引用消息 */
  function startQuote(msg: ChatMessage) {
    setReplyTo({
      id: msg.id,
      content: msg.content || (msg.attachment ? msg.attachment.name : "(附件)"),
      senderName: msg.senderName ?? (msg.sender === "user" ? (me?.displayName || me?.username || "我") : (msg.agentId || "对方")),
    });
    inputRef.current?.focus();
  }

  /** 打开转发目标选择 */
  function openForward(msg: ChatMessage) {
    setForwardMsg(msg);
    const list = contacts.filter((c) => c.convId && c.id !== activeContact?.id);
    setForwardTargets(list);
  }

  /** 转发到目标会话 */
  async function doForward(target: Contact) {
    if (!forwardMsg || !target.convId) return;
    try {
      await api.post(`/conversations/${target.convId}/messages`, {
        content: forwardMsg.content || (forwardMsg.attachment ? `[文件] ${forwardMsg.attachment.name}` : ""),
        ...(forwardMsg.attachment ? { attachment: forwardMsg.attachment } : {}),
      });
      showToast(`已转发到「${target.name}」`);
      setForwardMsg(null);
    } catch (e) {
      showToast("转发失败: " + (e as Error).message, "error");
    }
  }

  /** 多选转发 */
  function toggleMultiSelect() {
    setMultiSelect((v) => {
      if (v) setSelectedMsgs(new Set());
      return !v;
    });
  }
  function toggleSelectMsg(id: string) {
    setSelectedMsgs((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  async function forwardSelected() {
    if (selectedMsgs.size === 0) return;
    setForwardTargets(contacts.filter((c) => c.convId && c.id !== activeContact?.id));
    // 简化：合并为一条文本转发当前选中
    const sel = messages.filter((m) => selectedMsgs.has(m.id));
    const text = sel.map((m) => m.content || (m.attachment ? `[文件] ${m.attachment.name}` : "")).filter(Boolean).join("\n");
    setForwardMsg({ ...(sel[0] ?? { id: "", contactId: "", content: "", sender: "user", timestamp: Date.now() }), content: text, attachment: undefined });
  }

  /** 插入表情到输入框 */
  function insertEmoji(e: string) {
    setInputText((prev) => prev + e);
  }

  // 接收移动端发来的语音：解析 [语音 Xs]
  function voiceDuration(content?: string): number | null {
    if (!content) return null;
    const m = content.match(/(\d+)\s*s/);
    return m ? Number(m[1]) : null;
  }

  // 发送消息
  async function sendMessage() {
    if ((!inputText.trim() && !draftAttachment) || !activeContact || sending || uploading) return;
    // 附件支持用户-用户与群聊；Agent 直连暂不支持附件
    if (draftAttachment && activeContact.type === "agent") {
      showToast("附件仅支持用户-用户/群聊（Agent 直连暂不支持）", "error");
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
      // 1:1 用户私聊 E2E：双方都已注册密钥 → 加密信封作为 content（协议 §4）
      const peerId = activeContact.participantIds?.find((p) => p !== me?.id);
      let contentToSend = text;
      if (activeContact.type === "user" && peerId && !draftAttachment) {
        try {
          if (await canEncryptWith(peerId)) {
            contentToSend = await encryptMessage(peerId, text);
          }
        } catch {
          /* 建会话/加密失败 → 回退明文，不阻断消息 */
        }
      }

      if (activeContact.convId) {
        // 企业级会话（群聊 / 用户-用户）：落库 + 广播
        const store = useRunStore.getState();
        store.appendMessage(activeContact.runId ?? activeContact.convId, {
          // 用户会话服务端不向发送者回显（agentId 用自己 user id）；agent/群聊用 "user" 标识，与回显一致以便去重
          agentId: activeContact.type === "user" ? (me?.id ?? "user") : "user",
          content: text,
          attachment: draftAttachment as { type: "image" | "file"; name: string; size: number; mime?: string; url: string } | undefined,
        });
        void api.post(`/conversations/${activeContact.convId}/messages`, {
          content: contentToSend,
          ...(draftAttachment ? { attachment: draftAttachment } : {}),
          ...(replyTo ? { replyTo: { id: replyTo.id, content: replyTo.content.slice(0, 120) } } : {}),
          mentions: parseMentions(text, activeContact.participantIds ?? []),
        })
          .then(() => {
            setDraftAttachment(null);
            // 发送成功 → 刷新历史拿到真实 msgId（撤回可用），live 以历史为准去重
            if (activeContactRef.current?.convId) void loadConvHistory(activeContactRef.current);
          })
          .catch((e) => {
            showToast("发送失败: " + (e as Error).message, "error");
          });
      } else if (activeContact.type === "user") {
        // 用户-用户：首次发送时创建会话（无 run，消息直接落库 + 定向推送）
        const conv = await api.post<{ id: string; runId: string }>("/conversations", {
          type: "direct",
          participantIds: activeContact.participantIds,
        });
        await api.post(`/conversations/${conv.id}/messages`, {
          content: contentToSend,
          ...(draftAttachment ? { attachment: draftAttachment } : {}),
          ...(replyTo ? { replyTo: { id: replyTo.id, content: replyTo.content.slice(0, 120) } } : {}),
          mentions: parseMentions(text, activeContact.participantIds ?? []),
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
      setReplyTo(null);
      setMentionOpen(false);
      setShowEmoji(false);
    }
  }

  // 对方最后已读时间（用户-用户会话的已读回执：自己消息 ts ≤ 该时间 → 显示「已读」）
  const peerReadTs = useMemo(() => {
    if (!activeContact?.convId || activeContact.type !== "user") return undefined;
    const readers = convReaders[activeContact.convId] ?? [];
    const peer = readers.find((r) => r.userId && r.userId !== me?.id);
    const ts = peer?.readTs ? new Date(peer.readTs).getTime() : undefined;
    return ts !== undefined && !Number.isNaN(ts) ? ts : undefined;
  }, [activeContact?.convId, activeContact?.type, convReaders, me?.id]);

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
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowFriends(true)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-muted/10 hover:text-fg"
              aria-label="加好友"
              title="加好友 / 好友请求"
            >
              <UserPlus className="h-4 w-4" />
            </button>
            <button
              onClick={() => setShowCreateGroup(true)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-muted/10 hover:text-fg"
              aria-label="创建群聊"
              title="创建群聊（头脑风暴）"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
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
                  key={c.id}
                  contact={c}
                  active={activeContact?.id === c.id}
                  onClick={() => selectContact(c)}
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
                  key={c.id}
                  contact={c}
                  active={activeContact?.id === c.id}
                  onClick={() => selectContact(c)}
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
                  key={c.id}
                  contact={c}
                  active={activeContact?.id === c.id}
                  onClick={() => selectContact(c)}
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
                  key={c.id}
                  contact={c}
                  active={activeContact?.id === c.id}
                  onClick={() => selectContact(c)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* 右侧聊天窗口 */}
      <div className="flex flex-1 flex-col" style={{ viewTransitionName: "chat-pane" }}>
        {activeContact ? (
          <>
            {/* 聊天头部 */}
            <div className="flex items-center gap-3 border-b border-border px-6 py-3">
              <ContactAvatar contact={activeContact} size={36} />
              <div>
                <div className="text-sm font-semibold text-fg">{activeContact.name}</div>
                <div className="text-xs text-muted">
                  {activeContact.status === "online" ? "在线" : activeContact.status === "busy" ? "忙碌" : "离线"}
                  {activeContact.type === "group" && activeContact.participantIds && (
                    <span> · {activeContact.participantIds.length} 位参与者</span>
                  )}
                </div>
              </div>
              {/* 语音通话（1:1 用户会话） */}
              {activeContact.type === "user" && (
                <button
                  onClick={() => {
                    const peerId = (activeContact.participantIds ?? []).find((pid) => pid !== authState.user?.id);
                    if (peerId) {
                      void startCall({ userId: peerId, name: activeContact.name });
                    } else {
                      showToast("无法获取通话对象", "error");
                    }
                  }}
                  className="ml-auto mr-1 rounded-lg p-2 text-success transition-colors hover:bg-success/10"
                  title="语音通话"
                  aria-label="语音通话"
                >
                  <Phone className="h-5 w-5" />
                </button>
              )}
              {/* 右上角 ≡ 菜单 */}
              <div ref={headerMenuRef} className={cls("relative", activeContact.type !== "user" ? "ml-auto" : "")}>
                <button
                  onClick={() => setShowHeaderMenu((v) => !v)}
                  className="rounded-lg p-2 text-muted transition-colors hover:bg-muted/10 hover:text-fg"
                  title="更多"
                  aria-label="更多"
                  aria-haspopup="menu"
                  aria-expanded={showHeaderMenu}
                >
                  <Menu className="h-5 w-5" />
                </button>
                {showHeaderMenu && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border border-border bg-surface p-1 shadow-lg"
                  >
                    <button
                      role="menuitem"
                      onClick={() => { setShowHeaderMenu(false); setShowContactInfo(true); }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg transition-colors hover:bg-muted/10"
                    >
                      <Info className="h-4 w-4 text-muted" />
                      {activeContact.type === "user" ? "查看用户信息" : activeContact.type === "group" ? "查看群聊信息" : "查看信息"}
                    </button>
                    {activeContact.type === "group" && activeContact.convId && (
                      <button
                        role="menuitem"
                        onClick={() => { setShowHeaderMenu(false); setShowGroupSettings(true); }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg transition-colors hover:bg-muted/10"
                      >
                        <Settings2 className="h-4 w-4 text-muted" />
                        群聊管理
                      </button>
                    )}
                  </div>
                )}
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
                messages.map((msg) => {
                  const variant = bubbleVariantOf(msg, activeContact, me?.id);
                  const tint = variant === "agent" && msg.agentId ? agentTint(msg.agentId) : undefined;
                  const isMine = msg.sender === "user";
                  return (
                  <div
                    key={msg.id}
                    className={cls(
                      "group relative flex",
                      isMine ? "justify-end" : "justify-start",
                    )}
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      {multiSelect && (
                        <button
                          onClick={() => toggleSelectMsg(msg.id)}
                          className={cls("self-center flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                            selectedMsgs.has(msg.id) ? "border-primary bg-primary text-primary-fg" : "border-muted bg-surface")}
                        >
                          {selectedMsgs.has(msg.id) && "✓"}
                        </button>
                      )}
                      {(() => {
                        if (isMine) return null;
                        if (activeContact.type === "user" && msg.agentId) {
                          const u = usersById.get(msg.agentId);
                          return <Avatar name={msg.senderName ?? u?.displayName ?? u?.username ?? msg.agentId} avatarUrl={u?.avatarUrl} size={28} className="mt-1 shrink-0" />;
                        }
                        if (activeContact.type === "group") {
                          return <Avatar name={msg.senderName ?? msg.agentId ?? "?"} size={28} className="mt-1 shrink-0" />;
                        }
                        if (activeContact.type === "agent") {
                          return <Avatar name={activeContact.name} avatarUrl={(activeContact as any).avatarUrl} size={28} className="mt-1 shrink-0" />;
                        }
                        return null;
                      })()}
                      {/* Bubble 表面 */}
                      <Bubble variant={variant} tint={tint}>
                        {msg.deleted ? (
                          <div className="text-sm italic opacity-60">消息已撤回</div>
                        ) : (
                          <>
                            {msg.replyTo && (
                              <div className={cls("mb-1 rounded-md px-2 py-1 text-xs opacity-80 border-l-2", isMine ? "border-primary-fg/60 bg-primary-fg/10" : "border-current/30 bg-black/5")}>
                                <div className="font-medium">{msg.replyTo.senderName || "引用"}：</div>
                                <div className="truncate max-w-full">{msg.replyTo.content}</div>
                              </div>
                            )}
                            {(activeContact.type === "group" || activeContact.type === "user") && msg.agentId && msg.agentId !== "user" && msg.agentId !== me?.id && (
                              <div className={cls("mb-1 text-[11px] font-semibold", variant === "ai-ghost" ? "text-muted" : "opacity-90")}>
                                {activeContact.type === "user" ? (msg.senderName ?? msg.agentId) : `@${msg.agentId}`}
                              </div>
                            )}
                            {msg.attachment && <AttachmentView att={msg.attachment} content={msg.content} pluginId={msg.agentId} />}
                            {msg.content && <div className={cls("whitespace-pre-wrap leading-relaxed", variant === "ai-ghost" ? "text-sm text-fg" : "text-sm")}>{renderContent(msg.content)}</div>}
                          </>
                        )}
                        <div className={cls(
                          "mt-1 flex items-center gap-2",
                          isMine ? "justify-end" : "justify-start",
                        )}>
                          <span className={cls(
                            "text-[10px]",
                            isMine ? "text-primary-fg/70" : "text-muted",
                          )}>
                            {new Date(msg.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          {!msg.deleted && (
                            <>
                              <button onClick={() => startQuote(msg)} className="text-[10px] opacity-0 transition-opacity group-hover:opacity-100 hover:underline" title="引用回复">引用</button>
                              <button onClick={() => openForward(msg)} className="text-[10px] opacity-0 transition-opacity group-hover:opacity-100 hover:underline" title="转发">转发</button>
                            </>
                          )}
                          {isMine && !msg.deleted && activeContact?.convId && (
                            <button
                              onClick={() => void recallMessage(msg)}
                              className="text-[10px] opacity-0 transition-opacity group-hover:opacity-100 hover:underline"
                              title="撤回消息"
                            >
                              撤回
                            </button>
                          )}
                          {isMine && peerReadTs !== undefined && msg.timestamp <= peerReadTs && (
                            <span className="text-[10px] font-semibold text-primary">已读</span>
                          )}
                        </div>
                      </Bubble>
                    </div>
                  </div>
                  );
                })
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
              {/* 引用回复条 */}
              {replyTo && (
                <div className="mb-2 flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2">
                  <span className="text-xs text-muted">回复 {replyTo.senderName}</span>
                  <span className="flex-1 truncate text-xs text-fg">{replyTo.content}</span>
                  <button onClick={() => setReplyTo(null)} className="rounded p-1 text-muted hover:text-fg" aria-label="取消引用"><X className="h-3 w-3" /></button>
                </div>
              )}
              {/* @提及选择 */}
              {mentionOpen && activeContact && (activeContact.type === "user" || activeContact.type === "group") && (
                <div className="mb-2 flex flex-wrap items-center gap-1 rounded-lg bg-surface p-2 shadow-sm border border-border max-h-28 overflow-y-auto">
                  {(activeContact.participantIds ?? []).map((pid) => {
                    const u = usersById.get(pid);
                    const name = u ? (u.displayName || u.username) : (pid.startsWith("user_") ? pid : pid);
                    if (mentionFilter && !name.includes(mentionFilter)) return null;
                    return (
                      <button
                        key={pid}
                        onClick={() => {
                          setInputText((prev) => {
                            const lastAt = prev.lastIndexOf("@");
                            const pre = lastAt >= 0 ? prev.slice(0, lastAt) : prev;
                            return pre + "@" + name + " ";
                          });
                          setMentionOpen(false);
                          inputRef.current?.focus();
                        }}
                        className="rounded-full border border-border px-2 py-0.5 text-xs text-primary hover:bg-primary/10"
                      >
                        @{name}
                      </button>
                    );
                  })}
                </div>
              )}
              {/* 表情面板 */}
              {showEmoji && (
                <div ref={emojiRef} className="mb-2 flex flex-wrap items-center gap-1 rounded-lg bg-surface p-2 shadow-sm border border-border max-h-32 overflow-y-auto">
                  {["😀","😂","🤣","😊","😍","😘","😎","🤔","😅","😭","😡","👍","👎","👏","🙏","💪","🔥","❤️","🎉","✅","❌","👻","🤝","☕"].map((e) => (
                    <button key={e} onClick={() => insertEmoji(e)} className="p-1 text-lg hover:bg-muted/10 rounded">{e}</button>
                  ))}
                </div>
              )}
              {/* 多选转发工具栏 */}
              {multiSelect && (
                <div className="mb-2 flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2">
                  <span className="text-xs text-muted">已选 {selectedMsgs.size} 条</span>
                  <button onClick={() => void forwardSelected()} disabled={selectedMsgs.size === 0} className="ml-auto rounded-lg bg-primary px-3 py-1 text-xs text-primary-fg disabled:opacity-40">转发</button>
                  <button onClick={toggleMultiSelect} className="rounded-lg px-2 py-1 text-xs text-muted hover:text-fg">取消</button>
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
                  title="发送图片（支持用户/群聊）"
                  aria-label="发送图片"
                  disabled={uploading || sending || activeContact.type === "agent"}
                >
                  <ImageIcon className="h-5 w-5" />
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg p-2 text-muted transition-colors hover:bg-muted/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                  title="发送文件（支持用户/群聊）"
                  aria-label="发送文件"
                  disabled={uploading || sending || activeContact.type === "agent"}
                >
                  <Paperclip className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setShowEmoji((v) => !v)}
                  className="rounded-lg p-2 text-muted transition-colors hover:bg-muted/10 hover:text-fg"
                  title="表情"
                  aria-label="表情"
                >
                  <span className="text-base leading-none">😀</span>
                </button>
                <button
                  onClick={toggleMultiSelect}
                  className={cls("rounded-lg p-2 transition-colors", multiSelect ? "bg-primary/10 text-primary" : "text-muted hover:bg-muted/10 hover:text-fg")}
                  title="多选转发"
                  aria-label="多选转发"
                >
                  <span className="text-sm leading-none">☑</span>
                </button>
                <Input
                  value={inputText}
                  onChange={(e) => {
                    const v = e.target.value;
                    setInputText(v);
                    // @提及：输入 @ 打开参与者选择
                    const lastAt = v.lastIndexOf("@");
                    if (lastAt >= 0 && v.slice(lastAt + 1).length <= 20) {
                      const isAfterSpace = v.slice(lastAt + 1).includes(" ") === false;
                      if (isAfterSpace) { setMentionOpen(true); setMentionFilter(v.slice(lastAt + 1)); }
                      else setMentionOpen(false);
                    } else {
                      setMentionOpen(false);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !mentionOpen) sendMessage();
                    if (e.key === "Escape") { setMentionOpen(false); setShowEmoji(false); }
                  }}
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

      {/* 联系人信息对话框 */}
      {showContactInfo && activeContact && (
        <ContactInfoDialog
          contact={contactInfoFor(activeContact, usersById)}
          onClose={() => setShowContactInfo(false)}
          onSendMessage={() => { setShowContactInfo(false); }}
        />
      )}

      {/* 加好友对话框 */}
      {showFriends && (
        <FriendsDialog onClose={() => setShowFriends(false)} onChanged={() => { setFriendsVersion((n) => n + 1); void loadContacts(); }} />
      )}
      {/* 群聊设置对话框 */}
      {showGroupSettings && activeContact?.convId && (
        <GroupSettingsDialog
          convId={activeContact.convId}
          onClose={() => setShowGroupSettings(false)}
          onChanged={() => {
            // 群信息/成员/解散变更后刷新会话列表与当前会话
            void loadContacts();
            if (activeContactRef.current) setActiveContact({ ...activeContactRef.current });
          }}
        />
      )}

      {/* 转发到…对话框 */}
      {(forwardMsg || forwardTargets.length > 0) && (
        <Modal open onClose={() => { setForwardMsg(null); setForwardTargets([]); }} title="转发到…">
          <div className="space-y-2">
            {forwardTargets.length === 0 ? (
              <p className="text-sm text-muted">暂无可转发的会话</p>
            ) : (
              forwardTargets.map((t) => (
                <button
                  key={t.id}
                  onClick={() => void doForward(t)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg transition-colors hover:bg-muted/10"
                >
                  <MessageSquare className="h-4 w-4 text-muted" />
                  <span className="truncate">{t.name}</span>
                </button>
              ))
            )}
            <button onClick={() => { setForwardMsg(null); setForwardTargets([]); }} className="w-full rounded-lg bg-muted/10 px-3 py-2 text-sm text-muted hover:text-fg">取消</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
