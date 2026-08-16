/**
 * LiquidGlass — 液态玻璃容器（expo-blur 原生透穿 + 液态高光层）
 *
 * 真透穿：底层 expo-blur BlurView（iOS=UIVisualEffectView / Android=RenderEffect，
 *         原生实时采样玻璃「后方」内容做真实背景模糊）。
 * 液态：上叠光折射渐变 + 发丝高光边 + 玄泉柔影。
 * 胶囊：radiusValue 传 高度/2 即得「横向长方形 + 两边半圆」。
 */
import React, { memo, useEffect, useState } from "react";
import { View, StyleSheet, Platform, AccessibilityInfo, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { radius, colors } from "../theme";

export interface LiquidGlassProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  blur?: number;
  tint?: string;
  glow?: "tl" | "tr" | "none";
  halo?: string;
  contentStyle?: StyleProp<ViewStyle>;
  padding?: number;
  radiusValue?: number;
  transparent?: boolean;
}

function LiquidGlassInner({
  children, style, blur = 40, tint = "rgba(252,251,249,0.55)", glow = "tl",
  halo = "rgba(255,255,255,0.6)", contentStyle, padding, radiusValue = radius.xxl, transparent = true,
}: LiquidGlassProps): React.ReactElement {
  const R = radiusValue;
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let m = true;
    AccessibilityInfo.isReduceTransparencyEnabled().then(v => { if (m) setReduce(v); });
    return () => { m = false; };
  }, []);

  const effBlur = Platform.OS === "ios" ? blur : Math.max(4, Math.round(blur / 2));
  const useBlur = transparent && !reduce && effBlur > 0;

  return (
    <View style={[{ borderRadius: R }, style, {
      shadowColor: colors.glassShadow,
      shadowOpacity: 0.16, shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 }, elevation: 10,
    }]}>
      {/* 玻璃底：真模糊 或 纯色降级 */}
      {useBlur ? (
        <BlurView
          intensity={effBlur}
          tint="light"
          experimentalBlurMethod="dimezisBlurView"
          style={[StyleSheet.absoluteFill, { borderRadius: R, overflow: "hidden" }]}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: tint, borderRadius: R }]} />
      )}

      {/* 玻璃面着色 + 光折射渐变（左上光源） */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: R, backgroundColor: tint }]}>
        {/* 光源：左上暖白高光 → 右下收敛，制造「光照玻璃」的折射感 */}
        {glow !== "none" && (
          <View
            style={{
              position: "absolute",
              top: 0, left: 0, right: 0, height: "70%",
              borderTopLeftRadius: R, borderTopRightRadius: R,
              backgroundColor: halo,
              opacity: 0.5,
            }}
          />
        )}
      </View>

      {/* 发丝高光边（玻璃边缘的亮边） */}
      {useBlur && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, {
          borderRadius: R, borderWidth: 1, borderColor: "rgba(255,255,255,0.55)",
        }]} />
      )}

      {/* 内容层 */}
      <View style={[{ flex: 1, padding }, contentStyle]} pointerEvents="box-none">
        {children}
      </View>
    </View>
  );
}

export const LiquidGlass = memo(LiquidGlassInner);

/** 液态玻璃主题背景（页面根氛围底） */
export function GlassBackdrop({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flex: 1, backgroundColor: "#FFFFFF" }, style]}>{children}</View>;
}
