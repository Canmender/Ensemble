/**
 * 动效弹簧物理常量 —— 权威源 tokens.json 的 primitive.spring（经 build-tokens.mjs 生成）
 *
 * 弹簧物理参数（damping/stiffness）与时长参数互斥——用弹簧时不要混 duration。
 *
 * 无障碍兜底：系统开启「减弱动态效果」时动效退化，符合 WCAG 2.3.3 /
 * 系统无障碍约定。
 *
 * 迁移说明（2026-10）：原实现用 reanimated 的 useReducedMotion + LinearTransition。
 * 因 reanimated 与 RN 0.86 原生构建不兼容（3.19.5 的 CMakeLists 硬编码 4.x 的
 * src/main/cpp 布局，而其 C++ 源码实际在 Common/cpp/，导致原生构建失败、APK
 * 出不来），已整体迁往 RN 原生 Animated。
 * - useReducedMotion → AccessibilityInfo.isReduceMotionEnabled +
 *   reduceMotionChanged 事件，可访问性行为等价保留。
 * - LinearTransition 无 RN 等价实现：LayoutAnimation 只能用预设曲线、无法自定义
 *   damping/stiffness，与下列 SPRING_* 参数对不上，属语义不等价的近似，故移除。
 *   受影响的仅是列表重排/新消息入场的位移跟随（视觉打磨），不影响功能与数据。
 */
import { springs } from "../design/generated/tokens";

/** 通用：列表项重排/布局变化 */
export const SPRING_GENERAL = springs.universal;
/** 灵敏：长按菜单/快捷操作/键盘避让（跟手优先） */
export const SPRING_SNAPPY = springs.snappy;
/** 温和入场：新消息气泡/卡片出现 */
export const SPRING_GENTLE = springs.gentleEntry;

import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** 跟踪系统「减弱动态效果」设置，替代 reanimated 的 useReducedMotion */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return reduced;
}