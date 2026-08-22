/**
 * GlassSurface — 玻璃表面平台抽象（调研 docs/技术调研/UI深化-RN玻璃-OKLCH-动画编排.md）
 *
 * 三分派：
 *   iOS 26+  → expo-glass-effect GlassView（原生液态玻璃）
 *   Android  → expo-blur BlurTargetView + BlurView（SDK55+ 新架构；不传 blurTarget 只是半透明无真模糊）
 *   其他/低端 → 半透明实心降级
 *
 * 已知坑（官方文档核实）：
 *   1. GlassView 不能用 opacity 做 fade 进出（opacity=0 时玻璃完全不渲染）；
 *      需要动画时改 glassEffectStyle={ style, animate, animationDuration }。
 *   2. BlurView 必须渲染在动态内容之后（先内容后 BlurView），否则模糊不更新。
 *   3. 多个 BlurView 共享一个 blurTarget 更高效（都在目标边界内时）。
 *
 * Android 结构说明：
 *   <View 容器>
 *     <BlurTargetView ref>…children（被模糊的真实内容）…</BlurTargetView>
 *     <BlurView blurTarget={ref} absoluteFill />   ← 盖在内容上方读像素做模糊
 *     {overlayChildren}                             ← 不参与模糊的前景内容
 *   </View>
 *
 * 用法：
 *   <GlassSurface intensity="bar" radius={radius.xxl} overlay={<输入栏控件/>} />
 *   或简单场景 children 直接进玻璃层：
 *   <GlassSurface radius={16}><Text>浮在玻璃上的文字</Text></GlassSurface>
 */
import React, { useRef } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { View as RNView } from "react-native";

// expo-glass-effect 仅 iOS 26+ 生效；其他平台 GlassView 自动退化为普通 View，静态导入安全
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { BlurView } from "expo-blur";
// BlurTargetView 是 Android-only 导出（.android.js），iOS 上没有对应文件——按平台 require 避免打包器解析失败
type BlurTargetProps = { style?: StyleProp<ViewStyle>; children?: React.ReactNode };
const AndroidBlurTarget: (React.ComponentType<BlurTargetProps & { ref?: React.MutableRefObject<RNView | null> }> | null) =
  Platform.OS === "android"
    ? // eslint-disable-next-line @typescript-eslint/no-var-requires
      (require("expo-blur/build/BlurTargetView").default as React.ComponentType<
        BlurTargetProps & { ref?: React.MutableRefObject<RNView | null> }
      >)
    : null;

const LIQUID_AVAILABLE = isLiquidGlassAvailable();

/** 强度预设：bar=导航/输入栏（轻模糊低遮蔽），panel=浮层/托盘（重模糊高遮蔽） */
export type GlassIntensity = "bar" | "panel";

export interface GlassSurfaceProps {
  /** 被模糊的内容（列表/消息流等）；Android 上它会被 BlurTargetView 包裹 */
  children?: React.ReactNode;
  /** 不参与模糊的前景层（工具栏按钮、文字等）——通常放这里保证清晰 */
  overlay?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** 圆角半径（数值） */
  radius: number;
  intensity?: GlassIntensity;
  /** tint 色（iOS 玻璃 tint / Android 半透明底色） */
  tint?: string;
  /** 强制走降级实心（如系统减弱透明时由调用方传入） */
  fallback?: boolean;
}

export function GlassSurface({
  children,
  overlay,
  style,
  radius,
  intensity = "bar",
  tint,
  fallback = false,
}: GlassSurfaceProps): React.ReactElement {
  const targetRef = useRef<RNView | null>(null);
  const blurAmount = intensity === "bar" ? 40 : 70;
  const androidTint = tint ?? (intensity === "bar" ? "rgba(252,250,246,0.55)" : "rgba(252,250,246,0.75)");
  const containerStyle: StyleProp<ViewStyle> = [{ borderRadius: radius, overflow: "hidden" }, style];

  if (fallback || Platform.OS !== "ios" && Platform.OS !== "android") {
    return (
      <View style={[containerStyle, { backgroundColor: androidTint }]}>
        {children}
        {overlay}
      </View>
    );
  }

  if (Platform.OS === "ios") {
    if (LIQUID_AVAILABLE) {
      return (
        <GlassView
          glassEffectStyle={intensity === "bar" ? "regular" : "clear"}
          tintColor={tint}
          style={containerStyle}
        >
          {children}
          {overlay}
        </GlassView>
      );
    }
    // iOS <26：补半透明底色保证可读性
    return (
      <View style={[containerStyle, { backgroundColor: androidTint }]}>
        {children}
        {overlay}
      </View>
    );
  }

  // Android：BlurTargetView 包住真实内容 → BlurView 悬浮其上按 ref 模糊 → 半透着色 → 前景
  return (
    <View style={containerStyle}>
      <BlurTargetViewSafe targetRef={targetRef} content={children} />
      <BlurView
        blurTarget={targetRef}
        intensity={blurAmount}
        tint="light"
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* 轻微提亮/压暗层让前景可读（真模糊之上） */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: androidTint }]} />
      {overlay}
    </View>
  );
}

/**
 * BlurTargetView 包装：ref 必须挂在一个持续存在的 View 上；
 * 内容为空时渲染占位（BlurTargetView 要求非空子树才能产出有效纹理）。
 */
function BlurTargetViewSafe({
  targetRef,
  content,
}: {
  targetRef: React.MutableRefObject<RNView | null>;
  content?: React.ReactNode;
}): React.ReactElement {
  const BlurTarget = AndroidBlurTarget!;
  return <BlurTarget ref={targetRef} style={StyleSheet.absoluteFill}>{content ?? null}</BlurTarget>;
}
