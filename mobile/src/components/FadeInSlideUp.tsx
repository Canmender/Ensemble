/**
 * 进场淡入 —— 替代原 reanimated LinearTransition 布局转场的视觉补偿
 *
 * 迁移说明（2026-10）：reanimated 因与 RN 0.86 原生构建不兼容被整体移除，
 * 其 LinearTransition（列表重排/新消息入场的位移跟随）无 RN 等价实现。
 * 本组件提供「有个东西进来了」的进场感知：opacity 0→1 + translateY 8px→0，
 * 参数取自 tokens 的 SPRING_GENTLE 档，保证与原有动效风格一致。
 *
 * 系统开启「减弱动态效果」时不播放，直接落位（WCAG 2.3.3）。
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import { useReducedMotion } from "../utils/motion";

export function FadeInSlideUp({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: any;
}) {
  const reduced = useReducedMotion();
  const anim = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) {
      anim.setValue(1);
      return;
    }
    anim.setValue(0);
    const animation = Animated.timing(anim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [anim, reduced]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [8, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}