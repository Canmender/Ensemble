/**
 * IM 即时通讯页面
 * - 左侧：联系人列表（智能体 + 我的设备 + 群聊）
 * - 右侧：聊天窗口
 */

import { useEffect, useRef, useState } from "react";
import {
  Bot, MessageSquare, MonitorSmartphone, Plus, Send, Users, Smartphone, Brain, Sparkles
} from "lucide-react";
import { api } from "../lib/api";
import { wsClient } from "../lib/ws";
import { useRunStore } from "../store/runs";
import type { Agent, Run } from "../types";
import { Button, Card, Input, Label, Modal, Spinner, Textarea, cls } from "../components/ui";

/** 联系人类型 */
type ContactType = "agent" | "device" | "group";

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
}

/** 聊天消息 */
interface ChatMessage {
  id: string;
  contactId: string;
  content: string;
  sender: "user" | "assistant";
  timestamp: number;
}

/** 创建群聊对话框 */
function CreateGroupDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (group: Contact) => void }) {
  const [name, setName] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    void api.get<Agent[]>("/agents").then(setAgents);
  }, []);

  function toggleAgent(id: string) {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  function create() {
    if (!name.trim() || selected.length < 2) return;
    onCreated({
      id: `group-${Date.now()}`,
      type: "group",
      name,
      status: "online",
    });
    onClose();
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
        <Button onClick={create} disabled={!name.trim() || selected.length < 2}>创建群聊</Button>
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
      className={cls(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all",
        active ? "bg-primary/10" : "hover:bg-muted/10",
      )}
    >
      <div className="relative">
        <div className={cls(
          "flex h-10 w-10 items-center justify-center rounded-full",
          contact.type === "agent" ? "bg-violet-500/10 text-violet-500" :
          contact.type === "device" ? "bg-blue-500/10 text-blue-500" :
          "bg-emerald-500/10 text-emerald-500",
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
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] text-white">
          {contact.unread}
        </span>
      )}
    </button>
  );
}

export default function ChatPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 加载联系人
  useEffect(() => {
    void loadContacts();
  }, []);

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

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 发送消息
  async function sendMessage() {
    if (!inputText.trim() || !activeContact || sending) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      contactId: activeContact.id,
      content: inputText,
      sender: "user",
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText("");
    setSending(true);

    try {
      // 调用 API 获取智能体回复
      const response = await api.post<{ reply: string }>("/chat", {
        agentId: activeContact.id,
        message: inputText,
      });

      if (response?.reply) {
        const agentMsg: ChatMessage = {
          id: `msg-${Date.now()}-agent`,
          contactId: activeContact.id,
          content: response.reply,
          sender: "assistant",
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, agentMsg]);
      }
    } catch (e) {
      console.error("发送失败:", e);
    } finally {
      setSending(false);
    }
  }

  // 当前联系人的消息
  const activeMessages = activeContact ? messages.filter((m) => m.contactId === activeContact.id) : [];

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
                activeContact.type === "device" ? "bg-blue-500/10 text-blue-500" :
                "bg-emerald-500/10 text-emerald-500",
              )}>
                {activeContact.type === "agent" ? <Bot className="h-4 w-4" /> :
                 activeContact.type === "device" ? <Smartphone className="h-4 w-4" /> :
                 <Users className="h-4 w-4" />}
              </div>
              <div>
                <div className="text-sm font-semibold text-fg">{activeContact.name}</div>
                <div className="text-xs text-muted">
                  {activeContact.status === "online" ? "在线" : activeContact.status === "busy" ? "忙碌" : "离线"}
                </div>
              </div>
            </div>

            {/* 消息列表 */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {activeMessages.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <div className="text-center">
                    <MessageSquare className="mx-auto h-12 w-12 text-muted/30" />
                    <p className="mt-2 text-sm text-muted">开始与 {activeContact.name} 对话</p>
                  </div>
                </div>
              ) : (
                activeMessages.map((msg) => (
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
                          ? "bg-primary text-white rounded-br-md"
                          : "bg-muted/20 text-fg rounded-bl-md",
                      )}
                    >
                      <div className="text-sm">{msg.content}</div>
                      <div className={cls(
                        "mt-1 text-[10px]",
                        msg.sender === "user" ? "text-white/70" : "text-muted",
                      )}>
                        {new Date(msg.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  </div>
                ))
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
