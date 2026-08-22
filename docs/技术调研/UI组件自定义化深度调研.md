# UI 组件自定义化深度调研：分发模式 / 主题定制 / Headless / RN 路线

> 调研日期：2026-08-22（第五轮，接续组件层调研；依据 shadcn/ui、Radix Primitives、NativeWind 官方文档原文）
> 问题意识：组件"能用"之后，如何被**深度自定义且不被升级绑架**？四种模式的机制与取舍

## 结论速览

1. 自定义化的范式之争已分出胜负格局：**源码归己（shadcn）成为主流**，headless（Radix）负责行为无样式，成品库（MUI 等）退守企业快速交付。
2. shadcn 的本质不是组件库而是**分发协议**：registry-item JSON schema（20 个属性）定义了"一段 UI 能力"的标准化打包方式，第三方生态据此发布可安装的组件包。
3. 主题定制的技术底座是「语义 token 的 CSS 变量化 + background/foreground 成对约定」，与第三轮 W3C token 架构无缝对接。
4. RN 侧：NativeWind 已到 v5，Tailwind className 写法在 RN 可用——双端统一样式心智的时机成熟。

## 一、四种自定义化范式

| 范式 | 代表 | 自定义方式 | 升级关系 | 适用 |
|---|---|---|---|---|
| 源码归己 | shadcn/ui | CLI 把组件**源码复制进你的仓库**，改就是了 | 无锁定；上游更新可选 diff 合入 | 有设计能力的团队 |
| Headless 行为库 | Radix Primitives | 组件只管行为/可达性，样式 100% 自绘 | 行为层自动升级，样式零冲突 | 从零造设计系统 |
| 成品主题库 | MUI / Ant Design | theme 对象 + CSS 变量覆盖 | 库版本绑定，深度定制对抗库假设 | 快速交付、内部工具 |
| 原子 CSS | Tailwind | 不碰组件，组合 utility 类 | 与以上三者正交，全部兼容 | 一切场景的底层 |

合鸣的选择建议（见第六节）：web/desktop 用 shadcn 范式（内含 Radix 行为），RN 用 NativeWind 对齐同一套 token。

## 二、shadcn 深度机制一：Registry 分发协议

shadcn 新文档站的 Registry 部分揭示了它的真实形态——一个**组件 npm**：

- `registry-item.json` schema 定义安装单元，核心属性（官方文档提取，共 20 个）：`name/title/description/type/author`（元数据）、`dependencies/devDependencies/registryDependencies`（依赖声明，后者支持引用其他 registry 的组件形成组合）、`files/path/target`（源码文件落盘位置）、`tailwind/cssVars/css/envVars/font`（安装时要对项目做的**配置变更**）、`docs/categories/meta`。
- 关键理解：安装一个组件不只是复制文件，还可能注入 CSS 变量、Tailwind 配置、环境变量——schema 把这些全部声明式化了。
- `namespaces` 支持多 registry 共存（`@shadcn/react`、AI SDK 等都是独立 namespace）；CLI 支持 `MCP Server` 模式（AI 编码助手可直接检索并安装组件——2026 年的分发新渠道）。
- **对合鸣的意义**：如果未来做插件化 UI 扩展（第三方给合鸣写面板/卡片），registry-item schema 就是现成的"UI 插件清单格式"，与 Cordis 方案的插件化方向同构。

## 三、shadcn 深度机制二：语义 token 定制面

Theming 文档给出的完整定制面（第三轮 token 架构的具体落地参照）：

