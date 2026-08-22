/**
 * 通话全屏弹层：响铃（呼入/呼叫中）/ 通话中 / 结束
 * 由 callStore 驱动；接听/拒接/挂断调用 callService。
 *
 * 布局（设计系统 theme.ts 令牌）：
 *   - 顶部安全区：对方名 + 状态/计时
 *   - 中部：语音=头像居中；视频=远端全屏 + 本端画中画（避让顶栏与刘海）
 *   - 底部安全区：控制按钮组（挂断为红色主行动，独立于控制行）
 */
import React from "react";
import { View, Text, Modal, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { RTCView } from "react-native-webrtc";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallStore } from "../store/callStore";
import { acceptCall, rejectCall, hangup, toggleMic, toggleCam, toggleSpeaker, switchCamera } from "../services/callService";
import { Avatar } from "./Avatar";
import { colors, spacing, radius, fontSize, elevation } from "../theme";

const DARK = "#14171E";
const ON_DARK_FAINT = "rgba(255,255,255,0.55)";
const CTRL_BG = "rgba(255,255,255,0.12)";
const CTRL_BG_OFF = "rgba(255,255,255,0.05)";

/** 安全取流地址（流释放后 toURL 可能抛错） */
function streamUrl(stream: unknown): string | null {
  try {
    return (stream as { toURL?: () => string } | null)?.toURL?.() ?? null;
  } catch {
    return null;
  }
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function CallModal() {
  const { phase, direction, peer, reason, video, micOn, camOn, speakerOn, connectedAt, localStream, remoteStream } = useCallStore();
  const insets = useSafeAreaInsets();
  const [now, setNow] = React.useState(Date.now());

  // 接通后每秒刷新计时
  React.useEffect(() => {
    if (phase !== "in-call") return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  if (phase === "idle") return null;

  const name = peer?.name || peer?.userId || "对方";
  const isIncoming = direction === "incoming";
  const showRingBtns = phase === "ringing" && isIncoming;
  /** 视频舞台：视频通话已进入连接/通话阶段 */
  const videoStage = video && (phase === "connecting" || phase === "in-call");
  const remoteUrl = streamUrl(remoteStream);
  const localUrl = streamUrl(localStream);
  const hasRemoteVideo = !!remoteUrl && !!remoteStream && remoteStream.getVideoTracks().length > 0;

  const elapsed = connectedAt ? Math.max(0, Math.floor((now - connectedAt) / 1000)) : 0;

  let statusText = "";
  switch (phase) {
    case "calling": statusText = video ? "等待接受视频邀请…" : "等待对方接听…"; break;
    case "ringing": statusText = isIncoming ? (video ? "邀请你视频通话" : "邀请你语音通话") : video ? "等待接受视频邀请…" : "等待对方接听…"; break;
    case "connecting": statusText = "正在连接…"; break;
    case "in-call": statusText = mmss(elapsed); break;
    case "ended": statusText = reason || "通话已结束"; break;
    case "rejected": statusText = reason || "已取消"; break;
    case "missed": statusText = reason || "未接来电"; break;
  }
  const isOver = phase === "ended" || phase === "rejected" || phase === "missed";

  /* 控制按钮（图标+标签，关闭态降透明底） */
  const ctrlBtn = (
    on: boolean,
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
    onPress: () => void,
  ) => (
    <TouchableOpacity style={[st.ctrl, !on && st.ctrlOff]} onPress={onPress} activeOpacity={0.75}>
      <Ionicons name={icon} size={22} color="#fff" />
      <Text style={st.ctrlLabel}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => { if (showRingBtns) rejectCall(); else hangup(); }}>
      <View style={[st.overlay, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl }]}>
        {/* 视频层 */}
        {videoStage && (
          <>
            {hasRemoteVideo ? (
              <RTCView streamURL={remoteUrl!} style={StyleSheet.absoluteFill} objectFit="cover" />
            ) : (
              <View style={StyleSheet.absoluteFill}>
                <View style={st.remotePlaceholder}>
                  <View style={st.avatarRing}>
                    <Avatar name={name} size={96} />
                  </View>
                  <Text style={st.remoteHint}>{phase === "connecting" ? "正在建立视频通道…" : "对方画面未开启"}</Text>
                </View>
              </View>
            )}
            {/* 本端画中画（关摄像头时显示头像占位），避让顶部信息区 */}
            <View style={[st.pip, { top: insets.top + 76 }]}>
              {localUrl && camOn && !!localStream && localStream.getVideoTracks().length > 0 ? (
                <RTCView streamURL={localUrl!} style={st.pipVideo} objectFit="cover" mirror />
              ) : (
                <View style={st.pipOff}>
                  <Avatar name={name} size={36} />
                  <Text style={st.pipOffText}>摄像头已关闭</Text>
                </View>
              )}
            </View>
          </>
        )}

        {/* 中部信息区：结束态头像居中；视频态名称在顶部安全区；语音态头像+名称+状态居中 */}
        {isOver ? (
          <View style={st.voiceCenter}>
            <View style={st.avatarRing}>
              <Avatar name={name} size={108} />
            </View>
            <Text style={st.name}>{name}</Text>
            <Text style={st.statusUnder}>{statusText}</Text>
          </View>
        ) : videoStage ? (
          <View style={[st.topBar, { top: insets.top + spacing.md }]} pointerEvents="none">
            <Text style={st.name}>{name}</Text>
            <Text style={st.status}>{statusText}</Text>
          </View>
        ) : (
          <View style={st.voiceCenter}>
            <View style={st.avatarRing}>
              <Avatar name={name} size={108} />
            </View>
            <Text style={st.name}>{name}</Text>
            <Text style={st.statusUnder}>{statusText}</Text>
          </View>
        )}

        {/* 底部按钮坞 */}
        <View style={[st.dock, { bottom: insets.bottom + spacing.xl }]}>
          {showRingBtns ? (
            <>
              <TouchableOpacity style={[st.round, st.danger]} onPress={rejectCall} activeOpacity={0.8}>
                <Ionicons name="close" size={30} color="#fff" />
                <Text style={st.roundLabel}>拒接</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.round, st.success]} onPress={() => void acceptCall()} activeOpacity={0.8}>
                <Ionicons name={video ? "videocam" : "call"} size={28} color="#fff" />
                <Text style={st.roundLabel}>{video ? "视频接听" : "接听"}</Text>
              </TouchableOpacity>
            </>
          ) : isOver ? (
            <TouchableOpacity style={[st.round, st.plain]} onPress={() => useCallStore.getState().reset()} activeOpacity={0.8}>
              <Ionicons name="close" size={28} color="#fff" />
              <Text style={st.roundLabel}>关闭</Text>
            </TouchableOpacity>
          ) : videoStage ? (
            <>
              <View style={st.ctrlRow}>
                {ctrlBtn(micOn, micOn ? "mic" : "mic-off", micOn ? "静音" : "已静音", toggleMic as () => void)}
                {ctrlBtn(camOn, camOn ? "videocam" : "videocam-off", camOn ? "摄像头" : "已关闭", toggleCam as () => void)}
                {ctrlBtn(speakerOn, speakerOn ? "volume-high" : "volume-low", speakerOn ? "免提开" : "免提关", toggleSpeaker as () => void)}
                {ctrlBtn(true, "camera-reverse-outline", "翻转", switchCamera)}
              </View>
              <TouchableOpacity style={st.roundDanger} onPress={hangup} activeOpacity={0.85}>
                <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
                <Text style={st.roundLabel}>挂断</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={st.ctrlRow}>
                {ctrlBtn(micOn, micOn ? "mic" : "mic-off", micOn ? "静音" : "已静音", toggleMic as () => void)}
                {ctrlBtn(speakerOn, speakerOn ? "volume-high" : "volume-low", speakerOn ? "免提开" : "免提关", toggleSpeaker as () => void)}
              </View>
              <TouchableOpacity style={st.roundDanger} onPress={hangup} activeOpacity={0.85}>
                <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
                <Text style={st.roundLabel}>挂断</Text>
              </TouchableOpacity>
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
    backgroundColor: DARK,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  /* 中部（语音/结束态） */
  voiceCenter: { alignItems: "center" },
  avatarRing: {
    padding: 5,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.16)",
    marginBottom: spacing.lg,
  },
  name: { color: "#fff", fontSize: fontSize.xxl, fontWeight: "700", letterSpacing: 0.3 },
  statusUnder: { color: ON_DARK_FAINT, fontSize: fontSize.lg, marginTop: spacing.sm, fontVariant: ["tabular-nums"], textAlign: "center" },
  status: { color: ON_DARK_FAINT, fontSize: fontSize.lg, marginTop: 2, fontVariant: ["tabular-nums"] },
  /* 视频态顶栏 */
  topBar: { position: "absolute", left: spacing.xl, right: spacing.xl, alignItems: "flex-start" },
  remotePlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  remoteHint: { color: ON_DARK_FAINT, fontSize: fontSize.sm },
  /* 本端画中画 */
  pip: {
    position: "absolute",
    right: spacing.lg,
    width: 104,
    height: 148,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: "#1B2029",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    ...elevation.md,
  },
  pipVideo: { flex: 1 },
  pipOff: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xs },
  pipOffText: { color: "rgba(255,255,255,0.65)", fontSize: 10 },
  /* 底部按钮坞 */
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    gap: spacing.xl,
  },
  round: {
    width: 88,
    height: 88,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  roundLabel: { color: "#fff", fontSize: fontSize.xs, marginTop: 4, fontWeight: "600" },
  danger: { backgroundColor: colors.danger },
  success: { backgroundColor: colors.success },
  plain: { backgroundColor: CTRL_BG },
  roundDanger: {
    width: 88,
    height: 88,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.danger,
  },
  ctrlRow: { flexDirection: "row", gap: spacing.lg },
  ctrl: {
    width: 68,
    height: 68,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CTRL_BG,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  ctrlOff: { backgroundColor: CTRL_BG_OFF },
  ctrlLabel: { color: "#fff", fontSize: 10, marginTop: 3, fontWeight: "600" },
});

const st = styles;
