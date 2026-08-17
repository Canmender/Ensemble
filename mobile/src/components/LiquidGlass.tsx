/**
 * LiquidGlass — 液态玻璃容器（expo-blur 真透穿）
 *
 * 核心：BlurView 真实背景模糊 → 仅叠极薄暖色 + 顶部高光条 + 底部阴影
 */
import React, { memo, useEffect, useState } from "react";
import { View, StyleSheet, Platform, AccessibilityInfo, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { radius, colors } from "../theme";

const IS_WEB = Platform.OS === "web";

export interface LiquidGlassProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  blur?: number;
  tint?: string;
  glow?: "tl" | "tr" | "none";
  contentStyle?: StyleProp<ViewStyle>;
  padding?: number;
  radiusValue?: number;
  transparent?: boolean;
}

function LiquidGlassInner({
  children, style, blur = 50, tint, glow = "tl",
  contentStyle, padding, radiusValue = radius.xxl, transparent = true,
}: LiquidGlassProps): React.ReactElement {
  const R = radiusValue;
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let m = true;
    AccessibilityInfo.isReduceTransparencyEnabled().then(v => { if (m) setReduce(v); });
    return () => { m = false; };
  }, []);

  const effBlur = Platform.OS === "ios" ? blur : Math.max(10, Math.round(blur * 0.7));
  const useBlur = transparent && !reduce && effBlur > 0 && !IS_WEB;

  return (
    <View
      style={[{
        borderRadius: R,
        overflow: "hidden",
        backgroundColor: "transparent",
      }, style, {
        shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 20,
        shadowOffset: { width: 0, height: 8 }, elevation: 12,
      }]}
    >
      {/* 玻璃底：真模糊（直接放在 borderRadius 父级内，无额外 overflow:hidden） */}
      {useBlur ? (
        <BlurView
          intensity={effBlur}
          tint="default"
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: tint || "rgba(250,248,244,0.88)" }]} />
      )}

      {/* 极薄暖色着色（6% 透明度） */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, {
        backgroundColor: "rgba(245,240,232,0.06)",
      }]} />

      {/* 顶部高光条 */}
      {glow !== "none" && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, {
          borderTopWidth: 1.5, borderTopColor: "rgba(255,255,255,0.35)",
        }]} />
      )}

      {/* 底部阴影条 */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, {
        borderBottomWidth: 1, borderBottomColor: "rgba(0,0,0,0.05)",
      }]} />

      {/* 发丝外边框 */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, {
        borderWidth: 0.5, borderColor: "rgba(255,255,255,0.18)",
      }]} />

      {/* 内容层 */}
      <View style={[{ flex: 1, padding }, contentStyle]} pointerEvents="box-none">
        {children}
      </View>
    </View>
  );
}

export const LiquidGlass = memo(LiquidGlassInner);

export function GlassBackdrop({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flex: 1, backgroundColor: "#FFFFFF" }, style]}>{children}</View>;
}
