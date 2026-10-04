# 合鸣前沿 UI 设计方案 v2

设计文档，非实现。本文所有判断基于当前仓库已验证的代码与实测数据。

## 前置：已确立的动效判据（本文所有动效设计均受此约束）

今天在实操中验证了三条判据，本方案不引入任何与之冲突的设计：

| 判据 | 依据 | 应用 |
|---|---|---|
| **scale 类可用 1.56 过冲** | 过冲在此语义下是「弹性」，且不改变布局尺寸 | Modal 入场、`.press` 按压 |
| **高度类必须压到 1.06** | 高度过冲会撑大行盒，且 `overflow-hidden` 裁不掉（盒子本身变大），把下方内容整体下推再拉回 = 布局抖动 | RunCard 展开、任何高度/尺寸过渡 |
| **小位移（≤8px）不用过冲曲线** | 过冲幅度 ≈ 位移 × 5%，8px 位移配 1.56 的回弹仅 0.4px，肉眼不可见，多条同时出现只呈现为抖动 | 气泡入场 4px 用无过冲 ease-out |

`prefers-reduced-motion`：所有动效类一律进 `index.css` 的降级块（`animation/transition: none`），
不新增例外。JS 驱动的动画（`scrollIntoView`）需显式 `matchMedia` 守卫——
CSS 兜底在原理上覆盖不到 JS API，这是今天已修复的既有缺口（`a37751a`）。

---

## 一、视觉语言定案

### 1.1 surface 海拔体系：当前是坏的，需要重建

**实测发现（非推测）**：现有 `surface1` / `surface2` 语义方向在明暗两套之间不一致，且各有一套重复值。

```
浅色：bg(#F4F6F9, L=0.92) < surface1(#FAFBFC, L=0.96) < surface(#FFFFFF, L=1.00) = surface2
暗色：bg(#0F172A, L=0.009) < surface(#1E293B, L=0.022) = surface1 < surface2(#334155, L=0.051)
```

三个具体问题：

1. **`surface1` 在浅色比 `surface` 暗（降级），在暗色却等于 `surface`（无变化）**——同一个 token
   名在两套主题里语义相反，任何按 `surface1` 写的样式在暗色下会静默失效。
2. **`surface2` 在浅色等于 `surface`**，多出一个纯装饰的别名。
3. **命名反直觉**：数字越大在暗色越亮（升），在浅色却期望越「浮起」——两套方向相反。

**主张：改为「数值越大越靠近用户（越浮起）」的单向海拔，重建四档。**

| token | 语义 | 浅色建议 | 暗色建议 |
|---|---|---|---|
| `--c-surface-0` | 页面底 | `#F4F6F9`（现 bg） | `#0F172A`（现 bg） |
| `--c-surface-1` | 卡片/面板 | `#FFFFFF`（现 surface） | `#1E293B`（现 surface） |
| `--c-surface-2` | 浮层/下拉/hover 底 | `#FAFBFC` | `#334155` |
| `--c-surface-3` | 最高层（模态、命令面板） | `#F1F5F9` | `#3F4A5F` |

**关键设计约束：`surface-2` 与 `border` 必须分离。** 实测暗色下
`border` 与 `surface2` 都是 `#334155`——意味着浮起的卡片**边框与底色同色、轮廓消失**。
重建后 `border` 应取比 `surface-N` 略亮或略暗的独立值，保证任何海拔下卡片都有可见轮廓。

`bg` 与 `surface-1` 是当前用得最多的两个值，**保留原名作为别名**可让现有 27+ 处
`bg-surface` 无需改动，避免大范围返工。

### 1.2 暗色不是换色板：三条独立设计语言

实测暗色色板（HSL）：

```
bg          #0F172A  S=47% L=11%
surface     #1E293B  S=33% L=17%
border      #334155  S=25% L=27%      ← 与 surface2 同值
primary     #8B8F98  S= 6% L=57%      ← 几乎无彩
accent      #B4ACF8  S=84% L=82%      ← 极亮极艳
destructive #F87171  S=91% L=71%      ← 极亮极艳
```

**主张：暗色应有独立语言，而非把浅色值调暗。** 三个具体调整：

