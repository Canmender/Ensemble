/**
 * 通话服务 —— WebRTC + 云端 WS 信令（语音 / 视频）
 *
 * 流程：主叫拉媒体→建PC→createOffer→setLocal→发offer（视频通话随 offer 带 video:true）；
 *       被叫响铃→接听→按 offer 类型拉媒体→setRemote(offer)→createAnswer→回answer；
 *       ICE 双向经信令交换；远端流经 callStore 供 CallModal 渲染 RTCView；挂断/拒接经信令通知对端。
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

/** 请求单个 Android 权限 */
async function ensurePermission(permission: typeof PermissionsAndroid.PERMISSIONS.RECORD_AUDIO | typeof PermissionsAndroid.PERMISSIONS.CAMERA, title: string, message: string): Promise<void> {
  if (Platform.OS !== "android") return;
  const granted = await PermissionsAndroid.request(permission, { title, message, buttonPositive: "允许", buttonNegative: "拒绝" });
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error(`未授予${title.replace(/^.*需要/, "")}权限`);
  }
}

/** 拉取本地媒体（音频必需；视频通话再拉摄像头，失败自动降级为语音） */
async function getLocalMedia(wantVideo: boolean): Promise<{ stream: MediaStream; video: boolean }> {
  if (Platform.OS === "android") {
    await ensurePermission(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      "通话需要麦克风",
      "合鸣通话需要使用你的麦克风，以便在通话中发送你的声音。",
    );
    if (wantVideo) {
      await ensurePermission(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        "视频通话需要摄像头",
        "合鸣视频通话需要使用你的摄像头，以便在通话中发送你的画面。",
      );
    }
  }
  try {
    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: wantVideo ? { facingMode: "user" } : false,
    });
    return { stream, video: wantVideo };
  } catch (e) {
    if (!wantVideo) throw e;
    // 摄像头不可用（拒绝/被占用/无摄像头）→ 降级为语音通话，同步 store 状态
    useCallStore.getState().setVideo(false);
    useCallStore.getState().setCamOn(false);
    const stream = await mediaDevices.getUserMedia({ audio: true });
    return { stream, video: false };
  }
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
  const phase = useCallStore.getState().phase;
  const wasMissed = !intentionalEnd && (phase === "ringing" || phase === "calling");
  release();
  useCallStore.getState().ended(wasMissed ? (reason || "对方未接听") : (reason || "通话已结束"));
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
    const peerConn = createPC();
    attachLocalMedia(peerConn);
    const offer = await peerConn.createOffer();
    await peerConn.setLocalDescription(offer);
    signal("offer", { sdp: offer.sdp, video: pendingVideo || undefined });
    st.ringing();
    startCallTimer("对方未接听");
  } catch (e) {
    handleEnded(e instanceof Error ? "无法获取麦克风/发起失败" : "发起失败");
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
    handleEnded("接听失败");
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
