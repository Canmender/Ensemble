/**
 * 更新日志页
 * 完整版本历史记录
 */
import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { colors, spacing, radius, fontSize } from "../theme";

const changelogData = [
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  entry: { marginBottom: spacing.xl },
  entryHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  version: { color: colors.text, fontSize: fontSize.lg, fontWeight: "700" },
  date: { color: colors.textMuted, fontSize: fontSize.sm },
  changeRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.xs },
  bullet: { color: colors.textMuted, marginRight: spacing.sm, marginTop: 2 },
  changeText: { color: colors.text, fontSize: fontSize.md, flex: 1, lineHeight: 22 },
});
