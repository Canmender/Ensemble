/**
 * 插件卡片渲染（U1-C）：按 cardType 分派到内置模板。
 * 协议见 shared/src/types/plugin-card.ts——未识别类型渲染折叠框降级，永不白屏。
 * 动作点击 = 带 token POST /api/users/me/plugins/<插件id><endpoint> → 响应新 state 原位刷新。
 */
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { CardAction, PluginCardPayload } from "../types";
import { api } from "../lib/api";
import { Button, cls } from "./ui";

/** 卡片消息归属的插件 id（actions endpoint 据此前缀）——由消息 agentId 传入 */
interface CardProps {
  payload: PluginCardPayload;
  /** 发卡片消息的 agentId = 插件 id（poll 插件发的是 "poll"） */
  pluginId: string;
}

/** 单张卡片的交互壳：动作分发 + state 原位更新 */
function CardFrame({ payload, pluginId, children }: CardProps & { children: (state: Record<string, unknown>) => React.ReactNode }) {
  const [state, setState] = useState(payload.state);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  async function runAction(action: CardAction) {
    if (busyAction) return;
    setBusyAction(action.id);
    try {
      // 点击方带用户 token 走统一动作端点；响应若带新 state 则原位刷新
      const res = await api.post<Record<string, unknown>>(
        `/users/me/plugins/${pluginId}/actions${action.endpoint}`,
        { ...(action.payload ?? {}), ...(state.pollId ? { pollId: state.pollId } : {}) },
      );
      if (res && typeof res === "object") {
        // 服务端广播的新卡片经 WS 到达后由消息流自然追加；
        // 此处仅做本端乐观刷新（totalVotes 等聚合值）
        if (typeof res.totalVotes === "number") setState((s) => ({ ...s, totalVotes: res.totalVotes as number }));
      }
    } catch (e) {
      console.warn("card action failed:", e);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="mt-1 rounded-xl border border-border bg-surface p-3">
      {payload.title && <div className="mb-2 text-sm font-semibold text-fg">{payload.title}</div>}
      {children(state)}
      {payload.actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {payload.actions.map((a) => (
            <Button
              key={a.id}
              variant={a.style === "primary" ? "primary" : "secondary"}
              className="!px-3 !py-1 text-xs"
              disabled={busyAction !== null}
              onClick={() => void runAction(a)}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 投票卡（列表卡变体）：选项行 + 票数条 */
function PollCard({ payload, pluginId }: CardProps) {
  return (
    <CardFrame payload={payload} pluginId={pluginId}>
      {(state) => {
        const options = (state.options as Array<{ id: string; label: string }>) ?? [];
        const votes = (state.votes as Record<string, number>) ?? {};
        const total = Number(state.totalVotes ?? 0);
        return (
          <div className="space-y-1.5">
            {typeof state.question === "string" && <div className="text-xs text-muted">{state.question}</div>}
            {options.map((o) => {
              const n = votes[o.id] ?? 0;
              const pct = total > 0 ? Math.round((n / total) * 100) : 0;
              return (
                <div key={o.id} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 truncate text-fg">{o.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/20">
                    <div className="h-full rounded-full bg-primary/70 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-12 shrink-0 text-right text-muted">{n} 票 {pct}%</span>
                </div>
              );
            })}
            <div className="pt-0.5 text-[10px] text-muted">共 {total} 票</div>
          </div>
        );
      }}
    </CardFrame>
  );
}

/** 通用键值列表卡 */
function ListCard({ payload, pluginId }: CardProps) {
  return (
    <CardFrame payload={payload} pluginId={pluginId}>
      {(state) => {
        const items = (state.items as Array<{ label?: string; value?: string }>) ?? [];
        return (
          <div className="space-y-1">
            {items.map((it, i) => (
              <div key={i} className="flex justify-between gap-3 text-xs">
                <span className="truncate text-muted">{it.label ?? `#${i + 1}`}</span>
                <span className="shrink-0 font-medium text-fg">{String(it.value ?? "")}</span>
              </div>
            ))}
          </div>
        );
      }}
    </CardFrame>
  );
}

/** 统计卡：大数字 + 标签 */
function StatsCard({ payload, pluginId }: CardProps) {
  return (
    <CardFrame payload={payload} pluginId={pluginId}>
      {(state) => {
        const stats = (state.stats as Array<{ label?: string; value?: number | string }>) ?? [];
        return (
          <div className="grid grid-cols-2 gap-2">
            {stats.map((s, i) => (
              <div key={i} className="rounded-lg bg-muted/10 p-2">
                <div className="text-lg font-bold text-fg">{String(s.value ?? "-")}</div>
                <div className="text-[10px] text-muted">{s.label ?? ""}</div>
              </div>
            ))}
          </div>
        );
      }}
    </CardFrame>
  );
}

/** 进度卡：单进度条 + 百分比 */
function ProgressCard({ payload, pluginId }: CardProps) {
  return (
    <CardFrame payload={payload} pluginId={pluginId}>
      {(state) => {
        const pct = Math.max(0, Math.min(100, Number(state.percent ?? 0)));
        return (
          <div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted/20">
              <div className="h-full rounded-full bg-success/80 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted">
              <span>{String(state.label ?? "")}</span>
              <span>{pct}%</span>
            </div>
          </div>
        );
      }}
    </CardFrame>
  );
}

/** 图文卡：正文文本 */
function RichCard({ payload, pluginId }: CardProps) {
  return (
    <CardFrame payload={payload} pluginId={pluginId}>
      {(state) => (
        <div className="whitespace-pre-wrap text-xs leading-relaxed text-fg">{String(state.body ?? "")}</div>
      )}
    </CardFrame>
  );
}

/** 未识别 cardType 的降级：折叠框显示 title + 原始 JSON（兼容性契约，永不白屏） */
export function FallbackCard({ payload, pluginId }: CardProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1 rounded-xl border border-border bg-surface p-3">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 text-left text-sm text-fg">
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted" />}
        <span className="truncate">{payload.title || `未支持的卡片（${payload.cardType}）`}</span>
      </button>
      {open && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted/10 p-2 text-[10px] leading-relaxed text-muted">
          {JSON.stringify({ cardType: payload.cardType, cardVersion: payload.cardVersion, state: payload.state }, null, 2)}
        </pre>
      )}
      {void pluginId}
    </div>
  );
}

/** 模板分派入口（ChatPage 附件分支调用） */
const TEMPLATES: Record<string, (p: CardProps) => React.ReactNode> = {
  poll: PollCard,
  list: ListCard,
  stats: StatsCard,
  progress: ProgressCard,
  rich: RichCard,
};

export function PluginCardView({ card, pluginId }: { card: PluginCardPayload; pluginId: string }) {
  const Template = TEMPLATES[card.cardType];
  if (!Template) return <FallbackCard payload={card} pluginId={pluginId} />;
  return <Template payload={card} pluginId={pluginId} />;
}

void cls;
