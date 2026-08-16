/**
 * 语音通话服务 —— WebRTC + 云端 WS 信令
 *
 * 流程：主叫拉麦克风→建PC→createOffer→setLocal→发offer；被叫响铃→接听→setRemote(offer)→createAnswer→回answer；
 *       ICE 双向经信令交换；远端音频由原生自动播放；挂断/拒接经信令通知对端。
 */
import { Platform, PermissionsAndroid } from "react-native";
import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, mediaDevices, registerGlobals, type MediaStream, type MediaStreamTrack } from "react-native-webrtc";
import { wsLink, type CallSignal, type IncomingCallSignal } from "./wslink";
import { useCallStore, type CallPeer } from "../store/callStore";

registerGlobals();

/** ICE 服务器：STUN（同网/友好NAT可通）；如需公网跨运营商互通请部署 TURN，并在此追加 { urls: "turn:...", username, credential } */
const ICE_SERVERS = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

/** 当前活跃的 peer connection 与本地流 */
let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let currentPeer: CallPeer | null = null;
/** 本端 userId/name */
let selfUserId = "";
let selfName = "";
/** 主叫方 */
let isCaller = false;
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

/** 拉取本地麦克风（Android 先请求录音权限） */
async function getLocalAudio(): Promise<MediaStream> {
  if (Platform.OS === "android") {
    try {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
        title: "语音通话需要麦克风",
        message: "合鸣语音通话需要使用你的麦克风，以便在通话中发送你的声音。",
        buttonPositive: "允许",
        buttonNegative: "拒绝",
      });
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        throw new Error("未授予麦克风权限");
      }
    } catch (e) {
      if (e instanceof Error && e.message === "未授予麦克风权限") throw e;
    }
  }
  return mediaDevices.getUserMedia({ audio: true });
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
    // 远端音频流到达后原生自动播放；保留引用防 GC
    void event.streams;
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

/** 加入本地音频到 PC */
function attachLocalAudio(peer: RTCPeerConnection): void {
  if (!localStream) return;
  const tracks = localStream.getAudioTracks();
  for (const t of tracks) peer.addTrack(t, localStream);
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
  pendingCandidates.length = 0;
}

/** 更新 store 为结束态并释放 */
function handleEnded(reason?: string): void {
  const phase = useCallStore.getState().phase;
  const wasMissed = !intentionalEnd && (phase === "ringing" || phase === "calling");
  release();
  useCallStore.getState().ended(wasMissed ? (reason || "对方未接听") : (reason || "通话已结束"));
}

/** 主叫发起 */
export async function startCall(peer: CallPeer): Promise<void> {
  const st = useCallStore.getState();
  if (st.phase !== "idle" && st.phase !== "ended") return;
  release();
  pendingOffer = null;
  currentPeer = peer;
  isCaller = true;
  st.startCall(peer);
  try {
    localStream = await getLocalAudio();
    if (!currentPeer) return;
    const peerConn = createPC();
    attachLocalAudio(peerConn);
    const offer = await peerConn.createOffer();
    await peerConn.setLocalDescription(offer);
    signal("offer", { sdp: offer.sdp });
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
  st.incoming(currentPeer);
  startCallTimer("对方未接听");
}

/** 被叫：接听 */
export async function acceptCall(): Promise<void> {
  const peer = useCallStore.getState().peer;
  if (!peer || !pendingOffer) return;
  try {
    clearCallTimer();
    useCallStore.getState().accepted();
    localStream = await getLocalAudio();
    if (!currentPeer) return;
    const peerConn = createPC();
    attachLocalAudio(peerConn);
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