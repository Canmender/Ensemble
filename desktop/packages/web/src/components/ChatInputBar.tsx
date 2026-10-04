/**
 * 底部输入区：附件预览 / 引用条 / @提及面板 / 表情面板 / 多选工具栏 / 文件选择 / 输入框 / 发送。
 * 从 ChatPage.tsx 抽出。
 */

import { useRef, useState } from "react";
import { Image as ImageIcon, Paperclip, Send, X } from "lucide-react";
import { Avatar } from "./Avatar";
import { Button, Input, Spinner, cls } from "./ui";
import type { Contact, MessageAttachment, UserInfo } from "../pages/chat/types";

interface Props {
  activeContact: Contact;
  inputText: string;
  draftAttachment: MessageAttachment | null;
  replyTo: { id: string; content: string; senderName?: string } | null;
  showEmoji: boolean;
  multiSelect: boolean;
  selectedCount: number;
  uploading: boolean;
  sending: boolean;
  usersById: Map<string, UserInfo>;
  onChangeText: (v: string) => void;
  onSend: () => void;
  onPickFile: (file: File | undefined, asImage: boolean) => void;
  onCancelAttachment: () => void;
  onCancelReply: () => void;
  onPickMention: (name: string) => void;
  onInsertEmoji: (e: string) => void;
  onToggleEmoji: () => void;
  onCloseEmoji: () => void;
  onToggleMultiSelect: () => void;
  onForwardSelected: () => void;
}

export default function ChatInputBar(props: Props) {
  const {
    activeContact, inputText, draftAttachment, replyTo,
    showEmoji, multiSelect, selectedCount, uploading, sending, usersById,
    onChangeText, onSend, onPickFile, onCancelAttachment, onCancelReply, onPickMention,
    onInsertEmoji, onToggleEmoji, onCloseEmoji, onToggleMultiSelect, onForwardSelected,
  } = props;
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  // @提及面板的开关由输入内容驱动（末位 @ 后 20 字内且其后无空格），与页面数据流无关，
  // 故留在本组件内，不上抛 ChatPage。
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  return (
            <div className="border-t border-border px-6 py-4">
              {/* 待发送附件预览 */}
              {draftAttachment && (
                <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted/20 px-3 py-2">
                  {draftAttachment.type === "image" ? <ImageIcon className="h-4 w-4 text-muted" /> : <Paperclip className="h-4 w-4 text-muted" />}
                  <span className="flex-1 truncate text-xs text-muted">{draftAttachment.name}</span>
                  <button
                    onClick={onCancelAttachment}
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
                  <button onClick={onCancelReply} className="rounded p-1 text-muted hover:text-fg" aria-label="取消引用"><X className="h-3 w-3" /></button>
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
                          onPickMention(name);
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
                    <button key={e} onClick={() => onInsertEmoji(e)} className="p-1 text-lg hover:bg-muted/10 rounded">{e}</button>
                  ))}
                </div>
              )}
              {/* 多选转发工具栏 */}
              {multiSelect && (
                <div className="mb-2 flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2">
                  <span className="text-xs text-muted">已选 {selectedCount} 条</span>
                  <button onClick={onForwardSelected} disabled={selectedCount === 0} className="ml-auto rounded-lg bg-primary px-3 py-1 text-xs text-primary-fg disabled:opacity-40">转发</button>
                  <button onClick={onToggleMultiSelect} className="rounded-lg px-2 py-1 text-xs text-muted hover:text-fg">取消</button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    void onPickFile(e.target.files?.[0], true);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    void onPickFile(e.target.files?.[0], false);
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
                  onClick={onToggleEmoji}
                  className="rounded-lg p-2 text-muted transition-colors hover:bg-muted/10 hover:text-fg"
                  title="表情"
                  aria-label="表情"
                >
                  <span className="text-base leading-none">😀</span>
                </button>
                <button
                  onClick={onToggleMultiSelect}
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
                    onChangeText(v);
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
                    if (e.key === "Enter" && !e.shiftKey && !mentionOpen) onSend();
                    if (e.key === "Escape") { setMentionOpen(false); onCloseEmoji(); }
                  }}
                  placeholder={`发送给 ${activeContact.name}...`}
                  className="flex-1"
                  disabled={sending || uploading}
                />
                <Button
                  onClick={onSend}
                  disabled={(!inputText.trim() && !draftAttachment) || sending || uploading}
                  className="px-4"
                  aria-label="发送消息"
                >
                  {sending || uploading ? <Spinner /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
  );
}
