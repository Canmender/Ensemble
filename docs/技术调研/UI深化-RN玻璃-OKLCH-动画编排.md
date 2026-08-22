# UI 深化调研：RN 玻璃组件选型 / OKLCH token 体系 / IM 动画编排

> 调研日期：2026-08-22（第二轮深化，接续 [UI设计新潮流调研.md](UI设计新潮流调研.md)）
> 本轮特点：以官方文档为准核实实现细节（Expo 官方、Evil Martians、Software Mansion），修正上一轮两处粗粒度判断

## 结论速览

1. **mobile 玻璃的正确答案是三平台三分**：iOS 26 用 `expo-glass-effect` 原生液态玻璃；Android 用 expo-blur 新的 BlurTargetView 架构或降级实心；上一轮"统一用 expo-blur"的建议已修正。
2. 配色 token 体系应建在 **OKLCH** 上：感知均匀亮度让"暗色降饱和、海拔分层"从手工调色变成公式生成。
3. reanimated 弹簧动画有官方布局转场 API（`springify()`），物理参数与时长参数两组互斥——聊天列表编排有了标准做法。

## 一、修正与深化：React Native 玻璃效果

### 上一轮建议的修正

上轮写"RN 用 expo-blur"，官方文档核实后真实图景更细：

| 平台 | 方案 | 关键事实 |
|---|---|---|
| iOS 26+ | **`expo-glass-effect` GlassView** | 封装原生 UIVisualEffectView 液态玻璃，支持 glassEffectStyle/tint；**不支持的平台自动退化为普通 View** |
| iOS <26 / Android | **expo-blur ≥SDK55** | Android 已 stable 但架构变了：需把被模糊内容包进 `<BlurTargetView ref>` 并传给 `<BlurView blurTarget={ref}>`；不传则 Android 只是半透明背景（无真模糊）|
| 低端设备兜底 | 实心表面 + 高透明度着色 | 与系统 Reduce Transparency 对齐 |

### 官方文档里的坑（直接决定代码怎么写）

1. **BlurView 必须渲染在动态内容之后**：先 FlatList 后 BlurView，否则模糊内容不更新——顶栏悬浮在消息流上方时这是必踩的坑。
2. **多个 BlurView 共享一个 BlurTargetView 更高效**（只要都在目标边界内）——底部输入栏+悬浮按钮应共享同一个 target。
3. **GlassView 不能用 opacity 做 fade 进出**：opacity=0 时玻璃完全不渲染；要用内置的 `glassEffectStyle.animate / animationDuration`。这是隐藏最深的坑。
4. legacy 写法（不带 blurTarget）在 Android 上静默降级为半透明背景，不报错——code review 时要盯。

### 合鸣 mobile 落地修订

- 输入栏/顶栏：iOS 26 GlassView，Android BlurTargetView+BlurView（`dimezisBlurView` 方法），双端包一层 `GlassSurface` 抽象组件做平台分派。
- 视频通话画中画浮窗是玻璃的最佳展示位（iOS 原生质感 + 内容固定）。
- 消息流内仍然禁玻璃的结论不变。

## 二、配色体系升级：OKLCH

### 为什么 token 该建在 OKLCH 上（Evil Martians 权威文章要点）

CSS Color 4 的 `oklch(L C H)` 三分量：L 是**感知亮度**（人眼看是一致的，HSL 的 L 不是）、C 彩度、H 色相。四个直接收益：

1. **公式化生成调色板**：定好品牌色的 L/C/H，surface-0..3 海拔层就是"L 逐级 +0.03"的算术，不再逐个手调。
2. **暗色模式降饱和变成公式**：暗色下 accent 降饱和 = C 值 ×0.85~0.9，而不是换一个肉眼猜的颜色。
3. **可访问性内建**：感知亮度一致意味着对比度可以按 L 差值预算（WCAG 对比度和 L 差强相关），设计时就保证双主题过线。
4. **宽色域 P3 就绪**：新设备能显示 sRGB 之外的色彩，OKLCH 可以直接指定 P3 色，浏览器自动向 sRGB 回落。
5. `oklch()` 已全主线浏览器可用（2025-09 起）；Tailwind v4 底层已迁移 OKLCH。

### 注意事项

- 不是所有 L/C/H 组合都落在 sRGB 内，超出色域浏览器找最近色——用 [OKLCH.com](https://oklch.com) 取色器校验关键色。
- Figma 尚无官方支持（有插件），设计师↔代码之间需要转换步骤。

### 合鸣配色落地修订

- web/desktop：token 直接写 oklch()；electric indigo 主 accent 定义为 `oklch(0.55 0.2 285)` 一带（对应 #2C2A72~#8C7AE6 区间），surface 层按海拔公式生成。
- mobile：RN 不支持 oklch() 字符串，shared 包导出 token 时同时给 hex（构建期转换），两端数值同源。

## 三、IM 场景动画编排（reanimated 官方 API 核实）

### 布局转场的弹簧化

reanimated 4.x 预定义转场（LinearTransition 等）通过 `.springify()` 切换弹簧驱动：

```tsx
// 消息气泡插入：位置与尺寸同时平滑过渡
<Animated.View layout={LinearTransition.springify().damping(30).stiffness(200)}>
  <MessageBubble />
</Animated.View>
```

- `.easing()` 修饰符在 `.springify()` 后无效（二选一）。
- 物理参数（mass/damping/stiffness）与时长参数（duration/dampingRatio）**互斥**，同用时后者覆盖前者。
- spring 默认 damping=120（很"死"），要显式传上轮表格的值。

### 聊天界面编排方案

| 动效 | 实现 | 参数 |
|---|---|---|
| 新消息气泡入场 | entering={FadeInDown.springify()} | 温和档 30/200 |
| 气泡长按菜单弹出 | withSpring 灵敏档 | 15/400，100–150ms |
| 图片消息加载后展开 | layout LinearTransition + borderRadius 过渡 | 温和档 |
| 键盘避让 | useAnimatedKeyboard + Animated.View layout | 灵敏档，跟手优先 |
| 会话→详情转场 | RN 不支持 View Transitions API；用 shared element transitions（4.x experimental→stable）或原生 stack | — |

- 所有动效挂 `useReducedMotion()`（reanimated 内置钩子），系统减弱动态时自动退化为淡入淡出。

## 四、给合鸣的行动清单（合并两轮）

1. **P0**：web/desktop 建 OKLCH surface token 体系（海拔语义 + 暗色公式化）；Electron 端玻璃四层配方应用到顶栏/输入栏/命令面板。
2. **P1**：mobile 引入 `expo-glass-effect` + 升级 expo-blur 到 SDK55+，封装 GlassSurface 平台抽象；聊天列表接入 LinearTransition.springify() 编排。
3. **P1**：会话列表→聊天详情的 View Transitions API（desktop/web）。
4. **红线不变**：prefers-reduced-motion / Reduce Transparency 全覆盖；玻璃只出现在固定层。

## 参考来源

- [expo-blur 官方文档](https://docs.expo.dev/versions/latest/sdk/blur-view/)（Android support / BlurTargetView / known issues 章节）
- [expo-glass-effect 官方文档](https://docs.expo.dev/versions/latest/sdk/glass-effect/)（GlassView 仅 iOS 26+，opacity 已知问题 #41024）
- [OKLCH in CSS: why we moved from RGB and HSL — Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)（PostCSS 作者 Andrey Sitnik 撰）
- [Layout transitions — react-native-reanimated 官方文档](https://docs.swmansion.com/react-native-reanimated/docs/layout-animations/layout-transitions)
