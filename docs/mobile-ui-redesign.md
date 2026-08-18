# 移动端 UI 重做 Wiki

## 项目概述

合鸣（Ensemble）移动端从 v0.8.0 开始进行全新 UI 重做，采用「墨土·液态墨韵」设计方向。

## 设计系统

### 色板（用户指定六色 + 暖琥珀点缀）

| 色名 | 色值 | 角色 |
|---|---|---|
| 淡黏土 | `#8F7D6F` | 暖表面/装饰（仅大号UI，不做小字正文，对比度3.9） |
| 玄泉 | `#3B3F4A` | 主品牌/主操作（白字10.5:1，按钮/标题） |
| 冷灰褐 | `#897F75` | 辅助（图标/大号UI，不做小字，对比度3.9） |
| 墨色 | `#3D3D3D` | 主文本（白底10.9:1） |
| 纯白 | `#FFFFFF` | 页面底/反白字 |
| 纯黑 | `#000000` | 大标题/强调（21:1） |
| 暖琥珀 | `#C4933F` | CTA/唯一活跃色点缀（仅大号装饰，对比度2.8） |

### 文字层级对比度（全 >= 4.5:1）

| 层级 | 色值 | 对比度 |
|---|---|---|
| 大标题 | 纯黑 #000000 | 21.0 |
| 主文本 | 墨色 #3D3D3D | 10.9 |
| 次级文本 | 玄泉 #3B3F4A | 10.5 |
| 弱文本 | 墨色 #3D3D3D | 10.9 |
| 白字按钮 | 白 on 玄泉 | 10.5 |

### 设计方向

- **Swiss Modernism 2.0**：大面积留白 + 纯黑文字 + 一个暖琥珀 CTA
- 分隔线用色差区分（不画线），页面底纯白，卡片极淡暖白
- 液态玻璃只用于导航层（Tab Dock / 弹层），不铺内容层

## 技术架构

### 液态玻璃实现

最终方案：**纯 View 多层叠加**（expo-blur BlurView 在 Android 上与 borderRadius 组合会出白色矩形，这是库的已知限制）。

层结构：
1. 半透明暖白面 `rgba(252,250,246,0.78)`
2. 内高光白边（玻璃折射感）
3. 左上微光斑（光源）
4. 底部暗边（3D 离地感）
5. 圆角 + 阴影

### 胶囊 Dock

- 自定义 Tab 按钮（不使用 BottomTabBar 默认样式）
- 拖动切换页面（react-native-gesture-handler Pan 手势）
- 丝滑弹簧动画（withSpring damping:18, stiffness:180）
- 白色图标（选中纯白 / 未选中半透明白）


## 性能优化

### APK 体积优化

**问题**：APK 190MB，下载慢（服务器带宽 ~5Mbps，需 5 分钟）。

**根因**：APK 包含全部 4 种 CPU 架构的 native 库（WebRTC + Skia + React Native），x86/x86_64（模拟器用的）白白占了 ~92MB。

**解决**：`android/gradle.properties` 中 `reactNativeArchitectures` 改为只保留 arm 架构：
```properties
reactNativeArchitectures=arm64-v8a,armeabi-v7a
```

**效果**：190MB → 98MB（减少 49%），下载时间从 5 分钟降到 2.5 分钟。

### 服务器带宽

实测服务器出站带宽约 600KB/s（5Mbps）。优化方向：
- 升级阿里云 ECS 带宽
- 接入 CDN（阿里云 CDN / Cloudflare）
- 启用 HTTP/2

## 版本历史

见 `src/pages/ChangelogPage.tsx`（应用内更新日志页面）。

## 关键文件

| 文件 | 作用 |
|---|---|
| `src/theme.ts` | 设计系统（色板/间距/圆角/阴影/动效） |
| `src/components/LiquidGlass.tsx` | 液态玻璃容器 |
| `src/components/Glass.tsx` | Glass 兼容层 |
| `src/components/ui.tsx` | 通用 UI 组件 |
| `src/components/AppHeader.tsx` | 导航栏 |
| `src/pages/ChangelogPage.tsx` | 更新日志页面 |
