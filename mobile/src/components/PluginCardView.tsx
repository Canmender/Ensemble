/**
 * 插件卡片渲染（U1-C，与桌面 web PluginCard 同构）：按 cardType 分派内置模板。
 * 协议见 @ensemble/shared plugin-card.ts——未识别 cardType 渲染折叠框降级，永不白屏。
 * 动作点击 = 带 token POST /api/users/me/plugins/<插件id>/actions/<action> →
 * 响应新 state 做本端乐观刷新（权威更新由服务端广播的新消息自然追加）。
 */
import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { CardAction, PluginCardPayload, PollCardState } from "@ensemble/shared";
import { api } from "../services/api";
import { colors, spacing, radius, fontSize, elevation , ms } from "../theme";

export interface PluginCardViewProps {
  card: PluginCardPayload;
  /** 发卡片消息的 agentId = 插件 id（actions endpoint 据此前缀） */
  pluginId: string;
}

/** 动作分发 + 本端乐观刷新壳 */
function useCardActions(payload: PluginCardPayload, pluginId: string) {
  const [state, setState] = useState<Record<string, unknown>>(payload.state);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAction(action: CardAction) {
    if (busyAction) return;
    setBusyAction(action.id);
    setError(null);
    try {
      const res = await api.pluginCardAction(pluginId, action.endpoint, { ...(action.payload ?? {}) });
      if (res.error) {
        setError(res.error);
      } else if (res.data && typeof res.data === "object") {
        // 服务端广播的新卡片经 WS 到达后由消息流自然追加；此处仅做本端乐观刷新
        const d = res.data as Record<string, unknown>;
        setState((s) => (typeof d.totalVotes === "number" ? { ...s, totalVotes: d.totalVotes } : s));
      }
    } finally {
      setBusyAction(null);
    }
  }

  return { state, busyAction, error, runAction };
}

