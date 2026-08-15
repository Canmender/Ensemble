/**
 * Glass — 玻璃拟态容器（safe pass-through）
 *
 * 治理「登录后打不开」：此前 Android 端挂原生 BlurView 会在部分设备渲染抛错，
 * 被 ErrorBoundary 兜成整页「应用发生错误」。
 * 现改为纯 View 的安全通透容器（无 BlurView、无滤镜），保留 API 与观感底线，
 * 彻底杜绝渲染崩溃。后续可再按设备能力安全地恢复真实毛玻璃。
 */
import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

export interface LiquidGlassProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  glow?: "tl" | "tr";
  halo?: string;
  contentStyle?: StyleProp<ViewStyle>;
  refraction?: number;
}

/** 安全透明白容器：毛玻璃视觉用半透明白 + 细描边近似，不调用任何原生滤镜。 */
export function LiquidGlass(props: LiquidGlassProps) {
  const { children, style, glow = "tl", contentStyle } = props;
  // 高光方向仅在 style 上留一个透明淡白渐变感（纯 View，无滤镜）
  return (
    <View
      style={[
        {
          backgroundColor: "rgba(255,255,255,0.40)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.5)",
          overflow: "hidden",
        },
        style,
      ]}
    >
      <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
    </View>
  );
}
