/**
 * 移动端设计系统 — 参考 box-im/V-IM 设计规范升级
 * 统一配色 / 间距 / 圆角 / 排版 / 阴影 / 动画，所有页面共用。
 */

export const colors = {
  /** 页面背景（极浅蓝白，参考 box-im #f8f9ff） */
  bg: "#F8F9FE",
  /** 卡片/表面 */
  surface: "#FFFFFF",
  /** 更高层表面（输入框、悬浮层） */
  surfaceAlt: "#F0F2F5",
  /** 边框（参考 box-im 四级边框） */
  border: "#E8ECF0",
  /** 主文本 */
  text: "#1A1A2E",
  /** 次级文本（参考 box-im #6a6a6a） */
  textMuted: "#6A6A6A",
  /** 弱文本（参考 box-im #909399） */
  textFaint: "#909399",
  /** 辅助文本 */
  textHelper: "#C7C7C7",
  /** 品牌主色（参考 box-im 靛蓝色 #3e45d7 + V-IM 蓝色 #2590c2） */
  primary: "#4F6EF7",
  /** 主色弱背景 */
  primarySoft: "rgba(79, 110, 247, 0.08)",
  /** 主色亮背景（聊天气泡-自己，参考 box-im light-2） */
  primaryBubble: "#6B83FF",
  /** 强调色 */
  accent: "#3B82F6",
  /** 危险/错误（参考 box-im #e43d33） */
  danger: "#E43D33",
  /** 警告（参考 box-im #f3a73f） */
  warning: "#F3A73F",
  /** 成功（参考 box-im #18bc37） */
  success: "#18BC37",
  /** 输入框背景 */
  inputBg: "#F0F2F5",
  /** 对方消息气泡背景（参考 box-im #f8f9ff） */
  bubbleOther: "#F0F2F8",
  /** 时间分割线背景 */
  timeBadge: "rgba(0,0,0,0.06)",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 999,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
} as const;

/** 阴影体系（参考 box-im 四级阴影） */
export const shadows = {
  none: "none" as const,
  sm: "0 1px 3px rgba(0,0,0,0.06)",
  md: "0 2px 8px rgba(0,0,0,0.08)",
  lg: "0 4px 16px rgba(0,0,0,0.10)",
  xl: "0 8px 24px rgba(0,0,0,0.12)",
} as const;

/** 动画时常（ms） */
export const duration = {
  fast: 150,
  normal: 250,
  slow: 350,
} as const;
