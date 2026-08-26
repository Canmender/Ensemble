/**
 * GlassCard — 三层封装的毛玻璃卡片组件
 *
 * 优先级策略（按平台和 SDK 自动降级）：
 *   1. iOS 26+ → expo-glass-effect（Liquid Glass 原生）
 *   2. Android + SDK55+ → expo-blur 的 BlurTargetView + BlurView（真实高斯模糊）
 *   3. 其他 → LiquidGlass 纯 View 降级（视觉近似，无 GPU 模糊）
 *
 * variant 语义：
 *   "premium"  弹窗/浮层等重点场景（iOS Liquid Glass / Android 强模糊）
 *   "blur"     顶栏/底栏/导航（中等强度，跟随主题）
 *   "fallback" 消息卡片/通用（LiquidGlass 降级即可）
 */
import React, { useMemo } from "react";
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { LiquidGlass } from "./LiquidGlass";
import { getColors } from "../theme";

// Platform.OS + Platform.Version 判断
const IS_IOS = Platform.OS === "ios";
const IS_ANDROID = Platform.OS === "android";
const OS_VERSION = Platform.Version as number;

// 尝试动态引入（避免非 iOS 平台加载失败）
let GlassEffect: React.ComponentType<any> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  GlassEffect = require("expo-glass-effect").GlassView;
} catch {
  /* 非 iOS 或未安装时保持 null */
}

let BlurView: React.ComponentType<any> | null = null;
let BlurTargetView: React.ComponentType<any> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const blur = require("expo-blur");
  BlurView = blur.BlurView;
  BlurTargetView = blur.BlurTargetView;
} catch {
  /* 未安装时保持 null */
}

export type GlassVariant = "premium" | "blur" | "fallback";

interface GlassCardProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  variant?: GlassVariant;
  /** 强度（0-100），premium 默认 90，blur 默认 80，fallback 忽略 */
  intensity?: number;
  /** 自定义 tint 覆盖（跟随主题色） */
  tint?: string;
}

function getVariantConfig(variant: GlassVariant, isDark: boolean) {
  switch (variant) {
    case "premium":
      return {
        blur: 90,
        tint: isDark ? "rgba(30,30,30,0.72)" : "rgba(255,255,255,0.72)",
      };
    case "blur":
      return {
        blur: 80,
        tint: isDark ? "rgba(30,40,50,0.65)" : "rgba(255,255,255,0.65)",
      };
    case "fallback":
    default:
      return { blur: 14, tint: undefined };
  }
}

export function GlassCard({
  children,
  style,
  variant = "fallback",
  intensity,
  tint: tintOverride,
}: GlassCardProps) {
  const colors = getColors();
  const isDark = colors.bg !== "#FFFFFF";
  const config = useMemo(() => {
    const base = getVariantConfig(variant, isDark);
    return {
      blur: intensity ?? base.blur,
      tint: tintOverride ?? base.tint,
    };
  }, [variant, intensity, tintOverride, isDark]);

  // 优先级 1：iOS 26+ 使用 Liquid Glass 原生 API
  if (IS_IOS && OS_VERSION >= 26 && GlassEffect && variant !== "fallback") {
    return (
      <GlassEffect
        style={[styles.container, style]}
        glassEffectStyle={{
          blur: config.blur,
          tint: config.tint,
        }}
      >
        {children}
      </GlassEffect>
    );
  }

  // 优先级 2：Android + expo-blur 真实模糊
  if (IS_ANDROID && BlurView && BlurTargetView && variant !== "fallback") {
    return (
      <BlurTargetView style={[styles.container, style]}>
        <BlurView
          intensity={config.blur}
          tint={isDark ? "dark" : "light"}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.absoluteFill}>{children}</View>
      </BlurTargetView>
    );
  }

  // 优先级 3：LiquidGlass 降级
  return (
    <LiquidGlass
      blur={config.blur}
      tint={config.tint}
      style={style}
    >
      {children}
    </LiquidGlass>
  );
}

// 重导出 GlassBackdrop（保持向后兼容）
export { GlassBackdrop } from "./Glass";

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: "hidden",
  },
  absoluteFill: {
    ...StyleSheet.absoluteFillObject,
  },
});
