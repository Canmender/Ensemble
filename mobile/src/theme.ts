/**
 * 移动端设计系统 — 「玄墨瓷雅」(Xuan-Ink · Warm Mineral Ceramic)  v0.8.2
 *
 * 色组严格来自用户给定六色：
 *   淡黏土 #8F7D6F / 玄泉 #3B3F4A / 冷灰褐 #897F75 / 墨色 #3D3D3D / 纯白 #FFFFFF / 纯黑 #000000
 *
 * 角色分配（经 WCAG 对比度验证）：
 *   · 玄泉 #3B3F4A = 主品牌/主操作（白字 10.5:1）· 墨色 = 主文本(10.86) · 纯黑 = 大标题(21)
 *   · 纯白 = 页面底 · 淡黏土 = 暖表面/装饰(3.94，勿作小字正文) · 冷灰褐 = 次级文本(压深达标)
 */

const PURE = {
  clay: "#8F7D6F",
  xuan: "#3B3F4A",
  taupe: "#897F75",
  ink: "#3D3D3D",
  white: "#FFFFFF",
  black: "#000000",
} as const;

export const colors = {
  primary: PURE.xuan,            // 玄泉主操作 10.5:1
  primaryDeep: "#2E323C",        // 玄泉压深（按压态）
  primarySoft: "rgba(59,63,74,0.10)",
  primaryBubble: PURE.xuan,      // 自己聊天气泡
  gradient: [PURE.xuan, PURE.ink] as const,

  text: PURE.ink,
  textEmphasis: PURE.black,
  textMuted: "#6B6259",          // 冷灰褐压深 5.97:1
  textFaint: "#9A918A",
  textHelper: "#C3BCB4",

  bg: PURE.white,
  surface: "#FCFBF9",
  surfaceAlt: "#F2EFEA",
  border: "#E7E2DC",

  accent: PURE.xuan,             // 冷强调（开关/状态/导航）
  clay: PURE.clay,               // 暖细节（装饰/图标，勿作小字）
  accentSoft: "rgba(143,125,111,0.12)",
  surfaceTint: "rgba(143,125,111,0.08)",

  danger: "#B05038",
  warning: "#A9873C",
  success: "#5F7A5A",

  inputBg: "#F4F1EC",
  bubbleOther: "#F0ECE6",
  timeBadge: "rgba(61,61,61,0.06)",

  white: PURE.white,
  black: PURE.black,
  scrim: "rgba(20,16,12,0.55)",

  glassHighlight: "rgba(255,255,255,0.7)",
  glassShadow: "#2E323C",
} as const;

export const spacing = { xxs:2, xs:4, sm:8, md:12, lg:16, xl:20, xxl:24, xxxl:32, huge:40 } as const;
export const radius = { xs:6, sm:10, md:14, lg:18, xl:24, xxl:28, full:999 } as const;
export const fontSize = { xs:11, sm:13, md:15, lg:17, xl:20, xxl:26, xxxl:32 } as const;
export const lineHeight = { tight:1.2, normal:1.4, relaxed:1.6 } as const;

export const elevation = {
  none: { shadowColor:"#000", shadowOpacity:0, shadowRadius:0, shadowOffset:{width:0,height:0}, elevation:0 } as const,
  sm: { shadowColor:"#2E323C", shadowOpacity:0.06, shadowRadius:10, shadowOffset:{width:0,height:3}, elevation:2 } as const,
  md: { shadowColor:"#2E323C", shadowOpacity:0.10, shadowRadius:16, shadowOffset:{width:0,height:5}, elevation:4 } as const,
  lg: { shadowColor:"#2E323C", shadowOpacity:0.14, shadowRadius:26, shadowOffset:{width:0,height:9}, elevation:10 } as const,
  xl: { shadowColor:"#2E323C", shadowOpacity:0.18, shadowRadius:34, shadowOffset:{width:0,height:14}, elevation:16 } as const,
} as const;

export const easing = { standard:"cubic-bezier(0.2,0,0,1)", outQuart:"cubic-bezier(0.25,1,0.5,1)", inOutCubic:"cubic-bezier(0.65,0,0.35,1)" } as const;
export const duration = { fast:120, normal:240, slow:380, float:560 } as const;

export const glass = {
  pane: { backgroundColor:"rgba(246,243,238,0.72)", borderColor:"rgba(255,255,255,0.75)" },
  paneInk: { backgroundColor:"rgba(59,63,74,0.74)", borderColor:"rgba(255,255,255,0.18)" },
} as const;
export const glassWarm = "rgba(246,243,238,0.72)";
