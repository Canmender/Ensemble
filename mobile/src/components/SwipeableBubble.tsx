/**
 * 可滑动消息气泡包裹层（左滑引用、右滑转发）
 *
 * 用 react-native-gesture-handler 的 Gesture.Pan() + Reanimated 实现：
 * - 左滑超 80px：松手触发 onReply
 * - 右滑超 80px：松手触发 onForward
 * - 回弹弹簧：withSpring(0, { damping: 20, stiffness: 300 })
 * - 多选模式下禁用滑动（避免冲突）
 */
import React, { useCallback } from "react";
import { View, StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
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
  const translateX = useSharedValue(0);

  const resetPosition = useCallback(() => {
    translateX.value = withSpring(0, { damping: 20, stiffness: 300 });
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
      translateX.value = Math.max(-120, Math.min(120, e.translationX));
    })
    .onEnd(() => {
      if (translateX.value < -SWIPE_THRESHOLD && onReply) {
        runOnJS(handleReply)();
      } else if (translateX.value > SWIPE_THRESHOLD && onForward) {
        runOnJS(handleForward)();
      } else {
        translateX.value = withSpring(0, { damping: 20, stiffness: 300 });
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const replyOpacity = useAnimatedStyle(() => ({
    opacity: translateX.value < -30 ? Math.min(1, Math.abs(translateX.value) / SWIPE_THRESHOLD) : 0,
  }));

  const forwardOpacity = useAnimatedStyle(() => ({
    opacity: translateX.value > 30 ? Math.min(1, translateX.value / SWIPE_THRESHOLD) : 0,
  }));

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
