# UI 组件层调研：布局壳 / 卡片 / 按钮 / 聊天气泡

> 调研日期：2026-08-22（第四轮，接续 UI 三部曲；本轮依据 shadcn/ui 与 Radix Themes 官方文档原文）
> 视角：不谈"风格"谈 **API 设计与变体体系**——主流组件库的变体划分就是行业对组件语义的最新共识

## 结论速览

1. 应用壳的标准答案已收敛为 **Sidebar + 内容区的可组合模式**（shadcn Sidebar：Provider/Trigger/可折叠到图标）。
2. 按钮变体共识是**六档强调级**（solid/surface/soft/outline/classic/ghost），外加 highContrast 与 loading 内建。
3. 卡片三变体（surface/classic/ghost）+ `asChild` 语义切换是主流；「可交互卡片」用 asChild 变 a 并自动获得 hover/focus 态。
4. **最大的发现**：shadcn 已把 `Bubble`/`Message`/`Message Scroller`/`Attachment` 纳入核心组件库并区分「气泡表面」与「消息容器」两层——聊天 UI 正式成为标准组件类目，合鸣可直接对标其 API 分层。

## 一、应用布局壳：Sidebar 模式成为桌面端默认

shadcn 对 Sidebar 的定位描述很说明问题："sidebars are one of the most complex components… central to any application"。2025-2026 的应用壳共识：

```
<SidebarProvider>          ← 折叠状态上下文
  <AppSidebar />           ← 可组合：header/content/footer 插槽，可折叠为图标列
  <main>
    <SidebarTrigger />     ← 移动端折叠触发
    {children}
  </main>
</SidebarProvider>
```

要点：
- 折叠两态（完整 ↔ 仅图标）+ 键盘快捷键 + cookie 持久化是标配能力。
- 移动端退化为 Sheet（抽屉）而非堆叠——同一套内容两个容器。
- 合鸣 web/desktop 的 agent 列表、会话列表、工作区导航都适合装进这个壳；配合上一轮的玻璃配方，侧栏可用 ghost 材质悬浮在内容上。

## 二、按钮：六档强调级变体体系

Radix Themes Button 的变体集（当前 React 生态引用最广的按钮 API）：

| variant | 用途 | 典型场景 |
|---|---|---|
| `classic` | 强调最强（阴影+高光） | 主 CTA |
| `solid` | 实心强调 | 表单提交 |
| `surface` | 带边框表面 | 次要操作 |
| `soft` | 低饱和底色 | 第三级操作、工具栏 |
| `outline` | 仅描边 | 成组次要操作 |
| `ghost` | 无框，排版上等同文字 | 图标操作、密集工具栏 |

设计规则（从文档提取）：
- `radius: none→full` 五档独立于 size 控制——胶囊按钮（full）是 2026 默认审美。
- `highContrast` prop 一键切 WCAG 高对比版——无障碍不是另一套样式而是一个 prop。
- `loading` 内建（转圈替代文本但保持宽度）——防布局抖动。
- ghost 的负 margin 光学对齐细节：视觉贴边但 hover/active 时仍有完整 padding 热区。

合鸣映射：发送按钮=solid indigo；工具栏=ghost；危险操作（撤回/删除确认）=destructive 变体；语音通话接听/挂断=classic + 语义色。

## 三、卡片：三变体 + asChild 语义复用

Radix Themes Card：

- `variant: surface | classic | ghost`——默认 surface（细边+微底色），正好对应海拔 token 的 surface-1。
- **`asChild` 是关键设计**：卡片渲染为 `<a>` 或 `<button>` 时自动附加交互态样式（hover/focus）。"可点卡片"不再靠手写 hover 阴影，语义和样式绑定。
- size 1–5 控制内边距阶梯而非宽度；宽度由布局容器管——卡片只负责"内容分组"这一件事。

结合第一轮 bento 结论：bento 网格里的每格就是一个 surface 卡片；agent 状态卡用 classic 突出；纯排版区块（如统计数字组）用 ghost 卡去框化。

## 四、聊天气泡：聊天 UI 进入标准组件时代

本轮最重要的发现：shadcn/ui 核心清单里出现了完整的聊天组件族（`Bubble`、`Message`、`Message Scroller`、`Attachment`、`Input Group`），且 Bubble 文档明确了一个分层原则：

> "Bubble is intentionally scoped to the bubble surface. Place avatars, names, timestamps, metadata, and message-level actions in Message."

即**气泡表面 ≠ 消息容器**：
- `Bubble` 只管气泡本体：BubbleContent（内容）+ BubbleReactions（表情回应锚定气泡边缘）；七个视觉变体从 primary 到 ghost；start/end 对齐区分收发方；同发送者连续消息用 `BubbleGroup` 分组；宽度自适应内容、上限容器 80%。
- `Message` 管消息级元数据：头像、昵称、时间戳、悬浮操作（撤回/复制/引用）。
- `Message Scroller` 管滚动容器（自动吸底、新消息提示）。
- ghost 变体的用途注释直接点破趋势：**AI 助手消息趋向无框全宽**（"perfect for assistant messages that should not have a frame and can take the full width"）——与用户气泡形成材质对比。

这对合鸣是直接的 API 设计参考：现有 mobile/web 的消息项组件可以对照这个分层重构——尤其"AI agent 回复用 ghost 全宽、人类消息用 framed 气泡"这个区分，天然契合合鸣的多 agent 群聊场景（不同 agent 甚至可以用 tint 变体区分身份色）。

## 五、落地建议汇总

1. **P0**：desktop/web 引入或自建这套变体体系的组件基座——若引库，Radix Themes（成品主题）或 shadcn（源码归己）二选一；合鸣已有 Tailwind，shadcn 路线摩擦最小，且聊天组件族现成。
2. **P0**：消息组件按 Bubble/Message 两层重构（对照第四节分层），AI 回复试 ghost 全宽方案。
3. **P1**：应用壳统一为 SidebarProvider 模式；侧栏材质用玻璃 ghost 层。
4. **P1**：按钮/卡片全面对齐变体表（六档强调级 + highContrast + loading），并入第三轮的 component.json 组件令牌。
5. 所有组件态动画沿用第二轮弹簧参数（按压 15/400、入场 30/200）。

## 来源

- [Button — Radix Themes 官方文档](https://www.radix-ui.com/themes/docs/components/button)（六变体/radius 五档/highContrast/loading/ghost 光学对齐）
- [Card — Radix Themes 官方文档](https://www.radix-ui.com/themes/docs/components/card)（三变体/asChild 交互态/size 语义）
- [Bubble — shadcn/ui 官方文档](https://ui.shadcn.com/docs/components/bubble)（气泡表面 vs Message 分层/BubbleGroup/reactions 七变体/ghost 用于 AI 消息）
- [Sidebar — shadcn/ui 官方文档](https://ui.shadcn.com/docs/components/sidebar)（Provider 组合式/折叠两态/移动端 Sheet 退化）
