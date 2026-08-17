/**
 * 移动端设计系统 — 暖奢矿物（Anti-AI-Slop）
 *
 * 六色 + 暖琥珀点缀，文字对比度 >= 4.5:1：
 *   淡黏土 #8F7D6F / 玄泉 #3B3F4A / 冷灰褐 #897F75 / 墨色 #3D3D3D / 纯白 #FFFFFF / 纯黑 #000000
 *   + 暖琥珀 #C4933F（CTA/强调）
 *
 * 文字层级（全 >= 4.5:1 on 白底）：
 *   纯黑 #000000 = 大标题（21:1）
 *   墨色 #3D3D3D = 主文本（10.9:1）
 *   玄泉 #3B3F4A = 次级文本（10.5:1）
 *   冷灰褐 #897F75 = 仅用于大号 UI / 图标（3.9:1，不做小字）
 *   淡黏土 #8F7D6F = 仅用于表面/装饰（3.9:1，不做小字）
 */

const PURE = {
  clay: "#8F7D6F",
  xuan: "#3B3F4A",
  taupe: "#897F75",
  ink: "#3D3D3D",
  white: "#FFFFFF",
  black: "#000000",
  amber: "#C4933F",
} as const;

export const colors = {
  primary: PURE.xuan,
  primaryDeep: PURE.black,
  primarySoft: PURE.taupe,
  primaryBubble: PURE.xuan,
  gradient: [PURE.xuan, PURE.ink] as const,

  text: PURE.ink,
  textEmphasis: PURE.black,
  textMuted: PURE.xuan,
  textFaint: PURE.ink,
  textHelper: PURE.xuan,

  bg: PURE.white,
  surface: PURE.clay,
  surfaceAlt: PURE.taupe,
  border: PURE.taupe,

  accent: PURE.amber,
  clay: PURE.clay,
  accentSoft: PURE.clay,
  surfaceTint: PURE.clay,

  danger: "#A94530",
  warning: PURE.amber,
  success: "#5A7A4E",

  inputBg: PURE.clay,
  bubbleOther: PURE.clay,
  timeBadge: PURE.taupe,

  white: PURE.white,
  black: PURE.black,
  scrim: PURE.black,

  glassHighlight: PURE.white,
  glassShadow: PURE.black,
} as const;

export const spacing = { xxs:2, xs:4, sm:8, md:12, lg:16, xl:20, xxl:24, xxxl:32, huge:40 } as const;
export const radius = { xs:6, sm:10, md:14, lg:18, xl:24, xxl:28, full:999 } as const;
export const fontSize = { xs:11, sm:13, md:15, lg:17, xl:20, xxl:26, xxxl:32 } as const;
export const lineHeight = { tight:1.2, normal:1.4, relaxed:1.6 } as const;

export const elevation = {
  none: { shadowColor:"#000", shadowOpacity:0, shadowRadius:0, shadowOffset:{width:0,height:0}, elevation:0 } as const,
  sm: { shadowColor:"#000", shadowOpacity:0.08, shadowRadius:10, shadowOffset:{width:0,height:3}, elevation:2 } as const,
  md: { shadowColor:"#000", shadowOpacity:0.12, shadowRadius:16, shadowOffset:{width:0,height:5}, elevation:4 } as const,
  lg: { shadowColor:"#000", shadowOpacity:0.16, shadowRadius:26, shadowOffset:{width:0,height:9}, elevation:10 } as const,
  xl: { shadowColor:"#000", shadowOpacity:0.20, shadowRadius:34, shadowOffset:{width:0,height:14}, elevation:16 } as const,
} as const;

export const easing = { standard:"cubic-bezier(0.2,0,0,1)", outQuart:"cubic-bezier(0.25,1,0.5,1)", inOutCubic:"cubic-bezier(0.65,0,0.35,1)" } as const;
export const duration = { fast:120, normal:240, slow:380, float:560 } as const;

export const glass = {
  pane: { backgroundColor: PURE.white, borderColor: PURE.taupe },
  paneInk: { backgroundColor: PURE.xuan, borderColor: PURE.taupe },
} as const;
export const glassWarm = PURE.clay;
