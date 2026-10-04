# prefers-reduced-motion 手动验证指引

验证 web 端在 `prefers-reduced-motion: reduce`（系统「减少动效」）下的降级效果。

自动化验证暂缺：web 包未引入 playwright / puppeteer / vitest / cypress，CLI 工具链也不支持
媒体查询模拟。以下为手动复核步骤，约 30 秒。

## 起 dev server

在仓库根目录执行：

```bash
pnpm --filter @ensemble/shared build
cd desktop/packages/web && npm run dev
```

浏览器打开终端输出的地址（默认 `http://localhost:5173`）。应用为 Electron 壳，浏览器里
功能一致，可直接在此验证。

## 打开模拟媒体特性

Chrome / Edge：

1. DevTools（`F12` 或 `Ctrl+Shift+I`）→ `Ctrl+Shift+P` → 输入 `Show Rendering` → 回车
2. 在 **Rendering** 面板找到 **Emulate CSS media feature** 下拉 → 选择
   **`prefers-reduced-motion`**
3. 值选 **`reduce`**

选中后，**DevTools 会出现一条紫色「 Sensors / Emulation 」提示条**，页面无需刷新即可生效。
若 `Show Rendering` 搜不到，先打开 DevTools 主面板再执行。

验证完记得把该下拉改回 **No emulation**，否则后续开发会一直处于 reduce 态。

## 三个验证点

### 1. Modal 打开 —— 应无缩放动画

`ui.tsx` 的 Modal 面板类名为 `animate-in fade-in zoom-in-95 anim-dur-200 anim-spring`。
任意触发一个 Modal（如「新建任务」）。

| | 表现 |
|---|---|
| **正常（reduce 生效）** | 弹窗**直接出现**，无缩放、无淡入，无任何过渡过程 |
| **异常（未降级）** | 弹窗从 95% 缩放并淡入，约 200ms 后到位，能看到明显的「长出来」过程 |

降级规则在 `index.css` 的 `@media (prefers-reduced-motion: reduce)` 块内，`.anim-spring`
被置为 `animation: none`。

### 2. RunCard 展开 —— 应瞬间切换、无高度过渡

`DashboardPage.tsx` 看板页的 RunCard，点击卡片任意位置展开详情。类名
`grid-rows-expander`（展开时加 `is-open`）。

需先有任务数据：若无任务，在「看板」页点「新建任务」创建一个才会出现 RunCard。

| | 表现 |
|---|---|
| **正常（reduce 生效）** | 详情区**瞬间展开**，高度直接跳到最终值，无平滑下滑 |
| **异常（未降级）** | 高度平滑过渡约 220ms，能看到内容自上而下推开 |

### 3. 气泡入场 —— 应直接出现

需有真实对话：在「联系人」里选一个 agent 或用户发一条消息，对方回复后观察新气泡。

类名 `bubble-in`（`MessageList.tsx`），仅施加于**本次新增的那一条**，历史消息与切会话都不播。

| | 表现 |
|---|---|
| **正常（reduce 生效）** | 新气泡**直接出现在列表底部**，无淡入、无 4px 上浮 |
| **异常（未降级）** | 新气泡淡入并轻微上浮，约 200ms，与前一条有先后差别 |

## 已验证 / 未验证

- **已验证**：降级规则正确注册进 CSSOM（`document.styleSheets` 可解析出
  `(prefers-reduced-motion: reduce)` 块，含 `.grid-rows-expander, .anim-spring, .spring-in,
  .bubble-in` 四个选择器）；非 reduce 态未被误伤（各动画类在默认环境下曲线与时长正常）。
- **未验证**：`reduce=true` 时上述三个点的实际降级表现——需按本文档手动复核。
