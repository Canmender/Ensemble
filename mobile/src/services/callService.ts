/**
 * 通话服务 —— WebRTC + 云端 WS 信令（语音 / 视频）
 *
 * 流程：主叫拉媒体→建PC→createOffer→setLocal→发offer（视频通话随 offer 带 video:true）；
 *       被叫响铃→接听→按 offer 类型拉媒体→setRemote(offer)→createAnswer→回answer；
 *       ICE 双向经信令交换；远端流经 callStore 供 CallModal 渲染 RTCView；挂断/拒接经信令通知对端。
 *
 * 音频路由：接通后交给 react-native-incall-manager（听筒/免提切换 + 距离传感器灭屏）；
 *           视频默认免提，语音默认听筒；库缺失或异常时静默降级为系统默认路由。
 */
import { Platform, PermissionsAndroid } from "react-native";
import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, mediaDevices, registerGlobals, type MediaStream, type MediaStreamTrack } from "react-native-webrtc";
import { wsLink, type CallSignal, type IncomingCallSignal } from "./wslink";
import { useCallStore, type CallPeer } from "../store/callStore";

registerGlobals();

// ICE 服务器由 gitignore 的 server.config.js 提供（TURN 凭据不在仓库内；缺省 STUN + host）
function buildIceServers() {
  const servers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
    { urls: "stun:stun.l.google.com:19302" },
  ];
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require("../../server.config") as {
      turn?: { urls: string | string[]; username?: string; credential?: string };
    };
    if (cfg?.turn?.urls) {
      servers.push({ urls: cfg.turn.urls, username: cfg.turn.username, credential: cfg.turn.credential });
    }
  } catch {
    /* 无 server.config.js（干净检出）时仅 STUN */
  }
  return { iceServers: servers };
}
const ICE_SERVERS = buildIceServers();

/** 音频采集约束：显式开启回声消除/降噪/自动增益（不依赖设备默认值；标准键名 libwebrtc 可识别） */
const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
} as const;
// react-native-webrtc 的类型只声明了视频约束字段，音频高级约束需断言传入
const audioConstraints = AUDIO_CONSTRAINTS as unknown as boolean;

/** incall-manager 特性探测：库缺失/新架构不可用时全部操作静默降级 */
interface InCallLike {
  start(opts: { media: "audio" | "video"; auto?: boolean }): void;
  stop(): void;
  setSpeakerphoneOn(on: boolean): void;
}
let incall: InCallLike | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  incall = require("react-native-incall-manager").default as InCallLike;
} catch {
  incall = null;
}

/** 当前活跃的 peer connection 与本地流 */
let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let currentPeer: CallPeer | null = null;
/** 本端 userId/name */
let selfUserId = "";
let selfName = "";
/** 主叫方 */
let isCaller = false;
/** 本次通话是否为视频（主叫随 offer 发出；被叫自 offer 读出） */
let pendingVideo = false;
/** 是否已主动释放（避免 pc.close() 触发的 connected 关闭事件错误地把结束原因覆盖） */
let intentionalEnd = false;
/** 暂存的 incoming offer.sdp（接听时用） */
let pendingOffer: string | null = null;
/** 因 pc 尚未建好/未设远端描述而缓存的 ICE candidate */
const pendingCandidates: unknown[] = [];
/** 呼叫/响铃超时（无应答自动挂断） */
let callTimer: ReturnType<typeof setTimeout> | null = null;

/** 发送信令 */
function signal(kind: CallSignal["kind"], extra?: Partial<CallSignal>): void {
  if (!currentPeer?.userId) return;
  wsLink.sendCall(currentPeer.userId, { kind, ...extra });
}

/** 请求 Android 权限，返回是否授予 */
async function requestPerm(permission: typeof PermissionsAndroid.PERMISSIONS.RECORD_AUDIO | typeof PermissionsAndroid.PERMISSIONS.CAMERA, title: string, message: string): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const granted = await PermissionsAndroid.request(permission, { title, message, buttonPositive: "允许", buttonNegative: "拒绝" });
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * 拉取本地媒体。音频必需（麦克风被拒则抛错）；摄像头被拒/不可用/无视频轨时
 * 自动降级为语音并同步 store 状态，绝不因摄像头问题让整通电话失败。
 */
