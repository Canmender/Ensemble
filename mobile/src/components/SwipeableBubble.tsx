/**
 * 可滑动消息气泡包裹层（左滑引用、右滑转发）
 *
 * 用 react-native-gesture-handler 的 Gesture.Pan() + RN 原生 Animated 实现：
 * - 左滑超 80px：松手触发 onReply
 * - 右滑超 80px：松手触发 onForward
 * - 回弹弹簧：damping 20 / stiffness 300
 * - 多选模式下禁用滑动（避免冲突）
 *
 * 迁移说明（2026-10）：原为 reanimated（与 RN 0.86 原生构建不兼容）。
 * 三个 opacity 原本是 `useAnimatedStyle` 里的连续派生计算
 * （min(1, |translateX| / 阈值)），此处用 interpolate + extrapolate: "clamp"
 * 等价复现——30px 起淡入、80px 达满值、超出则钳住，与原逻辑一致。
 * 手势回调本就在 JS 线程（gesture-handler 的 onUpdate/onEnd 非 worklet），
 * 故直接 setValue，无需 runOnJS。
 */
import React, { useCallback, useRef } from "react";
import { View, StyleSheet, Animated } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius } from "../theme";

const SWIPE_THRESHOLD = 80;
const ICON_SIZE = 22;

interface SwipeableBubbleProps {
  children: React.ReactNode;
  disabled?: boolean;
  onReply?: () => void;
  onForward?: () => void;
}

export function SwipeableBubble({
  children,
  disabled = false,
  onReply,
  onForward,
}: SwipeableBubbleProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  // 当前位移的 JS 侧镜像：onEnd 需要读数值判断是否越过阈值。
  // 不用 __getValue/_value——前者未在类型定义中公开，后者是私有字段。
  const offsetRef = useRef(0);

  const resetPosition = useCallback(() => {
    offsetRef.current = 0;
    Animated.spring(translateX, {
      toValue: 0,
      damping: 20,
      stiffness: 300,
      mass: 1,
      useNativeDriver: true,
    }).start();
  }, [translateX]);

  const handleReply = useCallback(() => {
    onReply?.();
    resetPosition();
  }, [onReply, resetPosition]);

  const handleForward = useCallback(() => {
    onForward?.();
    resetPosition();
  }, [onForward, resetPosition]);

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .activeOffsetX([-15, 15]) // 垂直滚动不误触
    .onUpdate((e) => {
      // 限制滑动范围 [-120, 120]
      const next = Math.max(-120, Math.min(120, e.translationX));
      offsetRef.current = next;
      translateX.setValue(next);
    })
    .onEnd(() => {
      const x = offsetRef.current;
      if (x < -SWIPE_THRESHOLD && onReply) {
        handleReply();
      } else if (x > SWIPE_THRESHOLD && onForward) {
        handleForward();
      } else {
        resetPosition();
      }
    });

  const animatedStyle = {
    transform: [{ translateX }],
  };

  // 30px 起淡入、80px 达满值、超出钳住——等价于原 min(1, |x| / 阈值)
  const replyOpacity = translateX.interpolate({
    inputRange: [-120, -SWIPE_THRESHOLD, -30, 0],
    outputRange: [1, 1, 0, 0],
    extrapolate: "clamp",
  });

  const forwardOpacity = translateX.interpolate({
    inputRange: [0, 30, SWIPE_THRESHOLD, 120],
    outputRange: [0, 0, 1, 1],
    extrapolate: "clamp",
  });

  return (
    <View style={styles.container}>
      {/* 左滑露出的回复按钮 */}
      <Animated.View style={[styles.actionBtn, styles.replyBtn, replyOpacity]}>
        <Ionicons name="chatbubble-outline" size={ICON_SIZE} color="#fff" />
      </Animated.View>

      {/* 右滑露出的转发按钮 */}
      <Animated.View style={[styles.actionBtn, styles.forwardBtn, forwardOpacity]}>
        <Ionicons name="arrow-redo-outline" size={ICON_SIZE} color="#fff" />
      </Animated.View>

      {/* 消息气泡（带滑动动画） */}
      <GestureDetector gesture={pan}>
        <Animated.View style={animatedStyle}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    marginVertical: 2,
  },
  actionBtn: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 48,
    borderRadius: radius.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  replyBtn: {
    left: 8,
    backgroundColor: colors.primary,
  },
  forwardBtn: {
    right: 8,
    backgroundColor: colors.success,
  },
});
