/**
 * 关于（二级页）
 * 版本、服务器地址、产品说明。
 */

import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { colors, spacing, radius, fontSize } from "../theme";
import { CLOUD_SERVER } from "../services/connection";
import { nativeApplicationVersion } from "expo-application";

const APP_VERSION = nativeApplicationVersion ?? "0.8.27";

export default function AboutPage() {
  return (
    <View style={styles.container}>
      <Image source={require("../../assets/icon.png")} style={styles.logo} resizeMode="contain" />
      <Text style={styles.name}>合鸣（Ensemble）</Text>
      <Text style={styles.version}>v{APP_VERSION}</Text>
      <Text style={styles.desc}>
        多 Agent 协作平台。手机端直连自用云端服务器，支持账号登录、用户-用户实时聊天、图片
        / 文件发送、撤回 / 引用 / 转发、消息通知。
      </Text>
      <View style={styles.row}>
        <Text style={styles.label}>服务器</Text>
        <Text style={styles.value}>
          {CLOUD_SERVER.host}:{CLOUD_SERVER.port}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  logo: {
    alignSelf: "center",
    width: 80,
    height: 80,
    borderRadius: 22,
    overflow: "hidden",
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  name: { textAlign: "center", color: colors.text, fontSize: 20, fontWeight: "700" },
  version: { textAlign: "center", color: colors.textFaint, fontSize: fontSize.sm, marginTop: 4 },
  desc: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    lineHeight: 20,
    textAlign: "center",
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  label: { color: colors.textMuted, fontSize: fontSize.sm },
  value: { color: colors.text, fontSize: fontSize.sm },
});
