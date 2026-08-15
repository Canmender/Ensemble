import { Bot, Mail, Shield, User as UserIcon, Users } from "lucide-react";
import { Badge, Button, Modal } from "./ui";

/** 联系人信息弹窗：按联系人类型展示用户/智能体/群聊资料 */
export function ContactInfoDialog({
  contact,
  onClose,
  onSendMessage,
}: {
  contact: {
    id: string;
    type: "agent" | "device" | "user" | "group";
    name: string;
    status?: "online" | "offline" | "busy";
    username?: string;
    displayName?: string;
    role?: string;
    description?: string;
    model?: string;
    participantCount?: number;
  };
  onClose: () => void;
  onSendMessage?: () => void;
}) {
  const title =
    contact.type === "user" ? "用户信息"
    : contact.type === "agent" ? "智能体信息"
    : contact.type === "group" ? "群聊信息"
    : "设备信息";

  const statusText =
    contact.status === "online" ? "在线" :
    contact.status === "busy" ? "忙碌" : "离线";

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="space-y-5">
        {/* 头像 + 名称 */}
        <div className="flex flex-col items-center gap-3">
          <div className={badge(contact.type)}>
            {contact.type === "agent" ? <Bot className="h-10 w-10" /> :
             contact.type === "user" ? <UserIcon className="h-10 w-10" /> :
             contact.type === "group" ? <Users className="h-10 w-10" /> :
             <Users className="h-10 w-10" />}
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-fg">{contact.name}</div>
            <div className="mt-1 flex items-center justify-center gap-2">
              <Badge>{statusText}</Badge>
              {contact.type === "agent" && contact.model && <Badge>{contact.model}</Badge>}
              {contact.type === "user" && contact.role && <Badge>{contact.role}</Badge>}
            </div>
          </div>
        </div>

        {/* 详情 */}
        <div className="space-y-2 rounded-lg bg-muted/10 p-4 text-sm">
          {contact.type === "user" && (
            <>
              <Row icon={<Mail className="h-3.5 w-3.5" />} label="用户名" value={contact.username} />
              <Row icon={<Shield className="h-3.5 w-3.5" />} label="角色" value={contact.role ?? "用户"} />
            </>
          )}
          {contact.type === "agent" && (
            <>
              <Row icon={<Bot className="h-3.5 w-3.5" />} label="类型" value={contact.description ? "智能体" : "智能体"} />
              {contact.model && <Row icon={<Shield className="h-3.5 w-3.5" />} label="模型" value={contact.model} />}
            </>
          )}
          {contact.type === "group" && (
            <Row icon={<Users className="h-3.5 w-3.5" />} label="成员数" value={`${contact.participantCount ?? 0} 位`} />
          )}
          {contact.status && (
            <Row icon={<span className="inline-block h-2 w-2 rounded-full bg-success" />} label="状态" value={statusText} />
          )}
          {contact.description && (
            <div className="pt-1">
              <div className="mb-1 text-xs text-muted">简介</div>
              <div className="whitespace-pre-wrap text-fg">{contact.description}</div>
            </div>
          )}
        </div>

        {onSendMessage && (
          <div className="flex justify-end">
            <Button onClick={onSendMessage}>
              {contact.type === "group" ? "返回聊天" : "发送消息"}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function badge(type: string) {
  const base = "flex h-20 w-20 items-center justify-center rounded-full";
  switch (type) {
    case "agent": return base + " bg-violet-500/10 text-violet-500";
    case "user": return base + " bg-accent/10 text-accent";
    case "group": return base + " bg-success/10 text-success";
    default: return base + " bg-primary/10 text-primary";
  }
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center text-muted">{icon}</span>
      <span className="w-16 shrink-0 text-muted">{label}</span>
      <span className="text-fg">{value}</span>
    </div>
  );
}
