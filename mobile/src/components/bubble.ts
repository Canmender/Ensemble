/**
 * 消息气泡分层（对齐桌面端 v0.8.15 的 Bubble/Message 改造，接口同构）
 *
 * 分层原则：气泡表面(Bubble) ≠ 消息容器(Message)——
 * 容器只管行布局/头像/多选操作；本模块负责「这个气泡长什么样」。
 * variant+tint 的选择逻辑集中在 bubbleVariantOf 纯函数，容器算好两参传给样式工厂。
 *
 * Variant 语义（与桌面端一致）：
 *   mine     自己发言 → 主色实心
 *   theirs   他人/设备 → muted 表面
 *   agent    群聊中 agent 发言 → 身份 tint（稳定散列五色板）
 *   ai-ghost 1:1 助手回复 → 左侧渐变边框 + 微透明背景，内容为重心
 */
import { colors, spacing, radius, fontSize } from "../theme";
import type { ViewStyle, TextStyle } from "react-native";

export type BubbleVariant = "mine" | "theirs" | "agent" | "ai-ghost";

/** agent 身份色板：明暗各五色（与桌面端 agentTint 同构的稳定散列） */
const AGENT_TINTS_LIGHT: Array<{ bg: string; line: string; text: string }> = [
  { bg: "#EDE9FE", line: "#8B5CF6", text: "#5B21B6" }, // violet
  { bg: "#E0F2FE", line: "#0EA5E9", text: "#075985" }, // sky
  { bg: "#D1FAE5", line: "#10B981", text: "#065F46" }, // emerald
  { bg: "#FEF3C7", line: "#F59E0B", text: "#92400E" }, // amber
  { bg: "#FCE7F3", line: "#EC4899", text: "#9D174D" }, // rose
];

const AGENT_TINTS_DARK: Array<{ bg: string; line: string; text: string }> = [
  { bg: "#2D1B69", line: "#8B5CF6", text: "#DDD6FE" }, // violet
  { bg: "#0C4A6E", line: "#0EA5E9", text: "#BAE6FD" }, // sky
  { bg: "#064E3B", line: "#10B981", text: "#A7F3D0" }, // emerald
  { bg: "#451A03", line: "#F59E0B", text: "#FDE68A" }, // amber
  { bg: "#831843", line: "#EC4899", text: "#FBCFE8" }, // rose
];

/** agentId → 稳定 tint（散列到五色板；同名永远同色） */
export function agentTint(agentId: string, isDark: boolean = false): { bg: string; line: string; text: string } {
  let h = 0;
  for (let i = 0; i < agentId.length; i++) h = (h * 31 + agentId.charCodeAt(i)) >>> 0;
  const tints = isDark ? AGENT_TINTS_DARK : AGENT_TINTS_LIGHT;
  return tints[h % tints.length];
}

/**
 * 判定气泡变体（纯函数，容器层调用后把 (variant, tint) 传给 bubbleStyles）
 *
 * @param isSelf      是否本人发言（容器已有 isMyMessage 判定，直接传入避免重复逻辑）
 * @param senderId    发送者 id（agent 会话中为 agentId；用户会话中为 userId）
 * @param isDirectAgent 是否 1:1 agent 会话（决定 assistant 回复走 ai-ghost 还是 theirs/agent）
 * @param role        消息角色（user/assistant）
 * @param isDark      暗色模式标志（从 useTheme().scheme 传入，用于选择 agent 身份色板）
 */
export function bubbleVariantOf(
  isSelf: boolean,
  senderId: string,
  isDirectAgent: boolean,
  role: "user" | "assistant",
  isDark: boolean = false,
): { variant: BubbleVariant; tint?: { bg: string; line: string; text: string } } {
  if (isSelf) return { variant: "mine" };
  // 1:1 agent 会话的助手回复：ghost 无框全宽（AI 回复为视觉重心的现代趋势）
  if (isDirectAgent && role === "assistant") return { variant: "ai-ghost", tint: agentTint(senderId, isDark) };
  // 群聊中的 agent 发言：身份 tint 表面；其余（他人用户/设备）muted 表面
  if (role === "assistant") return { variant: "agent", tint: agentTint(senderId, isDark) };
  return { variant: "theirs" };
}

/** 气泡表面样式（按 variant 返回容器+文字样式；tint 仅 agent/ai-ghost 使用） */
export function bubbleStyles(
  variant: BubbleVariant,
  tint?: { bg: string; line: string; text: string },
): { surface: ViewStyle; text: TextStyle; nameText?: TextStyle } {
  switch (variant) {
    case "mine":
      return {
        surface: { backgroundColor: colors.primaryBubble, borderBottomRightRadius: radius.sm },
        text: { color: "#fff" },
      };
    case "agent":
      return {
        surface: {
          backgroundColor: tint?.bg ?? colors.bubbleOther,
          borderBottomLeftRadius: radius.sm,
          borderLeftWidth: 2,
          borderLeftColor: tint?.line ?? "transparent",
        },
        text: { color: colors.text },
        nameText: tint ? { color: tint.text } : undefined,
      };
    case "ai-ghost":
      return {
        // 左侧渐变边框 + 微透明背景：辨识度高于纯无框，但不喧宾夺主
        surface: {
          backgroundColor: tint?.line ? `${tint.line}08` : `${colors.primary}08`,
          maxWidth: "100%",
          borderLeftWidth: 2,
          borderLeftColor: tint?.line ?? colors.primary,
          paddingLeft: spacing.md,
          paddingVertical: spacing.sm,
          borderRadius: radius.sm,
          elevation: 0,
        },
        text: { color: colors.text },
        nameText: tint ? { color: tint.text } : undefined,
      };
    case "theirs":
    default:
      return {
        surface: { backgroundColor: colors.bubbleOther, borderBottomLeftRadius: radius.sm },
        text: { color: colors.text },
      };
  }
}
