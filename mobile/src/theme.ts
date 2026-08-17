/**
 * 移动端设计系统 — Swiss Modernism + 暖奢矿物
 *
 * 原则（技能调研 Swiss Modernism 2.0 / Luxury Refined）：
 *   - 大面积白底 + 大量留白呼吸
 *   - 文字纯黑/墨色（高对比，清晰）
 *   - 玄泉只用在关键品牌元素（标题、主按钮）
 *   - 暖琥珀只用在 CTA（唯一的活跃色点缀）
 *   - 黏土/冷灰褐几乎不用（只在需要区分层级时极少量）
 *
 * 用户六色：淡黏土 #8F7D6F / 玄泉 #3B3F4A / 冷灰褐 #897F75 / 墨色 #3D3D3D / 纯白 #FFFFFF / 纯黑 #000000
 * + 暖琥珀 #C4933F（CTA 唯一点缀）
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
  primarySoft: PURE.white,
  primaryBubble: PURE.xuan,
  gradient: [PURE.xuan, PURE.ink] as const,

  text: PURE.black,
  textEmphasis: PURE.black,
  textMuted: PURE.ink,
  textFaint: PURE.xuan,
  textHelper: PURE.taupe,

  bg: PURE.white,
  surface: PURE.white,
  surfaceAlt: PURE.white,
  border: PURE.xuan,

  accent: PURE.amber,
  clay: PURE.clay,
  accentSoft: PURE.white,
  surfaceTint: PURE.white,

  danger: "#C0392B",
  warning: PURE.amber,
  success: "#27AE60",

  inputBg: PURE.white,
  bubbleOther: PURE.white,
  timeBadge: PURE.ink,

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
  sm: { shadowColor:"#000", shadowOpacity:0.06, shadowRadius:8, shadowOffset:{width:0,height:2}, elevation:1 } as const,
  md: { shadowColor:"#000", shadowOpacity:0.10, shadowRadius:16, shadowOffset:{width:0,height:4}, elevation:3 } as const,
  lg: { shadowColor:"#000", shadowOpacity:0.15, shadowRadius:24, shadowOffset:{width:0,height:8}, elevation:8 } as const,
  xl: { shadowColor:"#000", shadowOpacity:0.20, shadowRadius:32, shadowOffset:{width:0,height:12}, elevation:12 } as const,
} as const;

export const easing = { standard:"cubic-bezier(0.2,0,0,1)", outQuart:"cubic-bezier(0.25,1,0.5,1)", inOutCubic:"cubic-bezier(0.65,0,0.35,1)" } as const;
export const duration = { fast:120, normal:240, slow:380, float:560 } as const;

export const glass = {
  pane: { backgroundColor: PURE.white, borderColor: PURE.ink },
  paneInk: { backgroundColor: PURE.xuan, borderColor: PURE.ink },
} as const;
export const glassWarm = PURE.white;
