/**
 * 通话全屏弹层：响铃（呼入/呼叫中）/ 通话中 / 结束
 * 由 callStore 驱动；接听/拒接/挂断调用 callService。
 * 视频通话：远端画面全屏、本端画中画；语音通话保持头像式布局。
 */
import React from "react";
import { View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { RTCView } from "react-native-webrtc";
import { useCallStore } from "../store/callStore";
import { acceptCall, rejectCall, hangup, toggleMic, toggleCam, switchCamera } from "../services/callService";
import { Avatar } from "./Avatar";
import { colors, spacing, radius, fontSize } from "../theme";

/** 安全取流地址（流释放后 toURL 可能抛错） */
function streamUrl(stream: ReturnType<typeof Object> | null): string | null {
  try {
    return (stream as { toURL?: () => string } | null)?.toURL?.() ?? null;
  } catch {
    return null;
  }
}

export function CallModal() {
  const { phase, direction, peer, reason, video, micOn, camOn, localStream, remoteStream } = useCallStore();
  const visible = phase !== "idle";
  if (!visible) return null;

  const name = peer?.name || peer?.userId || "对方";
  const isIncoming = direction === "incoming";
  const showRingBtns = phase === "ringing" && isIncoming;
  /** 视频舞台：视频通话已进入连接/通话阶段 */
  const videoStage = video && (phase === "connecting" || phase === "in-call");
  const remoteUrl = streamUrl(remoteStream);
  const localUrl = streamUrl(localStream);
  const hasRemoteVideo = !!remoteUrl && !!remoteStream && remoteStream.getVideoTracks().length > 0;

  let title = "语音通话";
  let subtitle = "";
  switch (phase) {
    case "calling": title = video ? "正在呼叫…" : "正在呼叫…"; subtitle = video ? "邀请对方视频通话" : "等待对方接听"; break;
    case "ringing": title = isIncoming ? "来电" : "正在呼叫…"; subtitle = isIncoming ? (video ? "邀请你视频通话" : "") : (video ? "等待对方接受视频邀请" : "等待对方接听"); break;
    case "connecting": title = "正在连接…"; subtitle = video ? "建立视频通道" : "建立音频通道"; break;
    case "in-call": title = "通话中"; subtitle = video ? "视频通话已接通" : "语音通话已接通"; break;
    case "ended": title = "通话结束"; subtitle = reason || ""; break;
    case "rejected": title = "已取消"; subtitle = reason || ""; break;
    case "missed": title = "未接来电"; subtitle = reason || ""; break;
  }

  const endOrClose =
    phase === "in-call" || phase === "connecting" || phase === "calling" || phase === "ringing" ? (
      <TouchableOpacity style={[styles.btn, styles.rejectBtn, styles.endBtn]} onPress={hangup} activeOpacity={0.8}>
        <Ionicons name="call" size={30} color="#fff" />
        <Text style={styles.btnLabel}>挂断</Text>
      </TouchableOpacity>
    ) : (
      <TouchableOpacity style={[styles.btn, styles.closeBtn]} onPress={() => useCallStore.getState().reset()} activeOpacity={0.8}>
        <Ionicons name="close" size={30} color="#fff" />
        <Text style={styles.btnLabel}>关闭</Text>
      </TouchableOpacity>
    );

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={() => { if (phase === "in-call") hangup(); else if (phase === "ringing" && isIncoming) rejectCall(); else hangup(); }}>
      <View style={styles.overlay}>
        {/* 视频层：远端全屏 + 本端画中画 */}
        {videoStage && (
          <>
            {hasRemoteVideo ? (
              <RTCView streamURL={remoteUrl!} style={StyleSheet.absoluteFill} objectFit="cover" />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: "#10131a" }]}>
                {phase === "in-call" && <Text style={styles.noSignalHint}>对方画面未开启</Text>}
              </View>
            )}
            {/* 本端画中画（关摄像头时显示头像占位） */}
            <View style={styles.pip}>
              {localUrl && camOn && !!localStream && localStream.getVideoTracks().length > 0 ? (
                <RTCView streamURL={localUrl!} style={styles.pipVideo} objectFit="cover" mirror />
              ) : (
                <View style={styles.pipOff}>
                  <Avatar name={name} size={40} />
                  <Text style={styles.pipOffText}>摄像头已关闭</Text>
                </View>
              )}
            </View>
            {/* 顶部信息条 */}
            <View style={styles.topBar}>
              <Text style={styles.topName}>{name}</Text>
              <View style={styles.topStatusRow}>
                {phase === "connecting" && <ActivityIndicator size="small" color="#fff" />}
                <Text style={styles.topStatus}>{subtitle}</Text>
              </View>
            </View>
          </>
        )}

        {/* 语音布局：头像居中（视频模式下作为响铃/结束态的底层） */}
        {!videoStage && (
          <>
            <View style={styles.avatarBox}>
              <Avatar name={name} size={104} />
            </View>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>

            {(phase === "in-call" || phase === "calling" || phase === "ringing" || phase === "connecting") && (
              <View style={styles.statusRow}>
                <Ionicons name="volume-high" size={18} color={colors.textMuted} />
                <Text style={styles.status}>{video ? "视频" : "语音"}</Text>
              </View>
            )}
          </>
        )}

        <View style={[styles.actions, videoStage && styles.actionsOverlay]}>
          {showRingBtns ? (
            <>
              <TouchableOpacity style={[styles.btn, styles.rejectBtn]} onPress={rejectCall} activeOpacity={0.8}>
                <Ionicons name="close" size={30} color="#fff" />
                <Text style={styles.btnLabel}>拒接</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.acceptBtn]} onPress={() => void acceptCall()} activeOpacity={0.8}>
                <Ionicons name="call" size={30} color="#fff" />
                <Text style={styles.btnLabel}>{video ? "接听(视频)" : "接听"}</Text>
              </TouchableOpacity>
            </>
          ) : videoStage && phase === "in-call" ? (
            <>
              <TouchableOpacity style={[styles.ctrlBtn, !micOn && styles.ctrlBtnOff]} onPress={toggleMic} activeOpacity={0.8}>
                <Ionicons name={micOn ? "mic" : "mic-off"} size={24} color="#fff" />
                <Text style={styles.btnLabel}>{micOn ? "静音" : "已静音"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.ctrlBtn, !camOn && styles.ctrlBtnOff]} onPress={toggleCam} activeOpacity={0.8}>
                <Ionicons name={camOn ? "videocam" : "videocam-off"} size={24} color="#fff" />
                <Text style={styles.btnLabel}>{camOn ? "关摄像头" : "开摄像头"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ctrlBtn} onPress={switchCamera} activeOpacity={0.8}>
                <Ionicons name="camera-reverse-outline" size={24} color="#fff" />
                <Text style={styles.btnLabel}>翻转</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.ctrlBtn, styles.rejectBtn]} onPress={hangup} activeOpacity={0.8}>
                <Ionicons name="call" size={24} color="#fff" />
                <Text style={styles.btnLabel}>挂断</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {(phase === "in-call" || phase === "connecting") && (
                <TouchableOpacity style={[styles.ctrlBtn, !micOn && styles.ctrlBtnOff]} onPress={toggleMic} activeOpacity={0.8}>
                  <Ionicons name={micOn ? "mic" : "mic-off"} size={24} color="#fff" />
                  <Text style={styles.btnLabel}>{micOn ? "静音" : "已静音"}</Text>
                </TouchableOpacity>
              )}
              {endOrClose}
            </>
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
  /* 视频模式 */
  actionsOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 36,
    justifyContent: "center",
    gap: spacing.lg,
  },
  ctrlBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    paddingHorizontal: 4,
  },
  ctrlBtnOff: { backgroundColor: "rgba(255,255,255,0.06)" },
  pip: {
    position: "absolute",
    top: 64,
    right: spacing.lg,
    width: 108,
    height: 156,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: "#1a1e27",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  pipVideo: { flex: 1 },
  pipOff: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  pipOffText: { color: "rgba(255,255,255,0.7)", fontSize: 10 },
  topBar: { position: "absolute", top: 56, left: spacing.xl, right: 140, alignItems: "flex-start" },
  topName: { color: "#fff", fontSize: fontSize.xl, fontWeight: "700" },
  topStatusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  topStatus: { color: "rgba(255,255,255,0.75)", fontSize: fontSize.md },
  noSignalHint: { color: "rgba(255,255,255,0.5)", fontSize: fontSize.sm, textAlign: "center", marginTop: 220 },
});
