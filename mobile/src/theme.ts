/**
 * 移动端设计系统 — 动态主题（S2）
 *
 * 颜色权威源：desktop/packages/shared/design/tokens.json（双端同源），
 * 构建产物 mobile/src/design/generated/tokens.ts（build-tokens.mjs 生成，手改无效）。
 *
 * 三态模式（system/light/dark）持久化于 AsyncStorage；system 跟随
 * Appearance.addChangeListener 实时切换。切换时 colors 对象被整体替换，
 * themeEpoch 递增 —— App 根组件以 key={themeEpoch} 重挂载，全部
 * StyleSheet.create 重新求值（静态 token 体系的换肤机制）。
 *
 * 旧导出保持兼容：colors/spacing/radius/fontSize/glass 等 34 个文件的
 * import 无需改动；新代码可用 useTheme() 拿响应式 colors。
 */
import { useSyncExternalStore } from "react";
import { Appearance, type ColorSchemeName } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  LightTheme,
  DarkTheme,
  type EnsembleTheme,
} from "./design/generated/tokens";

/** 语义 token（构建期 hex，与桌面端 CSS vars 同值） */
export const themeTokens: EnsembleTheme = LightTheme;
export { LightTheme, DarkTheme };
export type ThemeMode = "system" | "light" | "dark";

const MODE_KEY = "ensemble.themeMode";

// ==================== 主题内核（store + 订阅） ====================

type Listener = () => void;
const listeners = new Set<Listener>();
function emit() {
  listeners.forEach((l) => l());
}

function resolveScheme(mode: ThemeMode, system: ColorSchemeName): "light" | "dark" {
  if (mode === "system") return system === "dark" ? "dark" : "light";
  return mode;
}

let currentMode: ThemeMode = "system";
let currentSystem: Exclude<ColorSchemeName, null> =
  Appearance.getColorScheme() === "dark" ? "dark" : "light";

/** 当前生效的语义 token 集（colors 的数据源） */
export let activeTokens: EnsembleTheme = resolveScheme(currentMode, currentSystem) === "dark" ? DarkTheme : LightTheme;

/** 换肤纪元：每次实际切换 +1，根组件用它做 key 重挂载整树 */
export let themeEpoch = 0;

function subscribe(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function applyScheme() {
  const next = resolveScheme(currentMode, currentSystem);
  const nextTokens = next === "dark" ? DarkTheme : LightTheme;
  if (nextTokens !== activeTokens) {
    activeTokens = nextTokens;
    themeEpoch += 1;
    rebuildDerived();
    emit();
  }
}

/** 设置用户偏好并持久化 */
export function setThemeMode(mode: ThemeMode) {
  if (mode === currentMode) return;
  currentMode = mode;
  void AsyncStorage.setItem(MODE_KEY, mode);
  applyScheme();
}

/** 读取用户偏好（启动时由 initTheme 填充） */
export function getThemeMode(): ThemeMode {
  return currentMode;
}

/** 启动时恢复持久化的偏好；注册系统外观监听 */
export function initTheme(): void {
  void AsyncStorage.getItem(MODE_KEY).then((v) => {
    if (v === "light" || v === "dark" || v === "system") {
      if (v !== currentMode) {
        currentMode = v;
        applyScheme();
      }
    }
  });
  Appearance.addChangeListener(({ colorScheme }) => {
    currentSystem = colorScheme === "dark" ? "dark" : "light";
    applyScheme();
  });
}

// ==================== 派生调色板 ====================

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

export interface Palette {
  // 语义键 → token（与桌面端同值；旧视觉键映射到最近的语义 token）
  primary: string;
  primaryDeep: string;
  primarySoft: string;
  primaryBubble: string;
  /** 主色上的文字色（按钮/徽章内文字） */
  primaryFg: string;
  gradient: readonly [string, string];

  text: string;
  textEmphasis: string;
  textMuted: string;
  textFaint: string;
  textHelper: string;

  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;

  accent: string;
  clay: string;
  accentSoft: string;
  surfaceTint: string;

  danger: string;
  warning: string;
  success: string;

  inputBg: string;
  bubbleOther: string;
  timeBadge: string;

  white: string;
  black: string;
  scrim: string;

  glassHighlight: string;
  glassShadow: string;

  // Tab bar
  tabBg: string;
  tabActive: string;
  tabInactive: string;
  tabBorder: string;
}

let palette: Palette = buildPalette();

function buildPalette(): Palette {
  return {
    primary: activeTokens.primary,
    primaryDeep: activeTokens.fg,
    primarySoft: activeTokens.surface1,
    primaryBubble: activeTokens.primary,
    primaryFg: activeTokens.primaryFg,
    gradient: [activeTokens.primary, activeTokens.fg] as const,

    text: activeTokens.fg,
    textEmphasis: activeTokens.fg,
    textMuted: activeTokens.muted,
    textFaint: activeTokens.muted,
    textHelper: activeTokens.muted,

    bg: activeTokens.bg,
    surface: activeTokens.surface,
    surfaceAlt: activeTokens.surface1,
    border: activeTokens.border,

    accent: activeTokens.accent,
    clay: activeTokens.accent,
    accentSoft: activeTokens.surface1,
    surfaceTint: activeTokens.surface1,

    danger: activeTokens.destructive,
    warning: activeTokens.warning,
    success: activeTokens.success,

    inputBg: activeTokens.surface,
    bubbleOther: activeTokens.surface1,
    timeBadge: activeTokens.muted,

    white: PURE.white,
    black: PURE.black,
    scrim: "rgba(0,0,0,0.5)",

    glassHighlight: activeTokens.surface,
    glassShadow: PURE.black,

    tabBg: activeTokens.surface,
    tabActive: activeTokens.primary,
    tabInactive: activeTokens.muted,
    tabBorder: activeTokens.border,
  };
}

/** 切换后整体替换派生对象（StyleSheet 于重挂载时重新读取） */
function rebuildDerived() {
  palette = buildPalette();
}

/**
 * 兼容层：与旧静态导出同名。注意 StyleSheet.create 在模块加载期捕获的是
 * 当时对象的属性值——因此这里以 getter 代理到当前 palette；对 StyleSheet
 * 而言 getter 在 create() 时即解引用为当时的值，配合 themeEpoch 重挂载
 * 即可全量刷新。
 */
export const colors: Palette = new Proxy({} as Palette, {
  get(_t, prop: string) {
    return palette[prop as keyof Palette];
  },
  ownKeys() {
    return Reflect.ownKeys(palette);
  },
});

// ==================== 响应式 API（新代码优先） ====================

/** 当前 palette 快照（非响应式） */
export function getColors(): Palette {
  return palette;
}

/** 当前换肤纪元快照 */
export function getThemeEpoch(): number {
  return themeEpoch;
}

/** 响应式订阅当前 palette；主题切换时组件自动重渲染 */
export function useTheme(): { colors: Palette; mode: ThemeMode; scheme: "light" | "dark"; epoch: number } {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function getSnapshot() {
  return { colors: palette, mode: currentMode, scheme: resolveScheme(currentMode, currentSystem), epoch: themeEpoch };
}

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
