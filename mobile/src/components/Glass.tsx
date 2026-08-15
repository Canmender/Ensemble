/**
 * Glass — 玻璃拟态（Glassmorphism）通用容器
 *
 * 在内容之上叠加毛玻璃：透明白 + 背景模糊(BlurView) + 顶部高光描边，
 * 用于悬浮 Tab、毛玻璃头部、玻璃弹层/卡片。
 * Android 低版本无真实模糊时自动回退为半透明白（不报错）。
 */
import React from "react";
import { View, StyleSheet, type StyleProp, type ViewStyle, Platform } from "react-native";
import { BlurView } from "expo-blur";
import { colors } from "../theme";

/** 玻璃样式：light=浅色清爽(默认)  dark=深色 */
export type GlassTone = "light" | "dark";

interface GlassProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** 模糊强度 1-100 */
  intensity?: number;
  /** 半透明白填充透明度（随 tone） */
  tone?: GlassTone;
  /** 是否显示顶部高光细线（玻璃质感关键） */
  highlight?: boolean;
}

export function Glass({ children, style, intensity = 45, tone = "light", highlight = true }: GlassProps) {
  const base =
    tone === "light"
      ? { backgroundColor: "rgba(255,255,255,0.72)" }
      : { backgroundColor: "rgba(20,23,31,0.72)" };
  return (
    <View style={[styles.wrap, base, style]}>
      {Platform.OS !== "web" ? (
        <BlurView intensity={intensity} tint="default" style={StyleSheet.absoluteFill} />
      ) : (
        <View style={StyleSheet.absoluteFill} />
      )}
      {highlight && <View style={[styles.highlight, tone === "dark" && styles.highlightDark]} />}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden", borderColor: "rgba(255,255,255,0.6)", borderWidth: 1 },
  highlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.85)",
  },
  highlightDark: { backgroundColor: "rgba(255,255,255,0.18)" },
});