async function getLocalMedia(wantVideo: boolean): Promise<{ stream: MediaStream; video: boolean }> {
  let video = wantVideo;
  if (Platform.OS === "android") {
    const micOk = await requestPerm(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      "通话需要麦克风",
      "合鸣通话需要使用你的麦克风，以便在通话中发送你的声音。",
    );
    if (!micOk) throw new Error("未授予麦克风权限");
    if (video) {
      const camOk = await requestPerm(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        "视频通话需要摄像头",
        "合鸣视频通话需要使用你的摄像头，以便在通话中发送你的画面。",
      );
      if (!camOk) video = false; // 拒绝摄像头 → 降级语音，不失败
    }
  }
  try {
    const stream = await mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: video ? { facingMode: "user" } : false,
    });
    if (video && stream.getVideoTracks().length === 0) {
      // 设备无可用摄像头：释放并降级语音
      try { stream.getTracks().forEach((t: MediaStreamTrack) => t.stop()); } catch {}
      try { stream.release(); } catch {}
      video = false;
      const audioOnly = await mediaDevices.getUserMedia({ audio: audioConstraints });
      degradeToAudio();
      return { stream: audioOnly, video: false };
    }
    if (!video && wantVideo) degradeToAudio();
    return { stream, video };
  } catch (e) {
    if (!video) throw e;
    // 摄像头打开失败（被占用/底层错误）→ 降级语音重取
    degradeToAudio();
    const audioOnly = await mediaDevices.getUserMedia({ audio: audioConstraints });
    return { stream: audioOnly, video: false };
  }
}

/** 摄像头降级时同步 store（UI 回到语音布局） */
function degradeToAudio(): void {
  const st = useCallStore.getState();
  st.setVideo(false);
  st.setCamOn(false);
}

/** 接通前启动音频路由管理（听筒/免提 + 距离传感器灭屏） */
function beginAudioRouting(video: boolean): void {
  try {
    incall?.start({ media: video ? "video" : "audio", auto: true });
    incall?.setSpeakerphoneOn(video);
  } catch {}
}

/** 结束时停止音频路由管理 */
function endAudioRouting(): void {
  try { incall?.stop(); } catch {}
}

/** 停止待接听超时定时器 */
function clearCallTimer(): void {
  if (callTimer) { clearTimeout(callTimer); callTimer = null; }
}

/** 新建 PC 并绑定事件 */
function createPC(): RTCPeerConnection {
  const peer = new RTCPeerConnection(ICE_SERVERS);
  pc = peer;
  intentionalEnd = false;

  peer.onicecandidate = (event: { candidate?: { candidate?: string; toJSON: () => unknown } | null }) => {
    if (event.candidate && event.candidate.candidate) {
      signal("candidate", { candidate: (event.candidate as { toJSON: () => unknown }).toJSON() });
    }
  };
  peer.ontrack = (event: { streams?: MediaStream[] }) => {
    // 远端流交给 store，CallModal 用 RTCView 渲染（音频由原生自动播放）
    const stream = event.streams?.[0];
    if (stream) useCallStore.getState().setMedia({ remoteStream: stream });
  };
  peer.oniceconnectionstatechange = (arg: unknown) => {
    const st = peer.iceConnectionState;
    if (st === "connected" || st === "completed") useCallStore.getState().connected();
  };
  peer.onconnectionstatechange = (arg: unknown) => {
    const st = peer.connectionState;
    if (st === "connected") {
      clearCallTimer();
      useCallStore.getState().connected();
    } else if ((st === "failed" || st === "closed" || st === "disconnected") && !intentionalEnd) {
      if (st === "failed" || st === "closed") handleEnded("连接已断开");
    }
  };
  return peer;
}

