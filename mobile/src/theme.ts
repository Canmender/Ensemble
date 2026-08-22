/**
 * 移动端设计系统 — 设计 token 单源消费
 *
 * 颜色权威源：desktop/packages/shared/design/tokens.json（双端同源），
 * 构建产物 mobile/src/design/generated/tokens.ts（build-tokens.mjs 生成，手改无效）。
 * 本文件维护旧键名 → token 的兼容映射，页面代码无需改动；新代码优先用 themeTokens。
 */
import { LightTheme, type EnsembleTheme } from "./design/generated/tokens";

/** 语义 token（构建期 hex，与桌面端 CSS vars 同值） */
export const themeTokens: EnsembleTheme = LightTheme;

const PURE = {
  clay: "#8F7D6F",
  xuan: "#3B3F4A",
  taupe: "#897F75",
  ink: "#3D3D3D",
  white: "#FFFFFF",
  black: "#000000",
  amber: "#C4933F",
  lightGray: "#F5F5F5",
  midGray: "#E8E8E8",
  darkGray: "#666666",
} as const;

export const colors = {
  primary: PURE.xuan,
  primaryDeep: PURE.black,
  primarySoft: "#F0F0F0",
  primaryBubble: PURE.xuan,
  gradient: [PURE.xuan, PURE.ink] as const,

  text: "#1A1A1A",
  textEmphasis: PURE.black,
  textMuted: "#555555",
  textFaint: "#888888",
  textHelper: PURE.taupe,

  bg: PURE.lightGray,
  surface: PURE.white,
  surfaceAlt: "#F8F8F8",
  border: "#E5E5E5",

  accent: PURE.amber,
  clay: PURE.clay,
  accentSoft: "#F5F0E8",
  surfaceTint: "#F8F8F8",

  danger: "#E74C3C",
  warning: PURE.amber,
  success: "#27AE60",

  inputBg: PURE.white,
  bubbleOther: "#F0F0F0",
  timeBadge: PURE.darkGray,

  white: PURE.white,
  black: PURE.black,
  scrim: "rgba(0,0,0,0.5)",

  glassHighlight: PURE.white,
  glassShadow: PURE.black,

  // Tab bar
  tabBg: PURE.white,
  tabActive: PURE.xuan,
  tabInactive: "#999999",
  tabBorder: "#E5E5E5",
} as const;

export const spacing = { xxs:2, xs:4, sm:8, md:12, lg:16, xl:20, xxl:24, xxxl:32, huge:40 } as const;
export const radius = { xs:6, sm:10, md:14, lg:18, xl:24, xxl:28, full:999 } as const;
export const fontSize = { xs:11, sm:13, md:15, lg:17, xl:20, xxl:26, xxxl:32 } as const;
export const lineHeight = { tight:1.2, normal:1.4, relaxed:1.6 } as const;

export const elevation = {
  none: { shadowColor:"#000", shadowOpacity:0, shadowRadius:0, shadowOffset:{width:0,height:0}, elevation:0 } as const,
  sm: { shadowColor:"#000", shadowOpacity:0.04, shadowRadius:4, shadowOffset:{width:0,height:1}, elevation:1 } as const,
  md: { shadowColor:"#000", shadowOpacity:0.06, shadowRadius:8, shadowOffset:{width:0,height:2}, elevation:2 } as const,
  lg: { shadowColor:"#000", shadowOpacity:0.08, shadowRadius:12, shadowOffset:{width:0,height:4}, elevation:4 } as const,
  xl: { shadowColor:"#000", shadowOpacity:0.12, shadowRadius:16, shadowOffset:{width:0,height:6}, elevation:8 } as const,
} as const;

export const easing = { standard:"cubic-bezier(0.2,0,0,1)", outQuart:"cubic-bezier(0.25,1,0.5,1)", inOutCubic:"cubic-bezier(0.65,0,0.35,1)" } as const;
export const duration = { fast:120, normal:240, slow:380, float:560 } as const;

export const glass = {
  pane: { backgroundColor: PURE.white, borderColor: "#E5E5E5" },
  paneInk: { backgroundColor: PURE.xuan, borderColor: PURE.ink },
} as const;
export const glassWarm = PURE.white;
