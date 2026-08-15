/**
 * 应用内更新弹窗：检测到新版本时显示，支持下载进度 + 调起系统安装器
 * 挂在 App 根部，由 updateStore 驱动（checkAndPromptUpdate 触发）
 */
import React, { useState } from "react";
import { View, Text, Modal, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useUpdateStore } from "../store/updateStore";
import { downloadAndInstall } from "../services/appUpdate";
import { colors, spacing, radius, fontSize } from "../theme";

export function UpdateManager() {
  const { updateInfo, downloading, progress, setDownloading, setProgress, reset } = useUpdateStore();
  const [error, setError] = useState<string | null>(null);

  const handleUpdate = async () => {
    if (!updateInfo) return;
    setError(null);
    setDownloading(true);
    try {
      await downloadAndInstall(updateInfo, setProgress);
      // 系统安装器已调起，关闭弹窗
      reset();
      Alert.alert("安装包已就绪", "请在系统安装器中完成安装");
    } catch (e) {
      setError(e instanceof Error ? e.message : "下载失败");
    } finally {
      setDownloading(false);
    }
  };

  const pct = Math.min(100, Math.round(progress * 100));

  return (
    <Modal transparent visible={!!updateInfo} animationType="fade" onRequestClose={() => !downloading && reset()}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="cloud-download-outline" size={30} color={colors.primary} />
          </View>
          <Text style={styles.title}>发现新版本 v{updateInfo?.version}</Text>
          {updateInfo?.note ? <Text style={styles.note}>{updateInfo.note}</Text> : null}

          {downloading ? (
            <View style={styles.progressWrap}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${pct}%` }]} />
              </View>
              <Text style={styles.progressText}>{pct}%</Text>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            {!updateInfo?.force && (
              <TouchableOpacity style={styles.cancelBtn} onPress={reset} disabled={downloading}>
                <Text style={styles.cancelText}>{downloading ? "下载中…" : "暂不更新"}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.updateBtn, (downloading || !!updateInfo?.force) && styles.updateBtnFull]}
              onPress={handleUpdate}
              disabled={downloading}
              activeOpacity={0.8}
            >
              {downloading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.updateText}>{updateInfo?.force ? "立即更新（强制）" : "立即更新"}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  card: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: "700", textAlign: "center" },
  note: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: "center", marginTop: spacing.sm },
  progressWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, width: "100%", marginTop: spacing.lg },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  progressFill: { height: 6, backgroundColor: colors.primary, borderRadius: 3 },
  progressText: { color: colors.textMuted, fontSize: fontSize.xs, minWidth: 34, textAlign: "right" },
  error: { color: colors.danger, fontSize: fontSize.sm, marginTop: spacing.md, textAlign: "center" },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg, width: "100%" },
  cancelBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
  },
  cancelText: { color: colors.textMuted, fontSize: fontSize.md },
  updateBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
  },
  updateBtnFull: { flex: 1 },
  updateText: { color: "#fff", fontSize: fontSize.md, fontWeight: "600" },
});
