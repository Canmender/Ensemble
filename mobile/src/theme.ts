/**
 * 移动端设计系统 — 深色专业主题
 * 统一配色 / 间距 / 圆角 / 排版，所有页面共用。
 */

export const colors = {
  /** 页面背景（蓝黑，非纯黑） */
  bg: "#0B1220",
  /** 卡片/表面 */
  surface: "#151E2E",
  /** 更高层表面（输入框、悬浮层） */
  surfaceAlt: "#1C2739",
  /** 边框 */
  border: "#243044",
  /** 主文本 */
  text: "#E2E8F0",
  /** 次级文本 */
  textMuted: "#94A3B8",
  /** 弱文本 */
  textFaint: "#64748B",
  /** 品牌主色 */
  primary: "#10B981",
  /** 主色弱背景 */
  primarySoft: "rgba(16, 185, 129, 0.12)",
  /** 强调色 */
  accent: "#3B82F6",
  danger: "#EF4444",
  warning: "#F59E0B",
  success: "#10B981",
  /** 输入框背景 */
  inputBg: "#1C2739",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
} as const;

export const fontSize = {
  xs: 12,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 22,
} as const;
