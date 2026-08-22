/**
 * 动效弹簧物理常量 —— 权威源 tokens.json 的 primitive.spring
 *
 * reanimated springify() 默认 damping=120 很"死"，必须显式传参。
 * 物理参数（damping/stiffness）与时长参数互斥——用弹簧时不要混 duration。
 *
 * useReducedMotion 兜底：系统开启「减弱动态效果」时布局转场退化为直接跳位，
 * 符合 WCAG 2.3.3 / 系统无障碍约定。调用方用 hooks 版本自动获得兜底。
 *
 * 注：build-tokens.mjs 目前只生成颜色；springs 从 JSON 直读（模块级一次性解析，
 * 成本可忽略）。桌面端把 springs 加进 RN 产物后切到 import。
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const springTokens = (require("../../../desktop/packages/shared/design/tokens.json") as {
  primitive: { spring: Record<string, { damping: number; stiffness: number }> };
}).primitive.spring;

/** 通用：列表项重排/布局变化 */
export const SPRING_GENERAL = springTokens.universal;
/** 灵敏：长按菜单/快捷操作/键盘避让（跟手优先） */
export const SPRING_SNAPPY = springTokens.snappy;
/** 温和入场：新消息气泡/卡片出现 */
export const SPRING_GENTLE = springTokens.gentleEntry;

import { useMemo } from "react";
import { LinearTransition, useReducedMotion } from "react-native-reanimated";

/** 布局转场（列表增删/重排）——通用档（无兜底版本，非组件上下文用） */
export const layoutSpring = () =>
  LinearTransition.springify().damping(SPRING_GENERAL.damping).stiffness(SPRING_GENERAL.stiffness);

/** 布局转场——温和入场档（新消息） */
export const layoutSpringGentle = () =>
  LinearTransition.springify().damping(SPRING_GENTLE.damping).stiffness(SPRING_GENTLE.stiffness);

/** 组件内使用：系统减弱动态时返回 undefined（跳过 layout 动画 = 直接落位） */
export function useLayoutSpring() {
  const reduced = useReducedMotion();
  return useMemo(() => (reduced ? undefined : layoutSpring()), [reduced]);
}

/** 组件内使用：温和档 + 减弱动态兜底 */
export function useLayoutSpringGentle() {
  const reduced = useReducedMotion();
  return useMemo(() => (reduced ? undefined : layoutSpringGentle()), [reduced]);
}
