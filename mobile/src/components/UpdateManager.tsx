
/**
 * 应用内更新弹窗：检测到新版本时显示
 * - 下载中显示进度条（后台继续）
 * - 网络中断时显示「等待重连…」（已下载进度保留，重连自动续传）
 * - 支持强制更新 / 手动取消 / 安装权限引导
 */
import React, { useState } from "react";
import { View, Text, Modal, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useUpdateStore } from "../store/updateStore";
import { cancelDownload, downloadAndInstall, installReadyApk, openUnknownSourceSettings } from "../services/appUpdate";
import { colors, spacing, radius, fontSize , ms } from "../theme";

export function UpdateManager() {
  const { updateInfo, downloading, phase, downloaded, total, reset } = useUpdateStore();
  const [error, setError] = useState<string | null>(null);

  // 下载完成后自动关闭本弹窗（安装器已由后台接管调起）
  if (phase === "done") {
    setTimeout(() => reset(), 300);
  }

  const handleUpdate = async () => {
    setError(null);
    if (!updateInfo) return;
    if (phase === "downloading" || phase === "waiting_network") return;
    try {
      // 若上一次已下载完成但安装未拉起（error），直接重装已下载的包（不重复下载）
      if (error) {
        await installReadyApk(updateInfo);
      } else {
        await downloadAndInstall(updateInfo);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "下载失败");
    }
  };

  const handleCancel = () => {
    setError(null);
    void cancelDownload();
    reset();
  };

  const pct = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
  const isWaiting = phase === "waiting_network";
  const isActive = downloading || isWaiting;

  return (
    <Modal transparent visible={!!updateInfo} animationType="fade" onRequestClose={() => !isActive && (cancelDownload(), reset())}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="cloud-download-outline" size={30} color={colors.primary} />
          </View>
          <Text style={styles.title}>发现新版本 v{updateInfo?.version}</Text>
          {updateInfo?.note ? <Text style={styles.note}>{updateInfo.note}</Text> : null}

          {isWaiting ? (
            <View style={styles.waitWrap}>
              <ActivityIndicator size="small" color={colors.primary} />
              <View style={styles.waitTextWrap}>
                <Text style={styles.waitTitle}>网络中断，等待重连…</Text>
                {downloaded > 0 && total > 0 ? (
                  <Text style={styles.waitSub}>已下载 {pct}%，恢复连接后自动继续（进度已保留）</Text>
                ) : (
                  <Text style={styles.waitSub}>已下载 {downloaded > 0 ? Math.round(downloaded / 1024 / 1024 * 10) / 10 : 0} MB，恢复连接后自动继续</Text>
                )}
              </View>
            </View>
          ) : phase === "downloading" ? (
            <View style={styles.progressWrap}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${pct}%` }]} />
              </View>
              <Text style={styles.progressText}>{pct}%</Text>
              <Text style={styles.progressHint}>下载中，可切到后台继续…</Text>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {!isActive && (
            <TouchableOpacity
              style={styles.permissionHint}
              onPress={() => void openUnknownSourceSettings()}
              activeOpacity={0.7}
            >
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} />
              <Text style={styles.permissionHintText}>无法安装？点此开启「允许安装未知应用」</Text>
            </TouchableOpacity>
          )}

          <View style={styles.actions}>
            {!updateInfo?.force && (
              <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} disabled={false}>
                <Text style={styles.cancelText}>{isActive ? "取消下载" : "暂不更新"}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.updateBtn, (isActive || !!updateInfo?.force) && styles.updateBtnFull]}
              onPress={handleUpdate}
              disabled={isActive}
              activeOpacity={0.8}
            >
              {isActive ? (
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

const styles = ms({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  card: { width: "100%", maxWidth: 320, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, alignItems: "center" },
  iconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: "700", textAlign: "center" },
  note: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: "center", marginTop: spacing.sm },
  waitWrap: { flexDirection: "row", alignItems: "center", gap: spacing.md, width: "100%", marginTop: spacing.lg },
  waitTextWrap: { flex: 1 },
  waitTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: "600" },
  waitSub: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
  progressWrap: { width: "100%", marginTop: spacing.lg },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  progressFill: { height: 6, backgroundColor: colors.primary, borderRadius: 3 },
  progressText: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: "right", marginTop: 4 },
  progressHint: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: "center", marginTop: 6 },
  error: { color: colors.danger, fontSize: fontSize.sm, marginTop: spacing.md, textAlign: "center" },
  permissionHint: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: spacing.sm, paddingVertical: 4 },
  permissionHintText: { color: colors.primary, fontSize: fontSize.xs, fontWeight: "600" },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md, width: "100%" },
  cancelBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: "center" },
  cancelText: { color: colors.textMuted, fontSize: fontSize.md },
  updateBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center" },
  updateBtnFull: { flex: 1 },
  updateText: { color: "#fff", fontSize: fontSize.md, fontWeight: "600" },
});
