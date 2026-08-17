/**
 * LiquidGlass — 液态玻璃容器
 *
 * Android 上 BlurView + borderRadius 会出白色矩形（库的已知限制），
 * 改用纯 View 多层叠加：半透明暖白 + 内高光边 + 外阴影 + 微光斑。
 * 视觉上接近液态玻璃，且 Android/iOS 稳定一致。
 */
import React, { memo } from "react";
import { View, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { radius } from "../theme";

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
  children, style, blur, tint, glow = "tl",
  contentStyle, padding, radiusValue = radius.xxl,
}: LiquidGlassProps): React.ReactElement {
  const R = radiusValue;

  return (
    <View style={[{
      borderRadius: R,
      overflow: "hidden",
      // 半透明暖白玻璃面
      backgroundColor: "rgba(252,250,246,0.78)",
      // 3D 阴影
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
      elevation: 12,
    }, style]}>
      {/* 内高光边（玻璃折射感） */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, {
        borderRadius: R,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.55)",
      }]} />
      {/* 左上微光斑 */}
      {glow !== "none" && (
        <View pointerEvents="none" style={{
          position: "absolute", top: 0, left: 0,
          width: "60%", height: "40%",
          borderTopLeftRadius: R,
          backgroundColor: "rgba(255,255,255,0.3)",
        }} />
      )}
      {/* 底部暗边（3D 离地感） */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, {
        borderRadius: R,
        borderBottomWidth: 1,
        borderBottomColor: "rgba(0,0,0,0.06)",
      }]} />
      {/* 内容 */}
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
