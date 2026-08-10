/**
 * IM 即时通讯页面
 * - 左侧：联系人列表（智能体 + 我的设备 + 群聊）
 * - 右侧：聊天窗口
 *
 * 群聊消息持久化：关联后端 chat 模式 Run，消息存储在 useRunStore + SQLite。
 * 单聊消息：本地 state 管理（实时对话，不持久化）。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot, MessageSquare, Plus, Send, Users, Smartphone, Brain
} from "lucide-react";
import { api } from "../lib/api";
import { wsClient } from "../lib/ws";
import { useRunStore } from "../store/runs";
import { loadRunDetail } from "../lib/loadRunDetail";
import type { Agent } from "../types";
import { Button, Card, Input, Label, Modal, Spinner, cls, showToast } from "../components/ui";

/** 联系人类型 */
type ContactType = "agent" | "device" | "group";

/** 聊天消息 */
interface ChatMessage {
  id: string;
  contactId: string;
  content: string;
  sender: "user" | "assistant";
  agentId?: string; // 群聊时标识是哪个智能体
  timestamp: number;
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
      // 创建 chat 模式的 Run
      const run = await api.post<any>("/tasks", {
        title: name,
        input: {
          mode: "chat",
          prompt: `群聊「${name}」已创建，请开始讨论。`,
          participantIds: selected,
          maxRounds: 10,
        },
      });
      onCreated({
        id: `group-${Date.now()}`,
        type: "group",
        name,
        status: "online",
        runId: run.id,
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
function ContactItem({ contact, active, onClick }: { contact: Contact; active: boolean; onClick: () => void }) {
  const icon = contact.type === "agent" ? Bot : contact.type === "device" ? Smartphone : Users;
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
    </button>
  );
}

export default function ChatPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  // 单聊消息（本地管理）
  const [singleMessages, setSingleMessages] = useState<Record<string, ChatMessage[]>>({});
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  // 当前显示的消息（单聊用本地 state，群聊用 store）—— memoized 避免每次渲染重新计算
  const messages = useMemo(() => {
    if (activeContact?.type === "group") {
      return groupMessages.map((m, i) => ({
        id: `group-${i}`,
        contactId: activeContact.id,
        content: m.content,
        sender: m.agentId === "user" ? "user" as const : "assistant" as const,
        agentId: m.agentId,
        timestamp: groupBaseTs.current - (groupMessages.length - 1 - i) * 60000,
      }));
    }
    return singleMessages[activeContact?.id ?? ""] ?? [];
  }, [activeContact?.type, activeContact?.id, groupMessages, singleMessages]);

  // 加载联系人
  useEffect(() => {
    void loadContacts();
  }, []);

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // 切换群聊联系人时：订阅 WebSocket + 加载历史消息
  useEffect(() => {
    if (!activeContact?.runId) return;
    const runId = activeContact.runId;

    // 订阅 WebSocket
    wsClient.subscribe(runId);

    // 加载历史消息（如果 store 中还没有）
    void loadRunDetail(runId, { loadEvents: false, loadChatMessages: true });

    return () => {
      wsClient.unsubscribe(runId);
    };
  }, [activeContact?.runId]);

  async function loadContacts() {
    const agents = await api.get<Agent[]>("/agents");
    const agentContacts: Contact[] = (agents ?? []).map((a) => ({
      id: a.id,
      type: "agent" as const,
      name: a.name,
      status: a.enabled ? "online" : "offline",
    }));

    // 我的设备（预留手机端）
    const deviceContacts: Contact[] = [
      { id: "this-pc", type: "device", name: "本机（电脑端）", status: "online" },
    ];

    setContacts([...deviceContacts, ...agentContacts]);
  }

  // 发送消息
  async function sendMessage() {
    if (!inputText.trim() || !activeContact || sending) return;
    const text = inputText;
    setInputText("");
    setSending(true);

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      contactId: activeContact.id,
      content: text,
      sender: "user",
      timestamp: Date.now(),
    };

    try {
      if (activeContact.type === "group" && activeContact.runId) {
        // 群聊：通过 WS steer 发送，触发后端继续对话
        // 同时本地立即显示用户消息
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
                "bg-success/10 text-success",
              )}>
                {activeContact.type === "agent" ? <Bot className="h-4 w-4" /> :
                 activeContact.type === "device" ? <Smartphone className="h-4 w-4" /> :
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
                      {activeContact.type === "group" && msg.agentId && msg.agentId !== "user" && (
                        <div className="mb-1 text-[11px] font-semibold text-violet-600">@{msg.agentId}</div>
                      )}
                      <div className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</div>
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
              <div className="flex items-center gap-3">
                <Input
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                  placeholder={`发送给 ${activeContact.name}...`}
                  className="flex-1"
                  disabled={sending}
                />
                <Button
                  onClick={sendMessage}
                  disabled={!inputText.trim() || sending}
                  className="px-4"
                  aria-label="发送消息"
                >
                  {sending ? <Spinner /> : <Send className="h-4 w-4" />}
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
