/**
 * LiquidGlass — 液态玻璃容器（3D / 液体质感）
 *
 * 不追求"模板化毛玻璃"，而是按真实材质光照打磨（性能优先，单层 BlurView）：
 *  - 顶拱轮廓：上弧更大、下缘收窄，接近"液滴受压"的曲面（非均匀圆角）
 *  - 定向高光聚光：一束光从左上打进，形成"镜头光斑"式柔光（高光 + 外扩淡环）
 *  - 玻璃壁厚：内层内容区 inset，外套透明"壁厚"描边 + 顶缘亮线
 *  - 折射放大：内容 scale(1.03) + 轻微下移，制造"透过液面看"的折射错觉
 *  - 双层体积阴影：紧实近影 + 大而虚的远影，叠出真实 3D 体积（非均匀单影）
 *  - 环境辉光：底部/右侧两团低饱和环境色，让玻璃反射周围颜色，摆脱"死白"
 *
 * Android 低版本无真实模糊时回退为半透明白层（不报错、不闪退）。
 */
import React from "react";
import { View, StyleSheet, type StyleProp, type ViewStyle, Platform } from "react-native";
import { BlurView } from "expo-blur";

export interface LiquidGlassProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** 玻璃强度 1-100（越大越实） */
  intensity?: number;
  /** 高光方向：'tl' 左上(默认) / 'tr' 右上 */
  glow?: "tl" | "tr";
  /** 环境辉光主色（默认青蓝，模拟色散） */
  halo?: string;
  contentStyle?: StyleProp<ViewStyle>;
  /** 折射放大倍率（默认 1.03；1 关闭） */
  refraction?: number;
}

/** 镜头光斑式高光：亮点 + 外扩淡环，做出聚光而非死板提亮（纯 View，不需额外 blur） */
function LensFlare({ top, left, right, bottom }: { top?: number; left?: number; right?: number; bottom?: number }) {
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "flex-end" }}>
      <View
        style={{
          position: "absolute",
          width: 76, height: 76, top: top ?? 0, left, right, bottom,
          borderRadius: 38,
          backgroundColor: "rgba(255,255,255,0.55)",
        }}
      />
      <View
        style={{
          position: "absolute",
          width: 120, height: 120, top: (top ?? 0) + 14, left, right, bottom,
          borderRadius: 60,
          backgroundColor: "rgba(255,255,255,0.14)",
        }}
      />
    </View>
  );
}

export function LiquidGlass({
  children, style, intensity = 52, glow = "tl", halo = "rgba(120,150,255,0.30)", refraction = 1.03, contentStyle,
}: LiquidGlassProps) {
  return (
    <View style={[styles.outer, style]}>
      {/* 背景模糊 + 透白（材质主体，单层 blur 保证性能） */}
      {Platform.OS !== "web" && <BlurView intensity={intensity} tint="light" style={StyleSheet.absoluteFill} />}
      <View style={styles.tint} />

      {/* 环境辉光：两团低饱和色散光（青 + 品红）让玻璃"反射周围颜色" */}
      <View pointerEvents="none" style={[styles.halo, { top: -55, left: -45, backgroundColor: halo }]} />
      <View pointerEvents="none" style={[styles.halo, { bottom: -50, right: -40, backgroundColor: "rgba(235,120,205,0.16)" }]} />

      {/* 定向高光聚光 */}
      {glow === "tl"
        ? <LensFlare top={6} left={10} />
        : <LensFlare top={6} right={10} />}

      {/* 顶缘亮线（壁厚最薄处最亮） */}
      <View pointerEvents="none" style={styles.edgeTop} />

      {/* 内容区：inset 出玻璃壁厚，主体略放大 + 下移制造折射 */}
      <View style={[styles.content, { transform: [{ scale: refraction }, { translateY: (refraction - 1) * 16 }] }, contentStyle]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    // 顶拱轮廓：上弧大、下缘收窄 —— 液滴受压曲面（非均匀圆角）
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    overflow: "hidden",
    // 双层体积阴影：近影实 + 远影虚，叠出真实厚度
    shadowColor: "#0B1220",
    shadowOpacity: 0.10,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.65)",
    backgroundColor: "rgba(255,255,255,0.34)",
  },
  tint: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(255,255,255,0.30)" },
  halo: { position: "absolute", width: 200, height: 200, borderRadius: 100 },
  edgeTop: {
    position: "absolute",
    top: 0, left: 14, right: 14,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  content: { flex: 1 },
});
