/** 液态玻璃入口（兼容层）：把旧 intensity 属性映射到真 GPU 玻璃 */
import React from "react";
import { StyleProp, ViewStyle } from "react-native";
import { LiquidGlass as RealGlass } from "./LiquidGlass";
import { glass } from "../theme";

export interface LiquidGlassProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number | "light" | "default" | "ink";
  glow?: "tl" | "tr" | "none";
  halo?: string;
  contentStyle?: StyleProp<ViewStyle>;
  blur?: number;
  tint?: string;
  radiusValue?: number;
}

function mapIntensity(intensity?: number | string) {
  if (intensity === "ink") return { blur: 20, tint: "rgba(59,63,74,0.72)" };
  if (intensity === "light") return { blur: 10, tint: "rgba(252,251,249,0.82)" };
  if (typeof intensity === "number") {
    const a = Math.min(0.9, Math.max(0.3, intensity / 100));
    return { blur: 12, tint: "rgba(252,251,249," + a.toString() + ")" };
  }
  return { blur: 14, tint: "rgba(252,251,249,0.72)" };
}

export function LiquidGlass(props: LiquidGlassProps) {
  const { intensity, glow="tl", halo, style, children, contentStyle } = props;
  const m = mapIntensity(intensity);
  return (
    <RealGlass
      blur={props.blur ?? m.blur}
      tint={props.tint ?? m.tint}
      glow={glow}
      halo={halo}
      style={style}
      contentStyle={contentStyle}
      radiusValue={props.radiusValue}
    >
      {children}
    </RealGlass>
  );
}

export function GlassBackdrop({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <RealGlass blur={0} tint="rgba(255,255,255,0)" glow="none" style={style}>{children}</RealGlass>;
}