1. **状态色降饱和、提亮度**：`accent` 84%、`destructive` 91% 的饱和度在深底上过艳，
   长时间注视刺眼且使状态色在视觉上「跳」出界面。建议降至 55-65%，亮度保持。
2. **`primary` 几乎无彩（S=6%）**：玄色系作为主色在暗色下退化为灰，
   与 `muted`（S=20%, L=65%）区分度不足。建议暗色下 `primary` 提亮至 L≈70% 或加一点色相。
3. **用「亮度差」而非「描边」表达海拔**：深色界面上 1px 描边容易显得脏。
   建议 surface 每升一档亮度 +4-6%，边框只在相邻档位差值 <3% 时才需要。

### 1.3 强调策略：三级，按「信息重要度」而非「好不好看」分配

| 级别 | 手段 | 用在哪 | 不用在哪 |
|---|---|---|---|
| **L1 强** | 实心色块（`bg-primary`） | 每屏至多 1-2 个：主 CTA、当前选中项 | 列表项、次要按钮 |
| **L2 中** | 描边（`border`） | 次级按钮、输入框、卡片轮廓 | 高频点击区（会显得噪） |
| **L3 弱** | 留白 + 文字色阶 | 分组标题、辅助信息、元数据 | 需要被看见的交互元素 |

**规则：同一屏内实心色块不超过 2 处。** 这是桌面端信息密度高的主要约束——现在
`SettingsPage` 有 25 个 `onClick`、`GroupSettingsDialog` 8 个，若都做实心会失去视觉锚点。

### 1.4 字体与数字：数据密集页需要等宽数字

实测 `TokenUsagePage` 是纯数据页（图表 + 表格），`SettingsPage` 是表单密集页。

**主张：数据密集页启用 `font-variant-numeric: tabular-nums`。** 现状是默认比例数字，
表格里的数字宽度不等——**列对不齐，扫读时数字跳行**。`tabular-nums` 让每个数字占等宽，
是零布局成本的可读性提升（只加一个 CSS 声明，不改任何组件）。

同时建议为 `fontFamily` 补 `font-feature-settings` 支持 Inter 的可变字重——但这是加分项，
不阻塞。

---

## 二、组件范式升级：三个价值最高

从 14 项缺口里挑三项。判断标准：**改动小、影响面广、当前设计确有缺口**。

### 2.1 Button 六档（缺口 #2）

现状 `ui.tsx:16-22` 四档：`primary / secondary / ghost / danger`。
实测全站用量：secondary 22 / primary 19 / ghost 7 / danger 3。

**缺的四档与视觉差**：

| 档位 | 视觉 | 何时用 | 全站预估用量 |
|---|---|---|---|
| `outline` | 透明底 + 2px 描边 | 表格行内操作、卡片右上角菜单 | 高（替代当前 secondary 的滥用） |
| `soft` | 主色 10% 底 + 主色字，无描边 | 标签切换（当前选中）、筛选 chip | 中高（SettingsPage 筛选区） |
| `link` | 无底无框，仅文字 + hover 下划线 | 「忘记密码」「查看全部」类文字入口 | 中 |
| `surface` | 抬升底（`bg-surface-1` + 微阴影），无描边 | 悬浮工具栏、下拉触发器 | 低（ChatInputBar 工具条） |

**核心论点**：当前 `secondary`（`border` + hover 变主色）承担了太多角色——
22 处用量里既有「取消按钮」（中性）、又有「筛选 chip」（选中态）、还有「次级 CTA」，
语义混杂。**拆成 outline / soft / link 三档后，取消按钮不会在 hover 时变成主色**，
这是当前最实际的视觉缺陷。

**`loading` 态**：现在 `Button` 没有 loading prop，异步操作只能靠调用方禁用。
建议内置 `loading`（内嵌 Spinner + 自动 disabled），这是最实用的补齐项。

**`highContrast` 不建议做**——当前无高对比度场景，加了是死代码。

### 2.2 视差与表面（缺口 #4，同 1.1）

见第 1.1 节。此处只补组件层：新建 `<Card variant="flat" | "raised" | "overlay">`，
把 surface-1/2/3 封装进去，避免每个页面手写 `bg-surface2`。

### 2.3 聊天组件分组（缺口 #7）

