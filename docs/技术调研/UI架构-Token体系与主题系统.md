# UI 架构深化：设计 Token 体系与合鸣主题系统方案

> 调研日期：2026-08-22（第三轮，接续《UI设计新潮流调研》《UI深化-RN玻璃-OKLCH-动画编排》）
> 本轮依据：W3C Design Tokens Format 2025.10 规范草案（2026-07-30 发布）原文、前两轮已核实的官方文档
> 说明：本轮 WebSearch 服务多次空结果，IM 组件趋势部分基于前两轮积累综合，来源局限已在文中标注

## 结论速览

1. Token 组织的行业标准是 **W3C Design Tokens Format**（$value/$type/花括号别名引用），2025.10 版已是稳定可用的草案。
2. 三层 token 架构（primitive → semantic → component）是跨端主题系统的通用解——正好匹配合鸣「shared 包 + web/desktop/mobile 三消费端」的 workspace 结构。
3. 前两轮的所有结论（OKLCH 公式、海拔分层、indigo accent）都能装进这套架构；本方案给出具体目录结构与迁移步骤。

## 一、W3C Design Tokens Format 2025.10 核心机制

从规范原文提取的四个关键点：

1. **`$value` 是 token 的判定标志**：JSON 对象含 `$value` 即 token，不含即 group；两者混在一个对象上是规范强制错误。Group 可通过 `$type` 让子 token 继承类型，工具禁止靠猜值内容判断类型。
2. **花括号别名引用**：`{color.accent}` 形式引用其他 token，支持链式解析与循环检测（规范定义了完整的 resolution 算法与错误条件）。语义层的每个值都应该是到 primitive 层的引用。
3. **`$root` 根 token**：group 可带一个根 token 作为基础值，同组内其他 token 作为变体扩展——天然表达「accent 默认色 + hover/pressed 变体」。
4. **`$deprecated` 元属性**：弃用 token 可携带替代指引字符串，工具链据此生成迁移提示。

生态现状：Style Dictionary 等转换工具已支持该格式；Figma 官方支持仍在路上（有第三方插件）。

## 二、三层架构与合鸣的映射

```
shared/design/tokens/
├── primitive.json      # 第 1 层：原始值（OKLCH 色板、字号阶、间距阶、圆角阶、时长/弹簧参数）
│     color.indigo.500 = oklch(0.55 0.2 285)
│     surface.l0..l3   = 海拔亮度阶梯
│     spring.snappy    = {damping:15, stiffness:400}
├── semantic.json       # 第 2 层：语义引用（全部是 {primitive.*} 别名）
│     bg.surface-0 = {surface.l0}
│     text.primary = {neutral.900}   ← 暗色主题换引用不换值
│     motion.enter = {spring.gentle}
├── component.json      # 第 3 层：组件令牌（可选起步）
│     chat.bubble.bg-self / chat.bubble.bg-other
└── themes/
    ├── light.json      # 只重定向 semantic 层引用
    └── dark.json       # 暗色 = 引用重排 + C×0.85 的 OKLCH 公式结果
```

**为什么这个结构恰好适合合鸣：**

1. **双端同源问题被规范化解决**。上一轮遗留的问题"RN 不认 oklch() 字符串"在 token 架构下的答案是：primitive 层存 OKLCH 规范值，构建期用 Style Dictionary 输出三份产物——web 的 CSS custom properties、RN 的 TS 常量（hex）、以及弹簧参数常量。数值永远单源。
2. **主题切换 = semantic 层引用重排**。light/dark 两套 theme 文件只改第 2 层指向，primitive 与组件层完全不动——这正是 W3C 格式别名机制的教科书用法。
3. **潮流轮换成本最小化**。上一轮配色调研的结论"主色抗潮流、accent 走潮流"落地为：换潮流只动 primitive 的 accent 组 + 重跑构建，semantic 及以上零改动。

## 三、迁移步骤（增量式，每步独立可用）

| 步骤 | 内容 | 产出 |
|---|---|---|
| T1 | shared 包建 `design/tokens/primitive.json`（把现有散落的颜色硬编码盘点进 OKLCH 阶梯） | 单一 JSON 文件 |
| T2 | 接 Style Dictionary（或手写 30 行转换脚本起步），输出 web CSS vars + RN 常量 | 双端产物 |
| T3 | web 端替换 Tailwind 配置中的颜色为 CSS var 引用 | 主题切换能力 |
| T4 | mobile 端替换 StyleSheet 硬编码为 tokens 常量 import | 双端一致 |
| T5 | semantic.json + light/dark 双主题 + 弹簧参数进 token | 全套体系 |

T1-T2 半天即可完成并立即产生价值（消除双端颜色漂移）；T3-T5 按迭代节奏走。

## 四、IM 界面组件趋势（综合前两轮，来源局限标注）

> 本节因搜索服务不稳定未能获取新的专门文章，以下是从前两轮材料推导的综合判断，可信度中等，待后续补充检索。

结合 Apple Liquid Glass 的官方使用哲学（玻璃用于系统层、内容区实心）与 bento/海拔趋势，IM 类界面在 2026 的演化方向：

1. **导航/输入栏持续"浮起来"**：顶栏和输入栏从贴边条变成悬浮玻璃胶囊（Liquid Glass 官方示范正是 bars/sheets/popovers）；消息流保持全宽实心滚动区。
2. **气泡材质分层**：自己 vs 对方用海拔差而非仅颜色差区分（elevation + tint 微差），配合弹簧入场动画形成"消息是有重量的物体"的心智。
3. **输入栏成为复合枢纽**：附件/语音/AI 快捷操作收进输入栏上方的可展开玻璃托盘，主输入框保持极简——这与合鸣已有的微信卡片/附件能力契合。
4. **状态反馈微交互化**：发送中→已发→已读的回执演进直接做进气泡边缘（上一轮回执游标调研的 UI 对应物），<200ms 微交互。

## 五、与前两轮合并后的总行动清单

1. **P0**：T1+T2（token 单源化 + 双端构建输出）——所有后续 UI 工作的地基。
2. **P0**：web/desktop OKLCH surface token + Electron 玻璃四层配方（第二轮清单不变）。
3. **P1**：mobile GlassSurface 平台抽象 + springify 编排（不变）；会话列表→详情 View Transitions（不变）。
4. **P1 新增**：输入栏玻璃托盘重构（复合枢纽方向）；气泡海拔分层样式。
5. **P2**：component.json 组件级 token（chat.bubble.* 等）随重构逐步补。

## 来源

- [Design Tokens Format Module 2025.10 — W3C Draft Community Group Report](https://www.designtokens.org/TR/2025.10/format/)（2026-07-30 发布；$value 判定/group $type 继承/$root 变体/别名解析算法均出自规范原文）
- [W3C Design Tokens Community Group](https://www.w3.org/community/design-tokens/)
- 其余实现细节引用见前两份 UI 调研文档的来源列表