/** 卡片容器：标题 + 内容 + 动作按钮排 */
function CardFrame({
  card, pluginId, children,
}: { card: PluginCardPayload; pluginId: string; children: (state: Record<string, unknown>) => React.ReactNode }) {
  const { state, busyAction, error, runAction } = useCardActions(card, pluginId);
  return (
    <View style={styles.card}>
      {!!card.title && <Text style={styles.title}>{card.title}</Text>}
      {children(state)}
      {error && <Text style={styles.error}>{error}</Text>}
      {card.actions.length > 0 && (
        <View style={styles.actionRow}>
          {card.actions.map((a) => (
            <TouchableOpacity
              key={a.id}
              style={[styles.actionBtn, a.style === "primary" && styles.actionBtnPrimary, busyAction && styles.actionBtnDisabled]}
              disabled={!!busyAction}
              onPress={() => void runAction(a)}
              activeOpacity={0.7}
            >
              <Text style={[styles.actionBtnText, a.style === "primary" && styles.actionBtnTextPrimary]} numberOfLines={1}>
                {busyAction === a.id ? "…" : a.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

/** 投票卡（列表卡变体）：选项行点击投票 + 票数条 + closed 态置灰 */
function PollCardBody({ state }: { state: Record<string, unknown> }) {
  const s = state as Partial<PollCardState> & { myVotes?: string[] };
  const options = s.options ?? [];
  const votes = s.votes ?? {};
  const total = Number(s.totalVotes ?? 0);
  const closed = !!s.closed;
  const myVotes = s.myVotes ?? [];
  return (
    <View style={closed && styles.closedBlock}>
      {typeof s.question === "string" && <Text style={styles.pollQuestion}>{s.question}</Text>}
      {options.map((o) => {
        const n = votes[o.id] ?? 0;
        const pct = total > 0 ? Math.round((n / total) * 100) : 0;
        const mine = myVotes.includes(o.id);
        return (
          <View key={o.id} style={styles.pollRow}>
            <View style={styles.pollBarTrack}>
              <View style={[styles.pollBarFill, { width: `${pct}%` }, closed && styles.pollBarClosed]} />
              <View style={styles.pollRowInner} pointerEvents="none">
                <Ionicons
                  name={mine ? "checkmark-circle" : "ellipse-outline"}
                  size={14}
                  color={mine ? colors.primary : colors.textMuted}
                  style={{ marginRight: spacing.xs }}
                />
                <Text style={[styles.pollLabel, closed && styles.pollTextClosed]} numberOfLines={1}>{o.label}</Text>
                <Text style={[styles.pollCount, closed && styles.pollTextClosed]}>
                  {n} 票{total > 0 ? ` ${pct}%` : ""}
                </Text>
              </View>
            </View>
          </View>
        );
      })}
      <Text style={styles.pollTotal}>
        共 {total} 票{closed ? " · 已截止" : ""}
      </Text>
    </View>
  );
}

function PollCard({ card, pluginId }: PluginCardViewProps) {
  return (
    <CardFrame card={card} pluginId={pluginId}>
      {(state) => <PollCardBody state={state} />}
    </CardFrame>
  );
}

/** 通用键值列表卡 */
function ListCard({ card, pluginId }: PluginCardViewProps) {
  return (
    <CardFrame card={card} pluginId={pluginId}>
      {(state) => {
        const items = (state.items as Array<{ label?: string; value?: string }>) ?? [];
        return (
          <View>
            {items.map((it, i) => (
              <View key={i} style={styles.listRow}>
                <Text style={styles.listLabel} numberOfLines={1}>{it.label ?? `#${i + 1}`}</Text>
                <Text style={styles.listValue} numberOfLines={1}>{String(it.value ?? "")}</Text>
              </View>
            ))}
            {items.length === 0 && <Text style={styles.emptyText}>（空）</Text>}
          </View>
        );
      }}
    </CardFrame>
  );
}

/** 统计卡：大数字 + 标签网格 */
function StatsCard({ card, pluginId }: PluginCardViewProps) {
  return (
    <CardFrame card={card} pluginId={pluginId}>
      {(state) => {
        const stats = (state.stats as Array<{ label?: string; value?: number | string }>) ?? [];
        return (
          <View style={styles.statsGrid}>
            {stats.map((st, i) => (
              <View key={i} style={styles.statCell}>
                <Text style={styles.statValue}>{String(st.value ?? "-")}</Text>
                <Text style={styles.statLabel}>{st.label ?? ""}</Text>
              </View>
            ))}
          </View>
        );
      }}
    </CardFrame>
  );
}

/** 进度卡：单进度条 + 百分比 */
function ProgressCard({ card, pluginId }: PluginCardViewProps) {
  return (
    <CardFrame card={card} pluginId={pluginId}>
      {(state) => {
        const pct = Math.max(0, Math.min(100, Number(state.percent ?? 0)));
        return (
          <View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${pct}%` }]} />
            </View>
            <View style={styles.progressMeta}>
              <Text style={styles.progressLabel}>{String(state.label ?? "")}</Text>
              <Text style={styles.progressLabel}>{pct}%</Text>
            </View>
          </View>
        );
      }}
    </CardFrame>
  );
}

/** 图文卡：正文文本 */
function RichCard({ card, pluginId }: PluginCardViewProps) {
  return (
    <CardFrame card={card} pluginId={pluginId}>
      {(state) => <Text style={styles.richBody}>{String(state.body ?? "")}</Text>}
    </CardFrame>
  );
}

/** 未识别 cardType 的降级：折叠框显示 title + 原始 JSON（兼容性契约，永不白屏） */
export function FallbackCard({ card }: PluginCardViewProps) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.fallbackHeader} onPress={() => setOpen((v) => !v)} activeOpacity={0.7}>
        <Ionicons name={open ? "chevron-down" : "chevron-forward"} size={16} color={colors.textMuted} />
        <Text style={styles.fallbackTitle} numberOfLines={1}>
          {card.title || `未支持的卡片（${card.cardType}）`}
        </Text>
      </TouchableOpacity>
      {open && (
        <View style={styles.fallbackJsonWrap}>
          <Text style={styles.fallbackJson} selectable>
            {JSON.stringify({ cardType: card.cardType, cardVersion: card.cardVersion, state: card.state }, null, 2)}
          </Text>
        </View>
      )}
    </View>
  );
}

const TEMPLATES: Record<string, React.ComponentType<PluginCardViewProps>> = {
  poll: PollCard,
  list: ListCard,
  stats: StatsCard,
  progress: ProgressCard,
  rich: RichCard,
};

/** 模板分派入口（renderAttachment 的 plugin-card 分支调用） */
export function PluginCardView({ card, pluginId }: PluginCardViewProps) {
  const Template = TEMPLATES[card.cardType];
  if (!Template) return <FallbackCard card={card} pluginId={pluginId} />;
  return <Template card={card} pluginId={pluginId} />;
}

const styles = ms({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.xxs,
    maxWidth: 280,
    ...elevation.sm,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  actionBtnPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnText: { color: colors.text, fontSize: fontSize.xs, fontWeight: "600" },
  actionBtnTextPrimary: { color: colors.primaryFg },

  pollQuestion: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginBottom: spacing.sm,
  },
  pollRow: { marginBottom: spacing.sm },
  pollBarTrack: {
    height: 26,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  pollBarFill: {
    position: "absolute",
    left: 0, top: 0, bottom: 0,
    backgroundColor: "rgba(12,140,235,0.25)",
  },
  pollBarClosed: { backgroundColor: colors.surfaceTint },
  pollRowInner: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
  },
  pollLabel: { color: colors.text, fontSize: fontSize.xs, flex: 1, fontWeight: "500" },
  pollCount: { color: colors.textMuted, fontSize: fontSize.xs, marginLeft: spacing.sm },
  pollTotal: { color: colors.textFaint, fontSize: 10, marginTop: spacing.xxs },
  pollTextClosed: { color: colors.textFaint },
  closedBlock: { opacity: 0.75 },

  listRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: 3,
  },
  listLabel: { color: colors.textMuted, fontSize: fontSize.xs, flex: 1 },
  listValue: { color: colors.text, fontSize: fontSize.xs, fontWeight: "600", maxWidth: "60%" },
  emptyText: { color: colors.textFaint, fontSize: fontSize.xs },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statCell: {
    flexGrow: 1,
    minWidth: 100,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  statValue: { color: colors.text, fontSize: fontSize.xl, fontWeight: "700" },
  statLabel: { color: colors.textFaint, fontSize: 10, marginTop: 2 },

  progressTrack: {
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: colors.success },
  progressMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.xs,
  },
  progressLabel: { color: colors.textMuted, fontSize: 10 },

  richBody: { color: colors.text, fontSize: fontSize.xs, lineHeight: 18 },

  fallbackHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  fallbackTitle: { color: colors.text, fontSize: fontSize.sm, flex: 1 },
  fallbackJsonWrap: {
    marginTop: spacing.sm,
    maxHeight: 180,
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  fallbackJson: { color: colors.textMuted, fontSize: 10, fontFamily: "monospace" },
});