`MessageList.tsx` 每条消息独立渲染，**同一发送者的连续消息没有视觉分组**——
三个连续气泡各自独立，与「一个人连发三条」应有的成组感不符。

**设计**：
- 连续同 sender 且间隔 <5 分钟 → 合并为 `BubbleGroup`，组内仅最后一条显示时间戳
- 组间距略小于组内间距（视觉上「成团」）
- `ai-ghost` 变体已经是全宽无框，天然适合分组；`mine/theirs` 有框，分组时组内可减框

**价值**：这是 IM 类应用的核心视觉判断（谁在连发），当前缺失。改动局限在
`MessageList.tsx` + `messageViews.tsx`。

---

## 三、动效编排（重点）

### 3.1 入场动画编排原则（可复用，结束「每次重新判断」）

今天确认过：整列表 200 条同时播 = 灾难（性能 + 观感）；仅新增消息动画 = 正确。
但这是**逐个组件想出来的**，需要沉淀成原则。**四条规则**：

1. **单次渲染内动画元素上限 5 个。** 超过则只保留视觉权重最高的几个。
   *依据：DOM 元素同时动画超过约 10 个，浏览器每帧的 style/layout 计算开始掉帧。*

2. **动画只加在「本次新增」的节点上，不加在「本次渲染」的节点上。**
   两者区别：新增 = 元素身份是新的（首次出现在 DOM）；渲染 = 元素只是被重绘。
   *实现范式已验证：ref 记住上次的边界值，diff 出「新出现的那一个」。气泡用的就是这个。*

3. **排序/分组变化不触发入场。** 插入位置不是追加（prepend、补拉历史）时**一律不播**。
   *已踩过的坑：气泡动画最初只判「末条 id 变化」，补拉历史时误播。修法是加「首条未变」守卫。*

4. **首次挂载整块不播。** 页面初始化、切换会话、切换路由 → 整块直接出现。
   *依据：用户此时在「读」不在「等」，动画只会拖慢。*

**这套原则的落地形式**：一个可复用的 `useEntranceAnimation(boundaryKey)` hook，
封装规则 1-4，各组件传入自己的边界值（气泡传 `lastId`、列表传 `pageId`）。
避免下个组件再写一遍 ref 比较。

### 3.2 页面转场：TasksPage 列表 → 详情

**现状**：`View Transitions` 只在 `ChatPage.tsx:738` 用了（切换联系人，key = `chat-pane`）。
`TasksPage.tsx:134` 的 `to={/runs/${run.id}}` 是教科书级的 List→Detail 却完全没做。

**编排设计**（分三段，总时长控制在 300ms 内）：

| 阶段 | 时长 | 元素 | 曲线 |
|---|---|---|---|
| 离场 | 120ms | 列表整体 `opacity 1→0`、`transform: scale(1→0.98)` | `ease`（无过冲） |
| 过渡 | — | 详情卡 `view-transition-name` 从列表项位置扩展到全屏 | 由浏览器接管 |
| 入场 | 220ms | 详情内容 `opacity 0→1`、`translateY 8px→0` | `.anim-spring`（1.56） |

**离场不用过冲曲线**：离场是「离开」语义，过冲会让它看起来在回来。
入场用 1.56 因为是「到达」语义。**这个不对称是有意的**，与今天的判据一致。

**实现**：`document.startViewTransition` 包裹 `navigate()`，
需给列表项和详情卡各设 `viewTransitionName`（同名才能配对形变）。
**降级**：已有 `prefers-reduced-motion: no-preference` 包裹（`index.css:154`），
reduce 态下 `startViewTransition` 不执行，直接切换。

**风险点**：`view-transition-name` 必须全局唯一，若列表有多项需动态拼接
（如 `task-${id}`）且详情页要知道自己对应哪个 id。实现时需确认 React Router 的
`useParams` 时序——**这属于电脑端的数据流边界，我不自行决定归属**。

### 3.3 手势与动效配合：聊天气泡滑动

**现状**（移动端，非我的边界）：`SwipeableBubble.tsx`，80px 阈值，
damping 20 / stiffness 300，`[-120,120]` 范围。**只有位移，没有吸附与回弹的编排**。

**设计（三态编排）**：

