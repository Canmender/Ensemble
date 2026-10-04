/**
 * 消息展示层：把一条 ChatMessage 渲染成气泡的纯展示逻辑。
 * 从 ChatPage.tsx 抽出。除 VoiceBubble 自有音频播放状态外，不持有业务 state。
 */

import { useRef, useState } from "react";
import { File as FileIcon } from "lucide-react";
import { Avatar } from "../../components/Avatar";
import { PluginCardView } from "../../components/PluginCard";
import { isPluginCard } from "../../types";
import { cls } from "../../components/ui";
import type { ChatMessage, Contact, MessageAttachment } from "./types";

/** 高亮消息中的 @提及（@agent 或 @agent:任务），服务端据此解析委派 */
export function renderContent(text: string): React.ReactNode {
  const parts = text.split(/(@[a-zA-Z0-9-]+(?:\s*[:：]\s*\S+)?)/g);
  return parts.map((part, i) =>
    /^@[a-zA-Z0-9-]+/.test(part) ? (
      <span key={i} className="font-medium text-primary">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** 文件大小格式化 */
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 消息附件渲染（图片缩略图 / 文件卡片） */
export function AttachmentView({ att, content, pluginId }: { att: MessageAttachment; content?: string; pluginId?: string }) {
  // 插件卡片（U1）：按 cardType 分派内置模板；未识别类型折叠框降级（永不白屏）
  if (att.type === "plugin-card") {
    if (att.card && isPluginCard(att)) {
      return <PluginCardView card={att.card} pluginId={pluginId || att.card.cardType} />;
    }
    return <div className="mb-1 text-xs italic opacity-60">卡片数据异常</div>;
  }
  if (att.type === "audio") {
    const url = (typeof window !== "undefined" && window.location && window.location.origin) ? att.url.startsWith("http") ? att.url : (window.location.origin + att.url) : att.url;
    return <VoiceBubble url={url} durationText={content} isUser={false} />;
  }
  if (att.type === "image") {
    return (
      <div className="mb-2">
        <img src={att.url} alt={att.name} className="max-h-56 w-auto rounded-lg object-contain" />
        <div className="mt-1 text-[10px] opacity-70">{att.name} · {fmtSize(att.size)}</div>
      </div>
    );
  }
  return (
    <a
      href={att.url}
      download={att.name}
      target="_blank"
      rel="noreferrer"
      className="mb-2 flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-xs transition-colors hover:bg-black/10"
    >
      <FileIcon className="h-4 w-4 shrink-0" />
      <span className="truncate">{att.name}</span>
      <span className="shrink-0 text-muted">{fmtSize(att.size)}</span>
    </a>
  );
}

/**
 * 消息气泡变体（调研《UI组件层调研》：气泡表面 ≠ 消息容器）。
 * - mine：自己发言，主色实心
 * - theirs：他人/系统发言，muted 表面
 * - agent：群聊中 agent 发言，按身份 tint 区分（身份色从 agentId 稳定散列）
 * - ai-ghost：AI 助手消息趋向无框全宽 ghost 形态（弱化表面、强调内容）
 */
export type BubbleVariant = "mine" | "theirs" | "agent" | "ai-ghost";

/**
 * agentId → 身份 tint 色（稳定散列到固定色板；与调研建议的多 agent 身份色一致）。
 * 底色用 agent 色 10% 透明度，文字用身份色本体——明暗档由 token 自动切换，无需 dark: 变体。
 */
const AGENT_TINTS = [
  "bg-agent-violet/10 text-agent-violet",
  "bg-agent-sky/10 text-agent-sky",
  "bg-agent-emerald/10 text-agent-emerald",
  "bg-agent-amber/10 text-agent-amber",
  "bg-agent-rose/10 text-agent-rose",
];
export function agentTint(agentId: string): string {
  let h = 0;
  for (let i = 0; i < agentId.length; i++) h = (h * 31 + agentId.charCodeAt(i)) >>> 0;
  return AGENT_TINTS[h % AGENT_TINTS.length];
}

/** Bubble 表面：内容载体，按变体着形。children 即消息内容区。 */
export function Bubble({ variant, tint, children }: {
  variant: BubbleVariant;
  tint?: string;
  children: React.ReactNode;
}) {
  if (variant === "ai-ghost") {
    // AI 助手 ghost 形态：无框全宽、左侧细线标识来源，视觉重心在内容
    return (
      <div className={cls("w-full rounded-xl border-l-2 px-4 py-2.5", tint ?? "border-primary bg-muted/5")}>
        {children}
      </div>
    );
  }
  return (
    <div
      className={cls(
        "relative max-w-[70%] rounded-2xl px-4 py-2.5",
        variant === "mine" && "bg-primary text-primary-fg rounded-br-md",
        variant === "theirs" && "bg-muted/20 text-fg rounded-bl-md",
        variant === "agent" && cls("rounded-bl-md", tint ?? agentTint("agent")),
      )}
    >
      {children}
    </div>
  );
}

/** 判定消息的气泡变体（Message 容器层调用；分层接口对移动端同样适用） */
export function bubbleVariantOf(msg: ChatMessage, contact: Contact, meId?: string): BubbleVariant {
  if (msg.sender === "user") return "mine";
  // AI 助手 ghost：agent 会话（1:1 与智能体对话）中的助手回复
  if (contact.type === "agent") return "ai-ghost";
  // 群聊中的 agent 发言 → 身份 tint；其余（用户会话对方 / 设备）→ theirs
  if (contact.type === "group" && msg.agentId && msg.agentId !== meId) return "agent";
  return "theirs";
}

/** 语音消息气泡：显示时长 + 播放按钮（播放移动端上传的 m4a，[语音 Xs] 内容） */
function VoiceBubble({ url, durationText, isUser }: { url?: string; durationText?: string; isUser: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const dur = (() => { const m = (durationText || "").match(/(\d+)\s*s/); return m ? m[1] : null; })();

  function toggle() {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); return; }
    void audioRef.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  return (
    <div className="mb-2 inline-flex items-center gap-2">
      <audio ref={audioRef}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        preload="none"
        src={url} />
      <button
        onClick={toggle}
        className="flex items-center gap-2 rounded-lg bg-black/5 px-3 py-1.5 text-xs transition-colors hover:bg-black/10"
        title="点击播放/暂停语音"
      >
        {playing ? <span className="h-2 w-2 rounded-full bg-primary animate-pulse" /> : <span className="inline-block h-2 w-2 rounded-full border border-current" />}
        <span>{dur ? `${dur}″` : "语音"}</span>
      </button>
    </div>
  );
}

