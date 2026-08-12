/**
 * 登录页（应用门禁）
 * 未登录时打开应用进入此页；登录/注册成功后进入主界面。
 * 连接：应用启动时已自动连接云端服务器（connectionService.connectToCloud）。
 */

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../services/api";
import { connectionService, CLOUD_SERVER } from "../services/connection";
import { useAuthGate } from "../store/authGateStore";
import { useDeviceStore } from "../store/deviceStore";
import { colors, spacing, radius, fontSize } from "../theme";

export default function LoginPage() {
  const setGate = useAuthGate((s) => s.setGate);
  const connectionState = useDeviceStore((s) => s.connectionState);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const connected = connectionState === "connected";

  const submit = async () => {
    if (!username.trim() || password.length < 6) {
      setError("请输入用户名，密码至少 6 位");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res =
        mode === "login"
          ? await api.login(username.trim(), password)
          : await api.register(username.trim(), password, displayName.trim() || undefined);
      if (res.data?.token) {
        // 用用户 token 重新建立 WS 连接（实时推送）
        await connectionService.connectToCloud();
        setGate("in");
      } else {
        setError(res.error ?? "操作失败");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Logo / 品牌 */}
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Ionicons name="flash" size={34} color="#fff" />
          </View>
          <Text style={styles.appName}>合鸣 Ensemble</Text>
          <Text style={styles.tagline}>多 Agent 协作平台 · 云端服务器</Text>
        </View>

        {/* 服务器状态 */}
        <View style={styles.serverBadge}>
          <View style={[styles.dot, { backgroundColor: connected ? colors.success : colors.warning }]} />
          <Text style={styles.serverText}>
            {connected ? `已连接 ${CLOUD_SERVER.host}:${CLOUD_SERVER.port}` : "未连接服务器，点击重试"}
          </Text>
          {!connected && (
            <TouchableOpacity
              onPress={async () => {
                setRetrying(true);
                await connectionService.connectToCloud();
                setRetrying(false);
              }}
              disabled={retrying}
              style={styles.retryBtn}
            >
              {retrying ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={styles.retryText}>重连</Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* 登录 / 注册切换 */}
        <View style={styles.modeRow}>
          {(["login", "register"] as const).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
              onPress={() => setMode(m)}
            >
              <Text style={[styles.modeBtnText, mode === m && styles.modeBtnTextActive]}>
                {m === "login" ? "登录" : "注册"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="用户名"
            placeholderTextColor={colors.textFaint}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {mode === "register" && (
            <TextInput
              style={styles.input}
              placeholder="昵称（可选）"
              placeholderTextColor={colors.textFaint}
              value={displayName}
              onChangeText={setDisplayName}
            />
          )}
          <TextInput
            style={styles.input}
            placeholder="密码（至少 6 位）"
            placeholderTextColor={colors.textFaint}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.disabled]}
            onPress={submit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitText}>{mode === "login" ? "登录" : "注册并登录"}</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.hint}>
            登录后可进行用户-用户实时聊天、任务联动
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, justifyContent: "center", padding: spacing.xl },
  brand: { alignItems: "center", marginBottom: spacing.xl },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  appName: { color: colors.text, fontSize: 24, fontWeight: "700" },
  tagline: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: 4 },
  serverBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginBottom: spacing.lg,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  serverText: { color: colors.textMuted, fontSize: fontSize.xs },
  retryBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  retryText: { color: colors.primary, fontSize: fontSize.xs, fontWeight: "600" },
  modeRow: { flexDirection: "row", marginBottom: spacing.lg },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    alignItems: "center",
    backgroundColor: colors.surface,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  modeBtnText: { color: colors.textMuted, fontSize: fontSize.md, fontWeight: "600" },
  modeBtnTextActive: { color: "#fff" },
  form: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: 14,
    color: colors.text,
    marginBottom: spacing.md,
    fontSize: fontSize.md,
  },
  error: { color: colors.danger, fontSize: fontSize.sm, marginBottom: spacing.md },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: 14,
    alignItems: "center",
  },
  disabled: { opacity: 0.6 },
  submitText: { color: "#fff", fontSize: fontSize.md, fontWeight: "600" },
  hint: { color: colors.textFaint, fontSize: fontSize.xs, textAlign: "center", marginTop: spacing.md },
});
