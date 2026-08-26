/**
 * 消息表情回应栏（P1-2）：emoji 计数 + 一键添加/取消
 * 接口：POST/DELETE /api/reactions/:messageId
 */
import { useState } from "react";
import { api } from "../lib/api";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

interface ReactionBarProps {
  messageId: string;
  reactions: Record<string, string[]>;
  currentUserId?: string;
  onToggle: (emoji: string, added: boolean) => void;
}

export function ReactionBar({ messageId, reactions, currentUserId, onToggle }: ReactionBarProps) {
  const [busy, setBusy] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  async function toggle(emoji: string) {
    if (busy || !currentUserId) return;
    setBusy(true);
    try {
      const users = reactions[emoji] ?? [];
      if (users.includes(currentUserId)) {
        await api.del(`/reactions/${messageId}/${encodeURIComponent(emoji)}`);
        onToggle(emoji, false);
      } else {
        await api.post(`/reactions/${messageId}`, { emoji });
        onToggle(emoji, true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1 relative">
      {Object.entries(reactions).map(([emoji, users]) => (
        <button
          key={emoji}
          onClick={() => void toggle(emoji)}
          disabled={busy}
          className={cls(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
            currentUserId && users.includes(currentUserId)
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-surface hover:border-primary/50 text-fg",
          )}
        >
          <span>{emoji}</span>
          <span className="font-medium">{users.length}</span>
        </button>
      ))}
      <button
        onClick={() => setShowPicker(!showPicker)}
        className="inline-flex items-center rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-muted hover:border-primary/50 hover:text-fg transition-colors"
        title="添加表情"
      >
        +
      </button>
      {showPicker && (
        <div className="absolute top-full left-0 z-20 mt-1 flex gap-1 rounded-lg border border-border bg-surface p-2 shadow-lg">
          {QUICK_EMOJIS.map((em) => (
            <button
              key={em}
              onClick={() => { void toggle(em); setShowPicker(false); }}
              className="text-lg hover:scale-110 transition-transform"
            >
              {em}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

import { cls } from "./ui"; // 需要 cls 工具
