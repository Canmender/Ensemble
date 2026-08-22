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
  primary: "#0C8CEB",
  primaryFg: "#FFFFFF",
  accent: "#16A34A",
  destructive: "#DC2626",
  ring: "#0C8CEB",
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
  primary: "#38BDF8",
  primaryFg: "#0F172A",
  accent: "#22C55E",
  destructive: "#F87171",
  ring: "#38BDF8",
  success: "#34D399",
  warning: "#FBBF24",
};
