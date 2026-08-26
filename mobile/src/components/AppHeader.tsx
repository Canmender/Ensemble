/**
 * 共享导航栏组件：左上角头像+昵称，标题居中
 * 参考 box-im/V-IM 的导航栏设计。
 */
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform, StatusBar } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "./Avatar";
import { useMeStore } from "../store/meStore";
import { colors, spacing, radius, fontSize, elevation , ms } from "../theme";

interface AppHeaderProps {
  title: string;
  showBack?: boolean;
  showAvatar?: boolean;
  right?: React.ReactNode;
  /** 是否自行加上部安全区 padding。native-stack 自定义 header 不会自动 inset，需为 true；tab 走 elements Header 已 inset，传 false */
  includeTopInset?: boolean;
}

export function AppHeader({ title, showBack = false, showAvatar = true, right, includeTopInset = true }: AppHeaderProps) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const me = useMeStore((s) => s.me);
  const reloadMe = useMeStore((s) => s.reload);
  // 部分设备 safe-area-context 的 insets.top 与 StatusBar.currentHeight 都返回 0，
  // 加 24dp 下限保证内容始终在状态栏/摄像头下方
  const androidMin = Platform.OS === "android" ? 24 : 0;
  const sbH = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;
  // tab 走 elements Header 的 headerStatusBarHeight spacer（App.tsx 设置），此处为 0 不重复加
  const topPad = includeTopInset ? Math.max(insets.top, sbH, androidMin) : 0;

  // 页面获得焦点时刷新用户信息（昵称/头像更新后立即生效）
  useFocusEffect(
    React.useCallback(() => {
      if (showAvatar) void reloadMe();
    }, [showAvatar, reloadMe]),
  );

  return (
    <View style={[styles.header, { paddingTop: topPad, height: 52 + topPad }]}>
      <View style={styles.headerRow}>
      {/* 左侧：返回按钮 或 头像+昵称 */}
      <View style={styles.left}>
        {showBack ? (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={10}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
        ) : showAvatar && me ? (
          <View style={styles.avatarRow}>
            <Avatar name={me.displayName || me.username || "?"} avatarUrl={me.avatarUrl} size={32} />
            <Text style={styles.nickname} numberOfLines={1}>
              {me.displayName || me.username}
            </Text>
          </View>
        ) : (
          <View style={styles.placeholder} />
        )}
      </View>

      {/* 中间：标题 */}
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>

      {/* 右侧：自定义内容 */}
      <View style={styles.right}>
        {right || <View style={styles.placeholder} />}
      </View>
      </View>
    </View>
  );
}

const styles = ms({
  header: {
    backgroundColor: colors.surface,
    ...elevation.sm,
    zIndex: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 52,
    paddingHorizontal: spacing.md,
  },
  left: {
    width: 120,
    flexDirection: "row",
    alignItems: "center",
  },
  right: {
    width: 120,
    alignItems: "flex-end",
  },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: fontSize.lg,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: 0.2,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  nickname: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: "500",
    maxWidth: 80,
  },
  placeholder: {
    width: 24,
  },
});
