/**
 * 消息编辑弹窗（P1）：长按/右键 → 编辑 → PUT 更新原内容
 * 接口：PUT /api/conversations/:convId/messages/:msgId
 */
import { useState } from "react";
import { api } from "../lib/api";

interface MessageEditModalProps {
  open: boolean;
  convId: string;
  msgId: string;
  originalContent: string;
  onClose: () => void;
  onEdited: (newContent: string) => void;
}

export function MessageEditModal({ open, convId, msgId, originalContent, onClose, onEdited }: MessageEditModalProps) {
  const [content, setContent] = useState(originalContent);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  async function save() {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await api.put(`/conversations/${convId}/messages/${msgId}`, { content: content.trim() });
      onEdited(content.trim());
      onClose();
    } catch (e) {
      console.error("编辑失败:", e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[90vw] max-w-md rounded-xl border border-border bg-surface p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-fg">编辑消息</span>
          <button onClick={onClose} className="text-muted hover:text-fg">✕</button>
        </div>
        <textarea
          className="w-full rounded-lg border border-border bg-bg p-3 text-sm text-fg resize-none focus:border-primary focus:outline-none"
          rows={3}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          autoFocus
        />
        <div className="mt-3 flex justify-end gap-2">
          <button className="px-3 py-1.5 text-sm text-muted hover:text-fg" onClick={onClose}>取消</button>
          <button
            className="px-3 py-1.5 text-sm rounded bg-primary text-primary-fg disabled:opacity-50"
            onClick={() => void save()}
            disabled={saving || !content.trim()}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
