/**
 * 共享导航栏组件：左上角头像+昵称，标题居中
 * 参考 box-im/V-IM 的导航栏设计。
 */
import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "./Avatar";
import { api, type UserInfo } from "../services/api";
import { colors, spacing, fontSize } from "../theme";

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
  const [me, setMe] = useState<UserInfo | null>(null);
  const topPad = includeTopInset ? insets.top : 0;

  useEffect(() => {
    if (showAvatar) {
      void api.getMe().then((r) => {
        if (r.data) setMe(r.data);
      });
    }
  }, [showAvatar]);

  return (
    <View style={[styles.header, { paddingTop: topPad, height: 52 + topPad }]}>
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
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 52,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
    fontWeight: "600",
    color: colors.text,
  },
  backBtn: {
    padding: 4,
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
