/**
 * 移动端设计系统 — 「玄墨瓷雅」(Xuan-Ink · Warm Ceramic)  v0.8.4
 *
 * 颜色仅来自用户给定六色（唯一外源）：
 *   淡黏土 #8F7D6F / 玄泉 #3B3F4A / 冷灰褐 #897F75 / 墨色 #3D3D3D / 纯白 #FFFFFF / 纯黑 #000000
 *
 * 层次原则（去「脏灰糊」）：
 *   · 底 = 纯白（干净）· 正文 = 墨色 #3D3D3D · 大标题 = 纯黑 #000000
 *   · 主操作/品牌 = 玄泉 #3B3F4A（在白底上沉静有力）
 *   · 暖表面/卡片/高光 = 淡黏土 #8F7D6F 及其向白 blend
 *   · 次级文本 = 冷灰褐 #897F75 体系（压深保证对比）
 *   · 避免把整张页面推成米灰：白底打底，黏土只做局部暖层次 + 玄泉做主重点
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
  /* 品牌主 —— 玄泉 */
  primary: PURE.xuan,
  primaryDeep: "#2A2E36",
  primarySoft: "rgba(59,63,74,0.08)",
  primaryBubble: PURE.xuan,
  gradient: [PURE.xuan, PURE.ink] as const,

  /* 文字 —— 墨/黑 为主，冷灰褐做次级 */
  text: PURE.ink,
  textEmphasis: PURE.black,
  textMuted: "#6A6257",
  textFaint: "#99907F",
  textHelper: "#C5BCAE",

  /* 底 & 表面 —— 白底打底，黏土只做局部暖层次 */
  bg: PURE.white,
  surface: "#F8F5F0",
  surfaceAlt: "#EFEAE2",
  border: "#E5DFD5",

  /* 强调 */
  accent: PURE.xuan,
  clay: PURE.clay,
  accentSoft: "rgba(143,125,111,0.10)",
  surfaceTint: "rgba(143,125,111,0.06)",

  /* 状态 */
  danger: "#A94530",
  warning: "#A1842F",
  success: "#5E7450",

  inputBg: "#F3EFE8",
  bubbleOther: "#EFEAE2",
  timeBadge: "rgba(61,61,61,0.06)",

  white: PURE.white,
  black: PURE.black,
  scrim: "rgba(20,16,12,0.5)",

  glassHighlight: "rgba(255,255,255,0.7)",
  glassShadow: "#241E18",
} as const;

export const spacing = { xxs:2, xs:4, sm:8, md:12, lg:16, xl:20, xxl:24, xxxl:32, huge:40 } as const;
export const radius = { xs:6, sm:10, md:14, lg:18, xl:24, xxl:28, full:999 } as const;
export const fontSize = { xs:11, sm:13, md:15, lg:17, xl:20, xxl:26, xxxl:32 } as const;
export const lineHeight = { tight:1.2, normal:1.4, relaxed:1.6 } as const;

export const elevation = {
  none: { shadowColor:"#000", shadowOpacity:0, shadowRadius:0, shadowOffset:{width:0,height:0}, elevation:0 } as const,
  sm: { shadowColor:"#241E18", shadowOpacity:0.06, shadowRadius:10, shadowOffset:{width:0,height:3}, elevation:2 } as const,
  md: { shadowColor:"#241E18", shadowOpacity:0.10, shadowRadius:16, shadowOffset:{width:0,height:5}, elevation:4 } as const,
  lg: { shadowColor:"#241E18", shadowOpacity:0.14, shadowRadius:26, shadowOffset:{width:0,height:9}, elevation:10 } as const,
  xl: { shadowColor:"#241E18", shadowOpacity:0.18, shadowRadius:34, shadowOffset:{width:0,height:14}, elevation:16 } as const,
} as const;

export const easing = { standard:"cubic-bezier(0.2,0,0,1)", outQuart:"cubic-bezier(0.25,1,0.5,1)", inOutCubic:"cubic-bezier(0.65,0,0.35,1)" } as const;
export const duration = { fast:120, normal:240, slow:380, float:560 } as const;

export const glass = {
  pane: { backgroundColor:"rgba(248,245,240,0.72)", borderColor:"rgba(255,255,255,0.75)" },
  paneInk: { backgroundColor:"rgba(59,63,74,0.74)", borderColor:"rgba(255,255,255,0.18)" },
} as const;
export const glassWarm = "rgba(248,245,240,0.72)";
