# 移动端 UI 重做踩坑记录

## 1. DSH 技能系统踩坑

### 1.1 技能安装位置错误

**问题**：DSH 技能系统和 Claude Code 技能系统使用不同的目录：
- DSh 技能：`~/.agents/skills/`（本环境实际使用）
- Claude Code 技能：`~/.claude/skills/`

**后果**：我一开始把 cocoloop 和 anthropic-frontend-design 安装到了 `~/.claude/skills/`，DSh 后台重启后无法发现。

**修复**：把技能复制到 `~/.agents/skills/`，DSh 立即识别。

**教训**：DSH 技能发现机制（`@deepseek-ai/dsh-skill-filesystem`）的 `roots()` 方法定义了扫描路径，优先项目级 `.dsh/skills` 和 `.agents/skills`，然后才是用户级。必须确认目标目录再安装。

### 1.2 设计技能只读了说明，没调用工具

**问题**：用户要求"先学习再做"，我只读了 `SKILL.md` 的文字说明，从未运行 `python scripts/search.py` 设计智能工具。

**后果**：没有真实的设计数据支撑决策，导致配色/布局凭空臆造。

**教训**：技能的价值在于它的工具（搜索调色板、排版指南、UX 规则），不能只读说明就动手。

## 2. 源码被重置

### 2.1 未提交的改动被外部进程覆盖

**问题**：用户开场说"正在同步做另一个进程"。我做了大量修改（theme.ts、版本号、组件等）但**从未提交到 git**，后来文件系统被重置回 v0.7.79。

**后果**：所有改动丢失，需要重做。

**教训**：
- 做改动后**立即提交到独立分支**，不要等"最后一起提交"
- DSH 的 `run_code` 文件写入是持久的（我验证过），但外部 git 操作可以覆盖
- 保护分支策略：`git checkout -b feat/mobile-ui-xuank-mo-082`，即使 main 被 reset，分支 commit 安全

### 2.2 Windows 换行符导致编辑失败

**问题**：`String.replace('\n', ...)` 在 Windows 文件（\r\n）上匹配失败，我的"删除任务列表文字"等编辑静默失败。

**后果**：构建出来的 APK 没有应用改动，用户说"没有效果"。

**教训**：
- 文件读写前先检测换行符
- 或用正则 `/\r?\n/g` 替代固定字符串
- 改动后**验证文件实际内容**，不能假设 replace 成功

## 3. APK 签名问题

### 3.1 改签名 key 导致无法覆盖安装

**问题**：我创建了 release keystore（CN=Ensemble）并改了 build.gradle，导致 APK 签名从 debug 变成 release。用户无法覆盖安装旧版。

**教训**：**不要改签名 key**。除非用户明确要求，否则始终保持原始 debug keystore。

### 3.2 expo prebuild 重建签名配置

**问题**：`expo prebuild --clean` 会重新生成 android 目录，包括 build.gradle。之前的签名配置（如 v1SigningEnabled）会被覆盖。

**教训**：
- prebuild 后必须检查 build.gradle 的 signingConfigs
- 重要的自定义配置（如 local.properties、signingConfig）在 prebuild 后需要重新应用
- build-release.cjs 的版本注入标记在 prebuild 后也会消失，但它会自动重新注入

### 3.3 AGP 9.x 不支持 v1 签名

**问题**：Gradle 9.3.1 + AGP 9.x 默认只生成 v2 签名。apksigner 的 `--v1-signing-enabled true` 和 jarsigner 都无法可靠地给已签名 APK 添加 v1。

**现状**：目前只能生成 v2-only 签名的 APK。

**可能的解决**：降级 AGP 版本，或使用其他签名工具链。

## 4. React Native 玻璃效果踩坑

### 4.1 BlurView + borderRadius = 白色矩形（Android）

**问题**：expo-blur 的 `BlurView` 放在有 `overflow: "hidden"` + `borderRadius` 的父级 View 内，Android 上模糊失效，显示为白色矩形。

