/**
 * 「我」页（原设置页）
 * 顶部个人信息卡 + 二级页面入口（个人信息 / 通知设置 / 关于）+ 退出登录。
 * 连接状态以小条展示。启动自动连云端（见 App.tsx / connection.ts）。
 */

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useDeviceStore } from "../store/deviceStore";
import { CLOUD_SERVER } from "../services/connection";
import { api } from "../services/api";
import { checkAndPromptUpdate } from "../services/appUpdate";
import { Avatar } from "../components/Avatar";
import { useMeStore } from "../store/meStore";
import { useAuthGate } from "../store/authGateStore";
import { colors, spacing, radius, fontSize, elevation } from "../theme";

const APP_VERSION = "0.7.73";

export default function SettingsPage() {
  const navigation = useNavigation<any>();
  const { currentDevice, connectionState, lastError } = useDeviceStore();
  const setGate = useAuthGate((s) => s.setGate);

  const me = useMeStore((s) => s.me);
  const loadingMe = useMeStore((s) => s.loading);
  const reloadMe = useMeStore((s) => s.reload);

  // 页面获得焦点时刷新用户信息（改昵称/头像后返回立即生效）
  useFocusEffect(
    React.useCallback(() => {
      void reloadMe();
    }, [reloadMe]),
  );

  /** 登出：清 token + 回到登录页 */
  const handleLogout = async () => {
    await api.logout();
    useMeStore.setState({ me: null });
    Alert.alert("已退出", "已退出登录");
    setGate("out");
  };

  const statusColor =
    connectionState === "connected"
      ? "#10b981"
      : connectionState === "connecting" || connectionState === "reconnecting"
        ? "#f59e0b"
        : connectionState === "error"
          ? "#ef4444"
          : "#9ca3af";
  const statusText =
    connectionState === "connected"
      ? "已连接云端"
      : connectionState === "connecting"
        ? "连接中..."
        : connectionState === "reconnecting"
          ? "重连中..."
          : connectionState === "error"
            ? "连接错误"
            : "未连接";

  const menuItems = [
    {
      icon: "desktop-outline" as const,
      title: "我的电脑",
      desc: "连接中继，远程执行任务",
      onPress: () => navigation.navigate("DeviceRemote"),
    },
    {
      icon: "person-outline" as const,
      title: "个人信息",
      desc: "昵称、账号信息",
      onPress: () => navigation.navigate("Profile"),
    },
    {
      icon: "notifications-outline" as const,
      title: "通知设置",
      desc: "聊天消息通知开关",
      onPress: () => navigation.navigate("NotificationSettings"),
    },
    {
      icon: "shield-checkmark-outline" as const,
      title: "隐私设置",
      desc: "好友验证、私聊权限、信息展示",
      onPress: () => navigation.navigate("PrivacySettings"),
    },
    {
      icon: "refresh-outline" as const,
      title: "检查更新",
      desc: `当前 v${APP_VERSION}，检查新版本`,
      onPress: async () => {
        const hasUpdate = await checkAndPromptUpdate();
        if (!hasUpdate) {
          Alert.alert("已是最新版本", `当前版本 v${APP_VERSION}`);
        }
      },
    },
    {
      icon: "information-circle-outline" as const,
      title: "关于",
      desc: `合鸣 v${APP_VERSION}`,
      onPress: () => navigation.navigate("About"),
    },
  ];

  return (
    <ScrollView style={styles.container}>
      {/* 顶部个人信息卡 */}
      <TouchableOpacity style={styles.profileCard} onPress={() => navigation.navigate("Profile")} activeOpacity={0.7}>
        <View style={styles.avatar}>
          {loadingMe ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Avatar name={me?.displayName || me?.username || "?"} avatarUrl={me?.avatarUrl} size={56} />
          )}
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>{me ? me.displayName || me.username : "未登录"}</Text>
          <Text style={styles.profileSub}>{me ? `@${me.username}` : "请登录"}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </TouchableOpacity>

      {/* 连接状态 */}
      <View style={styles.statusBar}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <Text style={styles.statusText}>{statusText}</Text>
        <Text style={styles.serverInfo}>
          {CLOUD_SERVER.host}:{CLOUD_SERVER.port}
        </Text>
      </View>
      {lastError && <Text style={styles.errorText}>{lastError}</Text>}

      {/* 菜单（二级页面入口，可自定义扩充） */}
      <View style={styles.menu}>
        {menuItems.map((item) => (
          <TouchableOpacity key={item.title} style={styles.menuItem} onPress={item.onPress} activeOpacity={0.7}>
            <Ionicons name={item.icon} size={20} color={colors.primary} />
            <View style={styles.menuInfo}>
              <Text style={styles.menuTitle}>{item.title}</Text>
              <Text style={styles.menuDesc}>{item.desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </TouchableOpacity>
        ))}
      </View>

      {/* 本机信息 */}
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>设备名称</Text>
        <Text style={styles.infoValue}>{currentDevice?.name || "未知"}</Text>
      </View>

      {/* 退出登录 */}
      {me && (
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutButtonText}>退出登录</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...elevation.sm,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.primary, fontSize: 22, fontWeight: "700" },
  profileInfo: { flex: 1 },
  profileName: { color: colors.text, fontSize: fontSize.lg, fontWeight: "700" },
  profileSub: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: 2 },
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    ...elevation.sm,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: "600" },
  serverInfo: { color: colors.textFaint, fontSize: fontSize.xs, marginLeft: "auto" },
  errorText: { color: colors.danger, fontSize: fontSize.xs, marginHorizontal: spacing.lg, marginTop: 6 },
  menu: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...elevation.sm,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  menuInfo: { flex: 1 },
  menuTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: "500" },
  menuDesc: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 1 },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  infoLabel: { color: colors.textMuted, fontSize: fontSize.sm },
  infoValue: { color: colors.text, fontSize: fontSize.sm },
  logoutButton: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  logoutButtonText: { color: colors.danger, fontSize: fontSize.md, fontWeight: "600" },
});
