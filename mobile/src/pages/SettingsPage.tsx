/**
 * Settings Page（简化版）
 * 账号登录/注册 + 连接状态 + 本机信息 + 版本。
 * 已移除手动连接模式：应用启动自动直连自用云端服务器（见 App.tsx / connection.ts）。
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useDeviceStore } from "../store/deviceStore";
import { connectionService, CLOUD_SERVER } from "../services/connection";
import { api, type UserInfo } from "../services/api";
import { useAuthGate } from "../store/authGateStore";
import { colors } from "../theme";

const APP_VERSION = "0.7.7";

export default function SettingsPage() {
  const { currentDevice, connectedDevice, connectionState, lastError } = useDeviceStore();
  const setGate = useAuthGate((s) => s.setGate);

  // 登录态（登录页门禁保证已登录；此处展示 + 退出）
  const [me, setMe] = useState<UserInfo | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);

  // 设置项
  const [autoConnect, setAutoConnect] = useState(true);
  const [notifications, setNotifications] = useState(true);

  // 启动时读取登录态（有 token 则拉取当前用户）
  const loadMe = useCallback(async () => {
    setLoadingMe(true);
    try {
      const res = await api.getMe();
      if (res.data) setMe(res.data);
      else setMe(null);
    } catch {
      setMe(null);
    } finally {
      setLoadingMe(false);
    }
  }, []);

  useEffect(() => {
    void loadMe();
    // 连接成功后重新检查登录态
    if (connectionState === "connected") void loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionState]);

  /** 登出：清 token + 回到登录页 */
  const handleLogout = async () => {
    await api.logout();
    setMe(null);
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
      ? "已连接云端服务器"
      : connectionState === "connecting"
        ? "连接中..."
        : connectionState === "reconnecting"
          ? "重连中..."
          : connectionState === "error"
            ? "连接错误"
            : "未连接";

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      {/* 连接状态 */}
      <View style={styles.card}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={styles.statusText}>{statusText}</Text>
        </View>
        <Text style={styles.serverInfo}>
          {CLOUD_SERVER.host}:{CLOUD_SERVER.port}
        </Text>
        {connectedDevice && (
          <Text style={styles.mutedText}>设备 {connectedDevice.name}</Text>
        )}
        {lastError && <Text style={styles.errorText}>{lastError}</Text>}
      </View>

      {/* 账号 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>账号</Text>
        {loadingMe ? (
          <View style={styles.card}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : me ? (
          <View style={styles.card}>
            <View style={styles.userRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{me.displayName?.[0] || me.username[0]?.toUpperCase() || "?"}</Text>
              </View>
              <View style={styles.userInfo}>
                <Text style={styles.userName}>{me.displayName || me.username}</Text>
                <Text style={styles.mutedText}>@{me.username}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
              <Text style={styles.logoutButtonText}>退出登录</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.mutedText}>未登录，请返回登录页</Text>
            <TouchableOpacity style={styles.logoutButton} onPress={() => setGate("out")}>
              <Text style={styles.logoutButtonText}>去登录</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* 本机信息 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>本机信息</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>设备名称</Text>
          <Text style={styles.infoValue}>{currentDevice?.name || "未知"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>应用版本</Text>
          <Text style={styles.infoValue}>v{APP_VERSION}</Text>
        </View>
      </View>

      {/* 设置 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>设置</Text>
        <View style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>自动连接</Text>
            <Text style={styles.settingDescription}>启动时自动连接云端服务器</Text>
          </View>
          <Switch
            value={autoConnect}
            onValueChange={setAutoConnect}
            trackColor={{ false: "#d1d5db", true: "#10b981" }}
            thumbColor="#fff"
          />
        </View>
        <View style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>通知</Text>
            <Text style={styles.settingDescription}>接收任务状态更新通知</Text>
          </View>
          <Switch
            value={notifications}
            onValueChange={setNotifications}
            trackColor={{ false: "#d1d5db", true: "#10b981" }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* 关于 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>关于</Text>
        <Text style={styles.aboutText}>
          合鸣（Ensemble）多 Agent 协作平台。手机端直连自用云端服务器，支持账号登录、用户-用户实时聊天与任务联动。
        </Text>
        <Text style={styles.versionText}>版本 v{APP_VERSION}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 16,
  },
  statusRow: { flexDirection: "row", alignItems: "center" },
  statusDot: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  statusText: { color: colors.text, fontSize: 16, fontWeight: "500" },
  serverInfo: { color: colors.textMuted, fontSize: 13, marginTop: 8 },
  mutedText: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  errorText: { color: colors.danger, fontSize: 13, marginTop: 8 },
  section: { marginTop: 24, paddingHorizontal: 16 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "600", marginBottom: 12 },
  modeRow: { flexDirection: "row", marginBottom: 16 },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    marginHorizontal: 4,
  },
  modeBtnActive: { backgroundColor: colors.primary },
  modeBtnText: { color: colors.textMuted, fontSize: 14, fontWeight: "600" },
  modeBtnTextActive: { color: "#fff" },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    padding: 12,
    color: colors.text,
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginTop: 4,
  },
  primaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  buttonDisabled: { opacity: 0.6 },
  hintText: { color: colors.textFaint, fontSize: 12, marginTop: 10, textAlign: "center" },
  userRow: { flexDirection: "row", alignItems: "center" },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.primary, fontSize: 18, fontWeight: "700" },
  userInfo: { flex: 1, marginLeft: 12 },
  userName: { color: colors.text, fontSize: 16, fontWeight: "600" },
  logoutButton: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    marginTop: 16,
  },
  logoutButtonText: { color: colors.danger, fontSize: 15, fontWeight: "600" },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  infoLabel: { color: colors.textMuted, fontSize: 14 },
  infoValue: { color: colors.text, fontSize: 14 },
  settingItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 16,
    marginBottom: 8,
  },
  settingInfo: { flex: 1, marginRight: 16 },
  settingLabel: { color: colors.text, fontSize: 14, fontWeight: "500" },
  settingDescription: { color: colors.textFaint, fontSize: 12, marginTop: 2 },
  aboutText: { color: colors.text, fontSize: 14, lineHeight: 20, marginBottom: 8 },
  versionText: { color: colors.textFaint, fontSize: 12 },
});