- **约定**：所有表面色都有 `-foreground` 成对令牌（`primary` ↔ `primary-foreground`），组件类名形如 `bg-primary text-primary-foreground`——换主题只改变量值，组件类名零改动。
- 完整语义令牌表（12 组）：background/card/popover/primary/secondary/muted/accent/destructive/border/input/ring/chart-1..5/sidebar 系列。每组的"What it controls + Used by"官方注释直接可以抄进合鸣的 semantic.json。
- **暗色 = `.dark` 选择器内覆盖同名变量**，与第三轮"主题切换=semantic 引用重排"完全一致。
- `style: "base-nova"` 字段说明 shadcn 现在有多套风格预设（base-nova 是新版默认），风格切换也是配置级。
- shadcn/create：可视化调色板预览后生成 preset——设计师不碰代码也能产出主题。
- 注意细节：示例值已是 oklch()（如 `--primary: oklch(0.205 0 0)`），OKLCH 在主流工具链已是默认。

## 四、Headless 模式：Radix 的行为/皮肤分离

Radix Primitives 的 styling 文档明确了 headless 的契约：

1. **功能样式也归你**："a Dialog Overlay won't cover the entire viewport by default. You're responsible for adding those styles"——连 position:fixed 都不替你写，彻底零假设。
2. **className 全件透传**：每个组件及其每个 part（复合组件的子元素）都接受 className 直达 DOM。
3. **data-state 状态暴露**：有状态的组件把状态映射为 `data-state="open|closed"` 属性——CSS 用属性选择器就能写全状态样式（`.AccordionItem[data-state="open"] {...}`），无需 JS 钩子。
4. CSS-in-JS 同样一等公民（styled(Accordion.Item) 直接可用）。

这套契约正是 shadcn 内部用 Radix 做行为层的原因：shadcn 组件 = Radix 行为 + Tailwind 皮肤 + 归你所有的源码。

## 五、RN 侧自定义化路线：NativeWind v5

- NativeWind 让 RN 直接使用 Tailwind className（`className="mx-auto max-w-sm flex-1 gap-4"`），**v5 已可用**（官网 pre-release 公告）。
- 平台前缀支持响应式区分（`ios:pt-8 pt-12`）。
- 对合鸣的意义：mobile 与 web/desktop 可以共享**同一套 Tailwind 语义类名心智**；配合第三轮的 token 构建管线（shared 包单源输出），双端视觉一致性有了完整技术路径：primitive.json → Style Dictionary → web CSS vars + RN tokens → 两端各自以 Tailwind/NativeWind 类名消费。
- 取舍提示：NativeWind 是编译期方案（Babel 插件转换），极端动态样式仍需回退 StyleSheet；expo-blur/GlassView 这类原生效果不在 Tailwind 表达范围内，仍走第二轮的 GlassSurface 抽象封装。

## 六、合鸣落地路径修订

1. **P0（替代第四轮的"引库二选一"）**：web/desktop 初始化 shadcn（base-nova 风格起步）——拿到的是源码而非依赖，后续一切自定义无锁定；聊天 Bubble/Message/Sidebar 组件直接从 registry 安装再改造。
2. **P0**：semantic.json 按第三节 12 组语义令牌建（含 sidebar 系列），与 W3C 三层架构合并为一份管线。
3. **P1**：评估 mobile 接入 NativeWind v5（先新页面试点，存量 StyleSheet 页面不急迁）。
4. **P1**：若做 UI 插件化扩展，registry-item schema 作为插件清单格式候选（与 Cordis 插件方案联动）。
5. 设计师协作：shadcn/create 可视化 preset 或 OKLCH.com 产 token，走 git review 进 main。

## 来源

- [Theming — shadcn/ui](https://ui.shadcn.com/docs/theming)（12 组语义令牌表/bg-fg 成对约定/.dark 覆盖/base-nova/shadcn/create）
- [registry:item — shadcn/ui Registry API](https://ui.shadcn.com/docs/registry/registry-item-json)（20 属性 schema/配置注入声明/namespaces）
- [Styling — Radix Primitives](https://www.radix-ui.com/primitives/docs/guides/styling)（零样式契约/className 透传/data-state）
- [NativeWind 官网](https://www.nativewind.dev/)（v5 发布公告/平台前缀/Tailwind in RN）
