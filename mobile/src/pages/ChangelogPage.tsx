/**
 * 更新日志页
 * 完整版本历史记录
 */
import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { colors, spacing, radius, fontSize , ms } from "../theme";

const changelogData = [
  {
    version: "v0.9.31",
    date: "2026-08-28",
    changes: [
      "推送 token 注册改为登录后调用（解决启动时 authToken 为空的问题）",
    ],
  },
  {
    version: "v0.9.30",
    date: "2026-08-28",
    changes: [
      "推送 token 诊断日志增强（initNotifications 入口确认 + 每步日志）",
    ],
  },
  {
    version: "v0.9.29",
    date: "2026-08-28",
    changes: [
      "推送 token 注册加详细日志（7 步诊断）",
    ],
  },
  {
    version: "v0.9.28",
    date: "2026-08-28",
    changes: [
      "推送 token 注册用 CLOUD_SERVER 地址（不依赖 connectedDevice）",
    ],
  },
  {
    version: "v0.9.27",
    date: "2026-08-28",
    changes: [
      "推送 token 注册加 Authorization header",
    ],
  },
  {
    version: "v0.9.26",
    date: "2026-08-28",
    changes: [
      "版本号 bump + ChangelogPage 同步 v0.9.25 条目",
    ],
  },
  {
    version: "v0.9.25",
    date: "2026-08-28",
    changes: [
      "修复 Android 16 白屏：禁用 React Native bridgeless 模式（newArchEnabled=false）",
      "修复 expo-notifications release 构建兼容性（addNotificationResponseListener try-catch）",
      "推送通知客户端注册（Expo Push Token + POST /api/devices/push-token）",
      "新增 projectId 配置（expo push token 需要）",
    ],
  },
  {
    version: "v0.9.24",
    date: "2026-08-27",
    changes: [
      "新增 Expo projectId 配置（推送 token 需要）",
    ],
  },
  {
    version: "v0.9.23",
    date: "2026-08-27",
    changes: [
      "推送通知集成（Expo Push Token 注册 + 通知点击跳转）",
      "服务端新增 /api/devices/push-token 端点",
    ],
  },
  {
    version: "v0.9.22",
    date: "2026-08-26",
    changes: [
      "ChangelogPage 补全 v0.9.12~v0.9.21 + v0.9.4 缺失版本条目",
    ],
  },
  {
    version: "v0.9.21",
    date: "2026-08-26",
    changes: [
      "更新日志页面修复：现在可正确显示服务器最新版本说明",
    ],
  },
  {
    version: "v0.9.20",
    date: "2026-08-26",
    changes: [
      "GlassCard 三层玻璃封装（iOS原生液态玻璃/Android真实模糊/纯View降级）",
      "消息入场弹簧动画（FadeInDown + damping:20）",
    ],
  },
  {
    version: "v0.9.19",
    date: "2026-08-26",
    changes: [
      "消息气泡左滑引用回复/右滑转发（微信级手势交互）",
      "滑动阈值15px防误触，回弹弹簧damping:20 stiffness:300",
    ],
  },
  {
    version: "v0.9.18",
    date: "2026-08-26",
    changes: [
      "agent气泡暗色模式可读性修复（双套色板按主题切换）",
      "AI助手回复辨识度提升（微透明背景+渐变边框）",
    ],
  },
  {
    version: "v0.9.17",
    date: "2026-08-26",
    changes: [
      "设备互联配对功能：6位码配对 + 已配对列表 + 解绑",
      "设置页「设备互联」入口",
    ],
  },
  {
    version: "v0.9.16",
    date: "2026-08-26",
    changes: [
      "消息可靠性升级：按 seq 排序、MessageID 幂等、status 状态渲染",
      "消息已送达显示、已编辑标记、消息编辑入口（长按）",
      "chat.edited 事件监听实时更新",
    ],
  },
  {
    version: "v0.9.15",
    date: "2026-08-25",
    changes: ["APK 签名修复（v0.9.14 补签方案升级为 gradle 原生签名整包重出）"],
  },
  {
    version: "v0.9.14",
    date: "2026-08-25",
    changes: [
      "主题切换修复：StyleSheet.create 模块级烘焙样式全量换肤",
      "聊天白屏修复：libsignal curveasm.js TextDecoder utf-16le 兼容补丁",
      "curveasm 补丁固化为 patch-package",
    ],
  },
  {
    version: "v0.9.13",
    date: "2026-08-24",
    changes: ["「功能」Tab 入口（用户插件管理主门面）"],
  },
  {
    version: "v0.9.12",
    date: "2026-08-24",
    changes: [
      "主题快照缓存修复（useSyncExternalStore 无限重渲染）",
      "登录接口跳过旧 token 修复",
    ],
  },
  {
    version: "v0.9.11",
    date: "2026-08-23",
    changes: [
      "插件卡片渲染接入（U1）：投票卡片可点击选项即时计票，票数条实时显示",
      "五种卡片模板（投票/列表/统计/进度/图文）+ 未知类型折叠框降级，永不白屏",
      "同步桌面端插件化基座（R0-R4 + 卡片协议 v1 定稿）",
    ],
  },
  {
    version: "v0.9.10",
    date: "2026-08-23",
    changes: [
      "动态主题：新增「外观」设置（跟随系统/浅色/深色），全 App 支持暗色模式",
      "状态栏与导航栏配色随主题自动切换，系统深色模式实时跟随",
      "运行详情/任务页硬编码色值清理，统一引设计 token（双端同源）",
      "液态玻璃组件明暗自适应，修复 shared 协议悬空引用",
    ],
  },
  {
    version: "v0.9.8",
    date: "2026-08-22",
    changes: [
      "断线重连消息补拉改为服务端裁剪，弱网下更快更省流量",
    ],
  },
  {
    version: "v0.9.7",
    date: "2026-08-22",
    changes: [
      "私聊端到端加密（Beta）：1:1 文字消息 X3DH+双棘轮加密，服务器仅见密文",
      "私钥存 Android Keystore 硬件加密，永不上传",
      "双方都升级后才启用加密（灰度共存），解密失败显示占位不崩溃",
    ],
  },
  {
    version: "v0.9.6",
    date: "2026-08-22",
    changes: [
      "断线重连后自动补拉：任务事件按 jobId 精确回填，运行/看板状态不再停留旧值",
      "聊天消息按服务端 seq 增量同步，重连不丢消息、不错序",
      "消息发送携带幂等 ID，弱网重试不再产生重复消息",
    ],
  },
  {
    version: "v0.9.5",
    date: "2026-08-22",
    changes: [
      "通话新增免提/听筒切换，接通自动管理音频路由与距离感应灭屏",
      "显式开启回声消除/降噪，改善回声与底噪",
      "视频接听时摄像头被拒自动改为语音接听，不再报错",
      "通话中显示计时；外呼超时不再误标「未接来电」",
      "通话界面重做：适配刘海屏、按钮层级清晰、画中画避让顶栏",
    ],
  },
  {
    version: "v0.9.4",
    date: "2026-08-22",
    changes: [
      "新增视频通话：扩展栏「视频通话」发起，远端全屏 + 本地画中画",
      "通话中支持静音 / 开关摄像头 / 前后摄像头翻转",
      "语音通话新增静音按钮",
      "摄像头不可用时自动降级为语音通话",
      "修复 AI 助手接口调用方式与设置页图标名",
    ],
  },
  {
    version: "v0.8.21",
    date: "2026-08-17",
    changes: [
      "联系人页智能体分组：进入页面自动加载 Agent 数据",
      "智能体点击进入详情页（查看/编辑/删除）",
    ],
  },
  {
    version: "v0.8.20",
    date: "2026-08-17",
    changes: [
      "联系人页新增智能体分类",
      "Agent 详情页支持编辑名称、描述、模型、系统提示词",
    ],
  },
  {
    version: "v0.8.19",
    date: "2026-08-17",
    changes: [
      "看板统计卡去掉阴影和半透明背景，消除白色长方形",
    ],
  },
  {
    version: "v0.8.18",
    date: "2026-08-17",
    changes: [
      "任务页删除「任务列表」字样",
      "看板统计卡去掉 elevation 阴影",
    ],
  },
  {
    version: "v0.8.17",
    date: "2026-08-17",
    changes: [
      "删除所有分隔线，改用微弱色差区分层级",
      "页面底纯白，卡片极淡暖白 #FAF9F7",
    ],
  },
  {
    version: "v0.8.16",
    date: "2026-08-17",
    changes: [
      "修复任务页删除文字、联系人智能体、分隔线三个未生效的改动",
    ],
  },
  {
    version: "v0.8.15",
    date: "2026-08-17",
    changes: [
      "看板页删除服务器信息区域",
      "联系人页新增智能体分类",
      "「我」页面添加更新日志",
      "分隔线从纯黑改为玄泉 #3B3F4A",
    ],
  },
  {
    version: "v0.8.14",
    date: "2026-08-17",
    changes: [
      "Swiss Modernism 设计系统：大面积留白 + 纯黑文字 + 玄泉品牌 + 暖琥珀 CTA",
    ],
  },
  {
    version: "v0.8.13",
    date: "2026-08-17",
    changes: [
      "文字对比度全部 >= 4.5:1，小字清晰可读",
    ],
  },
  {
    version: "v0.8.12",
    date: "2026-08-17",
    changes: [
      "暖琥珀 #C4933F 做 CTA 点缀，解决纯中性色无视觉焦点",
    ],
  },
  {
    version: "v0.8.11",
    date: "2026-08-17",
    changes: [
      "纯色版：零混色，六色直接用",
    ],
  },
  {
    version: "v0.8.10",
    date: "2026-08-17",
    changes: [
      "胶囊 Dock 拖动切换页面",
      "丝滑弹簧动画（damping:18）",
      "白色图标，选中态纯白",
    ],
  },
  {
    version: "v0.8.9",
    date: "2026-08-17",
    changes: [
      "GlassTabBar 正式接入 Tab.Navigator",
    ],
  },
  {
    version: "v0.8.8",
    date: "2026-08-17",
    changes: [
      "胶囊形液态玻璃 Dock：自定义 Tab 按钮 + 玄泉柔影",
    ],
  },
  {
    version: "v0.8.7",
    date: "2026-08-17",
    changes: [
      "修复 BlurView overflow:hidden 导致模糊消失",
      "LiquidGlass 显式高度",
    ],
  },
  {
    version: "v0.8.6",
    date: "2026-08-17",
    changes: [
      "expo-blur BlurView 真背景模糊，替代 Skia BackdropFilter",
    ],
  },
  {
    version: "v0.8.5",
    date: "2026-08-17",
    changes: [
      "精修陶瓷配色：纯白底 + 墨/黑文字 + 玄泉主色",
    ],
  },
  {
    version: "v0.8.4",
    date: "2026-08-17",
    changes: [
      "真液态玻璃：react-native-skia BackdropFilter GPU 实现",
    ],
  },
  {
    version: "v0.8.3",
    date: "2026-08-17",
    changes: [
      "内部版本号改为运行时读取原生版本",
      "正式 release keystore 签名",
    ],
  },
  {
    version: "v0.8.2",
    date: "2026-08-16",
    changes: [
      "玄墨瓷雅六色设计系统：玄泉主色 + 淡黏土暖层次",
      "WCAG 对比度验证",
    ],
  },
  {
    version: "v0.8.1",
    date: "2026-08-16",
    changes: [
      "移动端 UI 重做启动",
      "液态玻璃组件 + 悬浮 Tab Dock",
    ],
  },
  {
    version: "v0.8.0",
    date: "2026-08-16",
    changes: [
      "全新 UI 重做：墨土液态墨韵设计方向",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <ScrollView style={styles.container}>
      {changelogData.map((entry, idx) => (
        <View key={idx} style={styles.entry}>
          <View style={styles.entryHeader}>
            <Text style={styles.version}>{entry.version}</Text>
            <Text style={styles.date}>{entry.date}</Text>
          </View>
          {entry.changes.map((change, ci) => (
            <View key={ci} style={styles.changeRow}>
              <Text style={styles.bullet}>·</Text>
              <Text style={styles.changeText}>{change}</Text>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = ms({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  entry: { marginBottom: spacing.xl },
  entryHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  version: { color: colors.text, fontSize: fontSize.lg, fontWeight: "700" },
  date: { color: colors.textMuted, fontSize: fontSize.sm },
  changeRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.xs },
  bullet: { color: colors.textMuted, marginRight: spacing.sm, marginTop: 2 },
  changeText: { color: colors.text, fontSize: fontSize.md, flex: 1, lineHeight: 22 },
});