**尝试过的修复**：
1. 去掉父级 overflow:hidden → 模糊溢出
2. BlurView 自身作为容器 → 仍然白色矩形
3. apksigner 添加 v1 签名 → 不生效

**最终方案**：放弃 BlurView，用纯 View 多层叠加实现玻璃效果。

**教训**：
- expo-blur 在 Android 上的 borderRadius 支持有已知限制
- "真透穿"需要原生级支持（如 iOS UIVisualEffectView），Android 上不可靠
- 纯 View 近似在视觉上足够好，且跨平台稳定

### 4.2 BottomTabBar 默认样式覆盖自定义玻璃

**问题**：用 `BottomTabBar` 包裹 `LiquidGlass` 时，BottomTabBar 自带全屏宽度样式、背景色，完全覆盖了玻璃效果。

**教训**：要实现自定义 Tab 外观，必须**完全替换 BottomTabBar**，自己渲染 Tab 按钮。

### 4.3 elevation 阴影在圆角卡片上产生矩形

**问题**：Android 上 `elevation` 阴影在 `borderRadius` 卡片上显示为矩形阴影。

**教训**：需要圆角阴影时，不用 elevation，改用纯色背景或第三方阴影库。

## 5. 版本管理踩坑

### 5.1 build.gradle 版本号在 prebuild 后被覆盖

**问题**：expo prebuild 会重新生成 build.gradle，把版本号硬编码为 app.json 当时的值。如果之后改了 app.json 但不重新 prebuild，build-release.cjs 的版本注入会跳过（因为标记已存在）。

**教训**：prebuild 后的第一次构建，build-release.cjs 会正确注入版本。但如果 prebuild 和版本 bump 的顺序搞错，版本号会不一致。

### 5.2 版本号跳跃过快

**问题**：从 0.8.0 到 0.8.28，版本号跳跃过快（28 个小版本），因为每次小改动都 bump 版本。

**教训**：
- 应该在一个版本内完成所有改动，再 bump
- 使用 git 分支保护改动，不要依赖频繁发布来"保存"进度

## 6. 设计方向踩坑

### 6.1 颜色太灰蒙蒙

**问题**：用你的六色（全是中性色）直接铺，没有亮色做视觉焦点，界面看起来"泥巴糊墙"。

**教训**：
- 六色全中性时，必须加一个亮色点缀（暖琥珀 #C4933F）
- 大面积用纯白/纯黑，中性色只做局部层次
- 需要先用设计技能工具调研，不能凭空分配颜色角色

### 6.2 分隔线太丑

**问题**：纯黑分隔线在暖色界面上很突兀。

**教训**：现代设计趋势是用色差区分层级，不画线。纯黑分隔线只适合高对比黑白设计。

## 7. 联系人页智能体不显示

### 7.1 sections 数组过滤空 rows

**问题**：`.filter((s) => s.rows.length > 0)` 把 agents=空数组的 section 直接删了。

### 7.2 agents 数据未加载

**问题**：ContactsPage 没有调用 `api.getAgents()` 加载 agents 数据。DashboardPage 加载了，但如果用户直接切到联系人页，数据就是空的。

**教训**：页面依赖的数据必须在该页面内加载，不能假设其他页面已加载。

---

## 关键教训总结

1. **先调研再动手**：用设计技能工具获取真实数据，不要凭空臆造
2. **立即提交**：改动后立即 commit 到保护分支
3. **不要改签名 key**：始终保持原始 keystore
4. **Android BlurView + borderRadius = 白色矩形**：这是 expo-blur 的已知限制
5. **BottomTabBar 无法自定义**：要实现自定义 Tab 必须完全替换
6. **Windows 换行符**：文件编辑前检测 \r\n vs \n
7. **数据加载**：页面依赖的数据必须在该页面内加载
8. **版本号管理**：不要频繁 bump，一个版本内完成所有改动
