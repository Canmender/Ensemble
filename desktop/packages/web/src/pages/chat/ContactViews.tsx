/**
 * 联系人侧展示层：头像、列表项与创建群聊弹窗。
 * 从 ChatPage.tsx 抽出。CreateGroupDialog 状态自包含，仅经 onCreated 回调吐结果。
 */

import { useEffect, useState } from "react";
import { Bot, Smartphone, Plus } from "lucide-react";
import { Avatar } from "../../components/Avatar";
import { api } from "../../lib/api";
import { Button, Input, Label, Spinner, cls, showToast } from "../../components/ui";
import type { Agent } from "../../types";
import type { Contact } from "./types";

/**
 * 联系人头像：统一渲染入口，不硬编码具体用户/群聊。
 * - user：真实头像优先（Avatar 组件），无则首字符色块兜底
 * - group：群名色块；成员头像在群设置弹窗里看
 * - agent / device：类型图标（无自定义头像概念），底色按类型区分
 */
export function ContactAvatar({ contact, size = 40 }: { contact: Contact; size?: number }) {
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
export function CreateGroupDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (group: Contact) => void }) {
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
export function ContactItem({
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