/** 加入本地媒体到 PC */
function attachLocalMedia(peer: RTCPeerConnection): void {
  if (!localStream) return;
  for (const t of localStream.getTracks()) peer.addTrack(t, localStream);
}

/** 释放资源（不触发结束回调） */
function release(): void {
  intentionalEnd = true;
  clearCallTimer();
  endAudioRouting();
  try { localStream?.getTracks().forEach((t: MediaStreamTrack) => t.stop()); } catch {}
  try { localStream?.release(); } catch {}
  try { pc?.close(); } catch {}
  localStream = null;
  pc = null;
  currentPeer = null;
  isCaller = false;
  pendingVideo = false;
  pendingCandidates.length = 0;
  useCallStore.getState().setMedia({ localStream: null, remoteStream: null });
}

/** 更新 store 为结束态并释放 */
function handleEnded(reason?: string): void {
  const s = useCallStore.getState();
  const phase = s.phase;
  // 只有「来电响铃中被对端取消」才算未接来电；外呼超时是"无人接听"，不是 missed
  const wasMissed = !intentionalEnd && phase === "ringing" && s.direction === "incoming";
  release();
  useCallStore.getState().ended(wasMissed ? (reason || "对方取消了呼叫") : (reason || "通话已结束"));
}

/** 主叫发起（opts.video 为 true 时发起视频通话） */
export async function startCall(peer: CallPeer, opts?: { video?: boolean }): Promise<void> {
  const st = useCallStore.getState();
  if (st.phase !== "idle" && st.phase !== "ended") return;
  release();
  pendingOffer = null;
  currentPeer = peer;
  isCaller = true;
  pendingVideo = !!opts?.video;
  st.startCall(peer, pendingVideo);
  try {
    const got = await getLocalMedia(pendingVideo);
    localStream = got.stream;
    pendingVideo = got.video;
    if (got.video) useCallStore.getState().setMedia({ localStream: localStream });
    else useCallStore.getState().setVideo(false); // 摄像头降级 → 呼叫方 UI 回到语音态
    if (!currentPeer) return;
    beginAudioRouting(got.video);
    const peerConn = createPC();
    attachLocalMedia(peerConn);
    const offer = await peerConn.createOffer();
    await peerConn.setLocalDescription(offer);
    signal("offer", { sdp: offer.sdp, video: pendingVideo || undefined });
    st.ringing();
    startCallTimer("对方未接听");
  } catch (e) {
    handleEnded(e instanceof Error && e.message.includes("麦克风") ? "未授予麦克风权限" : "无法获取麦克风/发起失败");
  }
}

/** 呼叫/响铃超时 */
function startCallTimer(missedReason?: string): void {
  clearCallTimer();
  callTimer = setTimeout(() => {
    signal("hangup");
    handleEnded(missedReason);
  }, 45000); // 45s 无人接听则自动挂断
}

/** 被叫：收到 offer，进入响铃 */
export function onIncomingOffer(fromUserId: string, fromName: string | undefined, call: CallSignal): void {
  const st = useCallStore.getState();
  if (st.phase === "in-call" || st.phase === "calling" || st.phase === "ringing" || st.phase === "connecting") {
    // 忙碌：拒接新的呼入
    currentPeer = { userId: fromUserId, name: fromName };
    signal("reject");
    currentPeer = null;
    return;
  }
  release();
  currentPeer = { userId: fromUserId, name: fromName };
  isCaller = false;
  pendingOffer = call.sdp ?? null;
  pendingVideo = !!call.video;
  st.incoming(currentPeer, pendingVideo);
  startCallTimer("对方未接听");
}

