/**
 * LiquidGlass — 液态玻璃容器
 *
 * Android 上 BlurView + borderRadius 会出白色矩形（库的已知限制），
 * 改用纯 View 多层叠加：半透明玻璃面 + 内高光边 + 外阴影 + 微光斑。
 * 视觉上接近液态玻璃，且 Android/iOS 稳定一致。
 * 玻璃面颜色取自主题 palette（明暗自适应），可用 tint 显式覆盖。
 */
import React, { memo } from "react";
import { View, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { radius, getColors } from "../theme";

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
  // 渲染期读取当前 palette：换肤重挂载时随组件树一起刷新
  const c = getColors();
  const glassFace = tint ?? (c.glassHighlight === "#FFFFFF" ? "rgba(252,250,246,0.78)" : "rgba(30,41,59,0.78)");

  return (
    <View style={[{
      borderRadius: R,
      overflow: "hidden",
      // 半透明玻璃面
      backgroundColor: glassFace,
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
        borderColor: c.glassHighlight === "#FFFFFF" ? "rgba(255,255,255,0.55)" : "rgba(148,163,184,0.28)",
      }]} />
      {/* 左上微光斑 */}
      {glow !== "none" && (
        <View pointerEvents="none" style={{
          position: "absolute", top: 0, left: 0,
          width: "60%", height: "40%",
          borderTopLeftRadius: R,
          backgroundColor: c.glassHighlight === "#FFFFFF" ? "rgba(255,255,255,0.3)" : "rgba(148,163,184,0.14)",
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
  const c = getColors();
  return <View style={[{ flex: 1, backgroundColor: c.glassHighlight === "#FFFFFF" ? "#FFFFFF" : c.bg }, style]}>{children}</View>;
}
