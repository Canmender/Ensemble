/**
 * 移动端设计系统 — 2026 现代升级版
 * 分层表面 / 柔和投影 / 增量间距 / 大圆角 / 清爽蓝白（保留品牌识别）
 *
 * 设计要点（iOS-18 / 现代清爽风）：
 * - 尽量去描边，用「柔影 + 分层」表达层级，降低视觉噪点
 * - 圆角更圆润（卡片 md/lg/xl 由 12/16 拉大），按钮胶囊化
 * - 输入/卡片用浅色填充而非描边
 * - elevation 体系适配 RN（iOS shadow* + Android elevation）
 */

export const colors = {
  /** 页面背景（极浅蓝白） */
  bg: "#F6F7FB",
  /** 卡片/表面 */
  surface: "#FFFFFF",
  /** 更高层表面（输入框、悬浮层、hover） */
  surfaceAlt: "#F0F2F7",
  /** 侧边/图标底 */
  surfaceTint: "rgba(79,110,247,0.07)",
  /** 边框（弱化，尽量少用） */
  border: "#E9ECF2",
  /** 主文本 */
  text: "#14171F",
  /** 次级文本 */
  textMuted: "#5C6470",
  /** 弱文本 */
  textFaint: "#9AA1AD",
  /** 辅助文本 */
  textHelper: "#C6CBD4",

  /** 品牌主色（靛蓝，保持识别） */
  primary: "#4F6EF7",
  /** 主色弱背景 */
  primarySoft: "rgba(79,110,247,0.08)",
  /** 主色亮背景（聊天气泡-自己） */
  primaryBubble: "#6B83FF",
  /** 主色深（按压态/渐变收尾） */
  primaryDeep: "#3A56D8",
  /** 强调色（辅助蓝） */
  accent: "#3B82F6",

  /** 危险/错误 */
  danger: "#E5484D",
  /** 警告 */
  warning: "#F5A623",
  /** 成功 */
  success: "#25B564",

  /** 输入框背景（浅填充，非描边） */
  inputBg: "#F0F2F7",
  /** 对方消息气泡背景 */
  bubbleOther: "#EEF0F6",
  /** 时间分割线背景 */
  timeBadge: "rgba(20,23,31,0.06)",

  /** 渐变（大标语/品牌焦点/按钮可选用） */
  gradient: ["#4F6EF7", "#6B83FF"] as const,
  /** 纯白 */
  white: "#FFFFFF",
  /** 纯黑（遮罩） */
  scrim: "rgba(15,18,25,0.5)",
} as const;

/** 间距（增量尺度 4→40） */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

/** 圆角（更圆润） */
export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 28,
  full: 999,
} as const;

/** 字号 */
export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 26,
  xxxl: 32,
} as const;

/** 行高倍数 */
export const lineHeight = {
  tight: 1.2,
  normal: 1.4,
  relaxed: 1.6,
} as const;

/**
 * 柔和投影（RN 原生属性；elevation 仅 Android，iOS 用 shadow*）
 * 多层可选：sm（卡片默认）/ md（悬浮）/ lg（弹层）/ xl（浮层大卡）
 */
export const elevation = {
  none: { shadowColor: "#000", shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 } as const,
  sm: { shadowColor: "#0B1220", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 } as const,
  md: { shadowColor: "#0B1220", shadowOpacity: 0.09, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 4 } as const,
  lg: { shadowColor: "#0B1220", shadowOpacity: 0.12, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 10 } as const,
  xl: { shadowColor: "#0B1220", shadowOpacity: 0.16, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 16 } as const,
} as const;

/** 动画时长（ms） */
export const duration = {
  fast: 140,
  normal: 240,
  slow: 360,
} as const;
