// 由 desktop/scripts/build-tokens.mjs 从 design/tokens.json 自动生成 —— 手改无效
export interface EnsembleTheme {
  bg: string;
  surface: string;
  surface1: string;
  surface2: string;
  border: string;
  fg: string;
  muted: string;
  primary: string;
  primaryFg: string;
  accent: string;
  destructive: string;
  ring: string;
  success: string;
  warning: string;
}

export const LightTheme: EnsembleTheme = {
  bg: "#F4F6F9",
  surface: "#FFFFFF",
  surface1: "#FAFBFC",
  surface2: "#FFFFFF",
  border: "#E2E8F0",
  fg: "#171B23",
  muted: "#64748B",
  primary: "#3B3F4A",
  primaryFg: "#FFFFFF",
  accent: "#8C7AE6",
  destructive: "#DC2626",
  ring: "#3B3F4A",
  success: "#34D399",
  warning: "#F59E0B",
};

export const DarkTheme: EnsembleTheme = {
  bg: "#0F172A",
  surface: "#1E293B",
  surface1: "#1E293B",
  surface2: "#334155",
  border: "#334155",
  fg: "#FAFBFC",
  muted: "#94A3B8",
  primary: "#8B8F98",
  primaryFg: "#0F172A",
  accent: "#B4ACF8",
  destructive: "#F87171",
  ring: "#8B8F98",
  success: "#34D399",
  warning: "#FBBF24",
};

/** 弹簧动画参数（damping/stiffness），与 web 端 CSS 曲线近似对应 */
export const springs = {
  universal: { damping: 25, stiffness: 250 },
  snappy: { damping: 15, stiffness: 400 },
  gentleEntry: { damping: 30, stiffness: 200 },
} as const;
