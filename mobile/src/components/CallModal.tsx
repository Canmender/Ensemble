/**
 * 通话全屏弹层：响铃（呼入/呼叫中）/ 通话中 / 结束
 * 由 callStore 驱动；接听/拒接/挂断调用 callService。
 */
import React from "react";
import { View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCallStore } from "../store/callStore";
import { acceptCall, rejectCall, hangup } from "../services/callService";
import { Avatar } from "./Avatar";
import { colors, spacing, radius, fontSize } from "../theme";

export function CallModal() {
  const { phase, direction, peer, reason } = useCallStore();
  const visible = phase !== "idle";
  if (!visible) return null;

  const name = peer?.name || peer?.userId || "对方";
  const isIncoming = direction === "incoming";

  let title = "语音通话";
  let subtitle = "";
  switch (phase) {
    case "calling": title = "正在呼叫…"; subtitle = "等待对方接听"; break;
    case "ringing": title = isIncoming ? "来电" : "正在呼叫…"; subtitle = isIncoming ? "" : "等待对方接听"; break;
    case "connecting": title = "正在连接…"; subtitle = "建立音频通道"; break;
    case "in-call": title = "通话中"; subtitle = "语音通话已接通"; break;
    case "ended": title = "通话结束"; subtitle = reason || ""; break;
    case "rejected": title = "已取消"; subtitle = reason || ""; break;
    case "missed": title = "未接来电"; subtitle = reason || ""; break;
  }

  const showRingBtns = phase === "ringing" && isIncoming;
  const showEnd = phase === "in-call" || phase === "connecting" ? false : false; // end always when not idle

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={() => { if (phase === "in-call") hangup(); else if (phase === "ringing" && isIncoming) rejectCall(); else hangup(); }}>
      <View style={styles.overlay}>
        <View style={styles.avatarBox}>
          <Avatar name={name} size={104} />
        </View>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        {/* 通话中/呼叫中：计时 + 音频图标 */}
        {(phase === "in-call" || phase === "calling" || phase === "ringing" || phase === "connecting") && (
          <View style={styles.statusRow}>
            <Ionicons name="volume-high" size={18} color={colors.textMuted} />
            <Text style={styles.status}>语音</Text>
          </View>
        )}

        <View style={styles.actions}>
          {showRingBtns ? (
            <>
              <TouchableOpacity style={[styles.btn, styles.rejectBtn]} onPress={rejectCall} activeOpacity={0.8}>
                <Ionicons name="close" size={30} color="#fff" />
                <Text style={styles.btnLabel}>拒接</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.acceptBtn]} onPress={() => void acceptCall()} activeOpacity={0.8}>
                <Ionicons name="call" size={30} color="#fff" />
                <Text style={styles.btnLabel}>接听</Text>
              </TouchableOpacity>
            </>
          ) : phase === "in-call" || phase === "connecting" ? (
            <TouchableOpacity style={[styles.btn, styles.rejectBtn, styles.endBtn]} onPress={hangup} activeOpacity={0.8}>
              <Ionicons name="call" size={30} color="#fff" />
              <Text style={styles.btnLabel}>挂断</Text>
            </TouchableOpacity>
          ) : phase === "calling" || phase === "ringing" ? (
            <TouchableOpacity style={[styles.btn, styles.rejectBtn, styles.endBtn]} onPress={hangup} activeOpacity={0.8}>
              <Ionicons name="call" size={30} color="#fff" />
              <Text style={styles.btnLabel}>挂断</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.btn, styles.closeBtn]} onPress={() => useCallStore.getState().reset()} activeOpacity={0.8}>
              <Ionicons name="close" size={30} color="#fff" />
              <Text style={styles.btnLabel}>关闭</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15,18,25,0.96)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  avatarBox: { marginBottom: spacing.lg },
  name: { color: "#fff", fontSize: fontSize.xl, fontWeight: "700", marginBottom: spacing.sm },
  subtitle: { color: colors.textMuted, fontSize: fontSize.md, marginBottom: spacing.xl },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.xxl },
  status: { color: colors.textMuted, fontSize: fontSize.sm },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.xl },
  btn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  btnLabel: { color: "#fff", fontSize: fontSize.xs, marginTop: 4, fontWeight: "600" },
  rejectBtn: { backgroundColor: colors.danger },
  acceptBtn: { backgroundColor: colors.success },
  endBtn: {},
  closeBtn: { backgroundColor: "rgba(255,255,255,0.15)" },
});