1. **拖拽中**：位移跟手，**同时轻微缩放**（scale 1→0.97）。
   依据：纯位移在移动端「不像实体」，缩放提供抓握反馈。
2. **越过阈值（>80px）**：进入「待释放」态——
   - 目标功能图标（引用/转发）**从两侧滑入并淡入**（120ms，无过冲）
   - 气泡 scale 回到 1.0 并**回弹 2px**（提示「已就绪」）
3. **未过阈值释放**：damping 20/stiffness 300 回位，图标淡出。
   依据：回位是「取消」语义，用欠阻尼的振荡表达「弹回去」是恰当的。
4. **已过阈值释放**：执行动作后气泡**向右滑出**（200ms ease-in），新消息或操作结果淡入。

**统一判据**：过阈值回弹的「2px 回弹」是 scale 类小位移 → **不能用 1.56**，
用 `springify` 的 damping 20/stiffness 300（已有参数，符合 3.1 规则 3）。

**降级**：`useReducedMotion`（reanimated 原生）→ 关闭 drag 位移，
改为「点按气泡 → 弹出操作菜单」的功能等价路径。**不能简单禁用**——
否则 reduce 用户将无法使用引用/转发功能。

---

## 四、可落地性评估

| 项 | 改哪些文件 | 依赖 | 风险 | 需新 token |
|---|---|---|---|---|
| surface 海拔重建 | `tokens.json`、`build-tokens.mjs`(校验)、`tailwind.config.js` | 三条构建校验（P2，未做） | **中**：27+ 处 `bg-surface` 需确认不受影响 | ✅ `surface-0/1/2/3`、修正 `border` |
| 暗色降饱和 | `tokens.json` primitive/semantic.dark | 无 | 低：改值即可，computed style 可验 | ❌（改现有值） |
| `tabular-nums` | `index.css` 或 `TokenUsagePage.tsx` | 无 | **无** | ❌ |
| Button 六档 + loading | `ui.tsx`、各调用页 | 无 | **中**：22 处 secondary 需重新归类 | ❌（用现有 surface） |
| `<Card variant>` | `ui.tsx` | surface 海拔 | 低 | ❌（依赖海拔） |
| BubbleGroup | `MessageList.tsx`、`messageViews.tsx` | 无 | 中：需改渲染分组逻辑 | ❌ |
| 入场 hook | 新建 `useEntranceAnimation.ts` | 无 | **低**（纯新增） | ❌ |
| View Transitions（TasksPage） | `TasksPage.tsx`、`RunPage.tsx`、`index.css` | React Router 时序 | 中 | ❌ |
| 气泡手势编排 | 移动端 `SwipeableBubble.tsx` | 移动端边界 | 高 | ❌ |

**需用户决策的 token 变更**（P0 之前必须定）：
- `surface-0/1/2/3` 四档的具体值
- 暗色 `accent`/`destructive` 降饱和后的目标值
- `border` 与 `surface-2` 分离后的值

---

## 五、分期建议

**P0（视觉语言地基，1 批）**
- surface 海拔四档重建 + border 分离
- 暗色状态色降饱和
- `tabular-nums` 上 TokenUsagePage
- 交付物：色彩体系自洽，`bg-surface2/3` 可用；暗色观感明显改善

**P1（组件范式，1 批）**
- Button 六档 + `loading`，22 处 secondary 重新归类
- `<Card variant>`
- 入场动画 hook（把 3.1 的原则代码化）
- 交付物：组件 API 完整，新增组件不用重新判断动画

**P2（动效编排，1-2 批）**
- View Transitions 扩展到 TasksPage
- BubbleGroup 聊天分组
- 交付物：跨页转场 + IM 核心视觉判断

**P3（需跨会话协作，不在我边界）**
- 移动端手势编排（与移动端会话）
- `-fg` 契约与三条构建校验（已立项，等排期）

---

## 附：本文所有实测数据的来源

- surface 海拔亮度/HSL：Node 脚本按 WCAG 相对亮度公式计算
- 降级类清单：dev server 读 `document.styleSheets` 的 CSSOM
- 组件与用量：grep 全项目 `src/`
- 动画曲线判据：bezier 严格解算（x(t) 二分求参后逐 0.5ms 采样）
