/** IM 页面共享类型与纯函数（从 ChatPage.tsx 抽出，供 chat/ 各模块 import） */

import type { PluginCardPayload } from "../../types";

/** 联系人类型 */
export type ContactType = "agent" | "device" | "group" | "user";

/** 聊天消息 */
export interface ChatMessage {
  id: string;
  contactId: string;
  content: string;
  sender: "user" | "assistant";
  agentId?: string; // 群聊/用户会话中标识发送者
  senderName?: string; // 用户会话显示发送者昵称
  attachment?: MessageAttachment;
  deleted?: boolean; // 已撤回
  status?: 1 | 2 | 3; // 1=正常 2=已撤回 3=已编辑
  reactions?: Record<string, string[]>; // 表情回应 {emoji: userIds}
  replyTo?: { id: string; content: string; senderName?: string };
  timestamp: number;
}

/** 消息附件（图片/文件/音频/插件卡片） */
export interface MessageAttachment {
  type: "image" | "file" | "audio" | "plugin-card";
  name: string;
  size: number;
  mime?: string;
  url: string;
  /** 插件卡片载荷（type="plugin-card"；协议见 types.ts，与 shared 对齐） */
  card?: PluginCardPayload;
}

/** 联系人 */
export interface Contact {
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

/** 注册用户（/api/auth/users） */
export interface UserInfo {
  id: string;
  username: string;
  displayName?: string;
  role?: string;
  /** 用户自定义头像 URL（服务端返回；未设置则前端色块兜底） */
  avatarUrl?: string;
}

/** 解析用户昵称（渲染发送者名） */
export function userName(usersById: Map<string, UserInfo>, id?: string): string | undefined {
  if (!id) return undefined;
  const u = usersById.get(id);
  return u ? (u.displayName || u.username) : undefined;
}

/** 为联系人信息弹窗构建展示数据（按联系人类型） */
export function contactInfoFor(contact: Contact, usersById: Map<string, UserInfo>) {
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