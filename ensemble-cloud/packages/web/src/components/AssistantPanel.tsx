import { useEffect, useRef, useState } from "react";
import { Bot, Send, X } from "lucide-react";
import { api } from "../lib/api";
import { cls } from "./ui";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

/** 空状态时的预设问题（点击直接提问） */
const SUGGESTIONS = [
  "合鸣是什么？能帮我做什么？",
  "怎么创建一个多 Agent 协作任务？",
  "五种编排模式分别适合什么场景？",
  "如何接入 Claude Code 等 CLI Agent？",
];

/**
 * 产品助手侧滑面板：右下角入口展开的一问一答。
 * 后端 /api/assistant/ask 以 chat 模式跑一次内置助手 agent 并等待回复。
 */
export function AssistantPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    api
      .get<{ available: boolean }>("/assistant/status")
      .then((s) => setAvailable(s.available))
      .catch(() => setAvailable(false));
  }, [isOpen]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [msgs, pending]);

  if (!isOpen) return null;

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || pending) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: message }]);
    setPending(true);
    try {
      const r = await api.post<{ reply: string | null; timeout: boolean }>("/assistant/ask", { message });
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          content:
            r.reply ??
            (r.timeout ? "回复超时了。请稍后重试，或到「联系人」页直接与 Agent 对话查看。" : "（本次没有产生回复）"),
        },
      ]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: `出错了：${(e as Error).message}` }]);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="产品助手">
      <button aria-label="关闭助手面板" onClick={onClose} className="absolute inset-0 bg-black/30" />

      <div className="relative flex h-full w-[400px] max-w-[92vw] flex-col border-l border-border bg-surface shadow-xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <div>
              <div className="text-sm font-bold text-fg">产品助手</div>
              <div className="text-[11px] text-muted">
                {available === false ? "暂无可用 Agent" : "解答合鸣的使用问题"}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-muted/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            title="关闭"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 消息区 */}
        <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {msgs.length === 0 && (
            <div className="space-y-2 pt-4">
              <p className="text-sm text-muted">你好！我是合鸣产品助手，试试这些问题：</p>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  disabled={pending || available === false}
                  className={cls(
                    "block w-full rounded-lg border border-border px-3 py-2 text-left text-sm text-fg transition-colors",
                    "hover:border-primary/60 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {msgs.map((msg, i) => (
            <div key={i} className={cls("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
              {msg.role === "assistant" && (
                <span className="mr-2 mt-1 shrink-0">
                  <Bot className="h-4 w-4 text-primary" />
                </span>
              )}
              <div
                className={cls(
                  "max-w-[80%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm",
                  msg.role === "user" ? "bg-primary text-primary-fg" : "bg-muted/10 text-fg",
                )}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {pending && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-lg bg-muted/10 px-3 py-2 text-sm text-muted">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                思考中…
              </div>
            </div>
          )}
        </div>

        {/* 输入区 */}
        <form
          className="flex items-end gap-2 border-t border-border px-3 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            placeholder={available === false ? "暂无可用 Agent，请先在设置中启用" : "输入问题，Enter 发送…"}
            disabled={pending || available === false}
            className="flex-1 resize-none rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-muted/60 focus:border-primary/60 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={pending || !input.trim() || available === false}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-fg transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            title="发送"
            aria-label="发送"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
