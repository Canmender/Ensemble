/**
 * LiquidGlass — 液态玻璃容器（玄墨瓷雅 · 暖白透面 + 内侧高光 + 玄泉暗影 + 折射光斑）
 *
 * 安全优先：零原生滤镜（无 BlurView），用「半透明暖白面 + 高光描边 + 玄泉柔影 +
 * 左上折射光斑」多层叠压近似液态玻璃的立体通透，Android/iOS 稳定。
 *
 * intensity 兼容旧数字(0-100)与新命名 token（light/default/ink）。
 */
import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { radius, elevation, glass, glassWarm } from "../theme";

export interface LiquidGlassProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number | "light" | "default" | "ink";
  glow?: "tl" | "tr" | "none";
  halo?: string;
  contentStyle?: StyleProp<ViewStyle>;
  padding?: number;
  radiusValue?: number;
  refraction?: number;
}

/** 解析 intensity：兼容旧数字(0-100)传导透明度，新 token 走命名玻璃面 */
function resolveIntensity(intensity: number | string | undefined) {
  if (intensity === "ink") return glass.paneInk;
  if (intensity === "light") return { backgroundColor: "rgba(246,243,238,0.84)", borderColor: "rgba(255,255,255,0.78)" };
  if (typeof intensity === "number") {
    const a = Math.min(0.9, Math.max(0.15, intensity / 100));
    return { backgroundColor: `rgba(246,243,238,${a})`, borderColor: "rgba(255,255,255,0.7)" };
  }
  return glass.pane;
}

export function LiquidGlass(props: LiquidGlassProps) {
  const {
    children,
    style,
    intensity = "default",
    glow = "tl",
    halo,
    contentStyle,
    padding = 16,
    radiusValue = radius.xxl,
    refraction = 0.5,
  } = props;

  const paneStyle = resolveIntensity(intensity);
  const glowColor = halo ?? (intensity === "ink" ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.45)");

  return (
    <View style={[{ borderRadius: radiusValue }, style]}>
      {/* 玄泉投影层（3D 离地感） */}
      <View
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0, height: radiusValue,
          borderRadius: radiusValue, backgroundColor: "#2E323C", opacity: 0.16,
          transform: [{ translateY: 8 }, { scaleY: 0.92 }],
        }}
      />
      {/* 主玻璃面 */}
      <View style={[{ borderRadius: radiusValue, backgroundColor: paneStyle.backgroundColor, borderWidth: 1, borderColor: paneStyle.borderColor, overflow: "hidden" }]}>
        {glow !== "none" && (
          <View pointerEvents="none" style={{
            position: "absolute", top: 0, left: glow === "tl" ? 0 : undefined, right: glow === "tr" ? 0 : undefined,
            width: "62%", height: "46%", borderRadius: radiusValue, backgroundColor: glowColor, opacity: Math.min(1, Math.max(0.06, refraction)),
          }} />
        )}
        <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1.5, borderRadius: radiusValue, backgroundColor: "rgba(255,255,255,0.7)" }} />
        <View style={[{ flex: 1, padding }, contentStyle]}>{children}</View>
      </View>
    </View>
  );
}

/** 液态玻璃主题背景 —— 页面根容器氛围底 */
export function GlassBackdrop({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flex: 1, backgroundColor: "#FFFFFF" }, style]}>
      <View pointerEvents="none" style={{ position: "absolute", top: -120, left: -80, width: 260, height: 300, borderRadius: 150, backgroundColor: "rgba(143,125,111,0.10)", transform: [{ rotate: "-12deg" }] }} />
      {children}
    </View>
  );
}
