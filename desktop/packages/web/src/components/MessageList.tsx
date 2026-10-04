/**
 * 右侧消息列表：消息气泡渲染 + 每条消息的操作（引用/转发/编辑/撤回/已读/多选/表情回应）。
 * 从 ChatPage.tsx 抽出。本组件不持有业务 state，状态与回调全部由 ChatPage 传入。
 */

import { useEffect, useRef, type RefObject } from "react";
import { MessageSquare } from "lucide-react";
import { Avatar } from "./Avatar";
import { ReactionBar } from "./ReactionBar";
import { Spinner, cls } from "./ui";
import { Bubble, agentTint, bubbleVariantOf, renderContent, AttachmentView, groupMessagesByDay } from "../pages/chat/messageViews";
import type { ChatMessage, Contact, UserInfo } from "../pages/chat/types";

interface Props {
  messages: ChatMessage[];
  activeContact: Contact;
  meId?: string;
  usersById: Map<string, UserInfo>;
  multiSelect: boolean;
  selectedMsgs: Set<string>;
  peerReadTs?: number;
  groupRunning: boolean;
  bottomRef: RefObject<HTMLDivElement>;
  onToggleSelect: (id: string) => void;
  onQuote: (msg: ChatMessage) => void;
  onForward: (msg: ChatMessage) => void;
  onEdit: (msg: ChatMessage) => void;
  onRecall: (msg: ChatMessage) => void;
  onToggleReaction: (messageId: string, emoji: string, added: boolean) => void;
}

export default function MessageList(props: Props) {
  const {
    messages, activeContact, meId, usersById, multiSelect, selectedMsgs, peerReadTs,
    groupRunning, bottomRef, onToggleSelect, onQuote, onForward, onEdit, onRecall, onToggleReaction,
  } = props;

  // 入场动画只给「本次渲染新增的那一条」，避免整列表（可能几百条）同时播放。
  // 判断放在本组件内（ref + 一次比较），不依赖 ChatPage 的数据流。
  const prevRef = useRef<{ contactId: string; firstId?: string; lastId?: string }>({ contactId: "" });
  const prev = prevRef.current;
  const firstId = messages.length > 0 ? messages[0].id : undefined;
  const lastId = messages.length > 0 ? messages[messages.length - 1].id : undefined;
  // 切换会话时不播；同会话内要求「末条变了（新增在尾部）且首条没变（不是在头部补拉）」。
  // 补拉历史是 prepend，首条会变而末条不变；新增是 append，末条变而首条不变。
  const animateId =
    prev.contactId === activeContact.id &&
    prev.firstId &&
    prev.lastId &&
    firstId === prev.firstId &&
    lastId !== prev.lastId
      ? lastId
      : undefined;
  useEffect(() => {
    prevRef.current = { contactId: activeContact.id, firstId, lastId };
  }, [activeContact.id, firstId, lastId]);

  return (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <div className="text-center">
                    <MessageSquare className="mx-auto h-12 w-12 text-muted/30" />
                    <p className="mt-2 text-sm text-muted">开始与 {activeContact.name} 对话</p>
                  </div>
                </div>
              ) : (
                groupMessagesByDay(messages).map((group) => (
                <div key={group.day} className="space-y-4">
                  <div className="flex items-center gap-3 py-1">
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-[10px] font-medium text-muted">{group.label}</span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  {group.items.map((msg) => {
                  const variant = bubbleVariantOf(msg, activeContact, meId);
                  const tint = variant === "agent" && msg.agentId ? agentTint(msg.agentId) : undefined;
                  const isMine = msg.sender === "user";
                  return (
                  <div
                    key={msg.id}
                    className={cls(
                      "group relative flex",
                      isMine ? "justify-end" : "justify-start",
                      msg.id === animateId && "bubble-in",
                    )}
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      {multiSelect && (
                        <button
                          onClick={() => onToggleSelect(msg.id)}
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
                            {(activeContact.type === "group" || activeContact.type === "user") && msg.agentId && msg.agentId !== "user" && msg.agentId !== meId && (
                              <div className={cls("mb-1 text-[11px] font-semibold", variant === "ai-ghost" ? "text-muted" : "opacity-90")}>
                                {activeContact.type === "user" ? (msg.senderName ?? msg.agentId) : `@${msg.agentId}`}
                              </div>
                            )}
                            {msg.attachment && <AttachmentView att={msg.attachment} content={msg.content} pluginId={msg.agentId} />}
                            {msg.content && <div className={cls("whitespace-pre-wrap leading-relaxed", variant === "ai-ghost" ? "text-sm text-fg" : "text-sm")}>{renderContent(msg.content)}</div>}
                            {msg.status === 3 && !msg.content.startsWith("{") && <div className="text-[10px] text-muted italic mt-0.5">已编辑</div>}
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
                              <button onClick={() => onQuote(msg)} className="text-[10px] opacity-0 transition-opacity group-hover:opacity-100 hover:underline" title="引用回复">引用</button>
                              <button onClick={() => onForward(msg)} className="text-[10px] opacity-0 transition-opacity group-hover:opacity-100 hover:underline" title="转发">转发</button>
                              {isMine && activeContact?.convId && (
                                <button
                                  onClick={() => onEdit(msg)}
                                  className="text-[10px] opacity-0 transition-opacity group-hover:opacity-100 hover:underline"
                                  title="编辑"
                                >
                                  编辑
                                </button>
                              )}
                            </>
                          )}
                          {isMine && !msg.deleted && activeContact?.convId && (
                            <button
                              onClick={() => onRecall(msg)}
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
                        {/* P1-2: Reaction 摘要栏（每条消息下方） */}
                        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                          <ReactionBar
                            messageId={msg.id}
                            reactions={msg.reactions}
                            currentUserId={meId}
                            onToggle={(emoji: string, added: boolean) => onToggleReaction(msg.id, emoji, added)}
                          />
                        )}
                      </Bubble>
                    </div>
                  </div>
                  );
                  })}
                </div>
                ))
              )}
              {/* 群聊运行中提示 */}
              {activeContact.type === "group" && groupRunning && (
                <div className="flex items-center gap-2 text-muted">
                  <Spinner label="Agent 们正在对话…" />
                </div>
              )}
              <div ref={bottomRef} />
            </div>
  );
}