/** 被叫：接听 */
export async function acceptCall(): Promise<void> {
  const peer = useCallStore.getState().peer;
  if (!peer || !pendingOffer) return;
  try {
    clearCallTimer();
    useCallStore.getState().accepted();
    const got = await getLocalMedia(pendingVideo);
    localStream = got.stream;
    if (got.video) useCallStore.getState().setMedia({ localStream: localStream });
    if (!currentPeer) return;
    beginAudioRouting(useCallStore.getState().video);
    const peerConn = createPC();
    attachLocalMedia(peerConn);
    await peerConn.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: pendingOffer }));
    // 补投接听前缓存的候选
    for (const c of pendingCandidates) {
      try { await peerConn.addIceCandidate(new RTCIceCandidate(c as never)); } catch {}
    }
    pendingCandidates.length = 0;
    const answer = await peerConn.createAnswer();
    await peerConn.setLocalDescription(answer);
    signal("answer", { sdp: answer.sdp });
  } catch (e) {
    handleEnded(e instanceof Error && e.message.includes("麦克风") ? "未授予麦克风权限" : "接听失败");
  }
}

/** 被叫：拒接 */
export function rejectCall(): void {
  signal("reject");
  release();
  useCallStore.getState().ended("对方已拒接");
}

/** 挂断 */
export function hangup(): void {
  signal("hangup");
  handleEnded();
}

/** 静音/取消静音麦克风，返回切换后的状态 */
export function toggleMic(): boolean {
  const next = !useCallStore.getState().micOn;
  if (localStream) {
    for (const t of localStream.getAudioTracks()) {
      try { t.enabled = next; } catch {}
    }
  }
  useCallStore.getState().setMicOn(next);
  return next;
}

/** 开/关摄像头（视频通话），返回切换后的状态 */
export function toggleCam(): boolean {
  const next = !useCallStore.getState().camOn;
  if (localStream) {
    for (const t of localStream.getVideoTracks()) {
      try { t.enabled = next; } catch {}
    }
  }
  useCallStore.getState().setCamOn(next);
  return next;
}

/** 免提（扬声器）/听筒切换，返回切换后的状态 */
export function toggleSpeaker(): boolean {
  const next = !useCallStore.getState().speakerOn;
  try { incall?.setSpeakerphoneOn(next); } catch {}
  useCallStore.getState().setSpeakerOn(next);
  return next;
}

/** 前后摄像头切换（视频通话） */
export function switchCamera(): void {
  const track = localStream?.getVideoTracks()[0] as unknown as { _switchCamera?: () => void } | undefined;
  try { track?._switchCamera?.(); } catch {}
}

/** 设置本机身份 */
export function setCallIdentity(userId: string, name?: string): void {
  selfUserId = userId;
  selfName = name ?? selfName;
}

/** 处理来自服务端的通话信令 */
export async function handleSignal(msg: IncomingCallSignal): Promise<void> {
  const { fromUserId, fromName, call } = msg;
  if (!call) return;

  switch (call.kind) {
    case "offer":
      onIncomingOffer(fromUserId, fromName, call);
      break;
    case "answer":
      if (pc && isCaller && call.sdp) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: call.sdp }));
          // answer 就绪后补投缓存候选
          for (const c of pendingCandidates) {
            try { await pc.addIceCandidate(new RTCIceCandidate(c as never)); } catch {}
          }
          pendingCandidates.length = 0;
        } catch { /* 时序异常，忽略 */ }
      }
      break;
    case "candidate":
      if (pc && !intentionalEnd) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(call.candidate as never));
        } catch {
          // 远端描述尚未就绪 → 缓存稍后补投
          pendingCandidates.push(call.candidate as never);
        }
      } else if (!intentionalEnd) {
        pendingCandidates.push(call.candidate);
      }
      break;
    case "reject":
      if (isCaller) handleEnded("对方已拒接");
      break;
    case "hangup":
      handleEnded("对方已挂断");
      break;
    default:
      break;
  }
}

/** 是否在通话中 */
export function isInCall(): boolean {
  const phase = useCallStore.getState().phase;
  return phase === "in-call" || phase === "calling" || phase === "ringing" || phase === "connecting";
}

/** 挂载信令监听（App 登录后调用一次） */
let bootstrapped = false;
export function bootstrapCallService(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  wsLink.on({
    onCall: (msg) => { void handleSignal(msg); },
  });
}

/** 设置并更新本机身份 */
export function setCallIdentityAndReload(userId: string, name?: string): void {
  setCallIdentity(userId, name);
}
