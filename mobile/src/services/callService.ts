/**
 * 语音通话服务 —— WebRTC + 云端 WS 信令
 *
 * 流程：
 *  主叫：拉麦克风 → 建 PC → 加本地音频 → createOffer → setLocal → 经 wsLink 发 offer
 *  被叫：收到 offer → 响铃 → 接听：拉麦克风 → 建 PC → setRemote(offer) → createAnswer → setLocal → 回 answer
 *  ICE：双方 onicecandidate → 发 candidate → 对端 addIceCandidate
 *  远端音频：ontrack 收到远端流后由原生自动播放（不渲染视频）
 *  挂断：任一方发 hangup → 关 PC / release 流
 */
import { Platform, PermissionsAndroid } from "react-native";
import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, mediaDevices, registerGlobals, type MediaStream, type MediaStreamTrack } from "react-native-webrtc";
import { wsLink, type CallSignal, type IncomingCallSignal } from "./wslink";
import { useCallStore, type CallPeer } from "../store/callStore";

registerGlobals();

/** WebRTC ICE 服务器：先 STUN + host（同网/部分NAT可通）；TURN 见部署说明 */
const ICE_SERVERS = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

/** 本端 userId/name（由会话页发起时传入） */
let selfUserId = "";
let selfName = "";

/** 当前活跃的 peer connection 与本地流 */
let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let currentPeer: CallPeer | null = null;
/** 是否为主叫方 */
let isCaller = false;

/** 已加远程音频轨道（避免同轨重复 onice/播放干扰） */
let remoteAudioAdded = false;

/** 信令事件处理器（由 App 根部挂载）—— 解耦避免 wsLink 与 service 循环引用 */
export type SignalHandler = (fromUserId: string, fromName: string | undefined, call: CallSignal) => void;

/** 发送信令 */
function signal(kind: CallSignal["kind"], extra?: Partial<CallSignal>): void {
  if (!currentPeer?.userId) return;
  wsLink.sendCall(currentPeer.userId, { kind, ...extra });
}

/** 拉取本地麦克风音频流（Android 先请求录音权限） */
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
      // 其余异常（如权限 API 不可用）交由 getUserMedia 内部处理
    }
  }
return mediaDevices.getUserMedia({ audio: true });
}

/** 新建 PC 并绑定事件 */
function createPC(): RTCPeerConnection {
  const peer = new RTCPeerConnection(ICE_SERVERS);
  pc = peer;
  remoteAudioAdded = false;

  peer.onicecandidate = (event: { candidate?: { candidate?: string; toJSON: () => unknown } | null }) => {
    // RTCIceCandidateEvent.candidate（toJSON 序列化后经信令转发）
    if (event.candidate && event.candidate.candidate) {
      signal("candidate", { candidate: (event.candidate as { toJSON: () => unknown }).toJSON() });
    }
  };
  peer.ontrack = (event: { streams?: MediaStream[] }) => {
    // 远端音频轨道到达；原生会路由到扬声器播放（语音无需渲染）
    if (event.streams && event.streams.length > 0) {
      remoteAudioAdded = true;
    }
  };
  peer.onconnectionstatechange = (arg: unknown) => {
    const st = peer.connectionState;
    if (st === "connected") {
      useCallStore.getState().connected();
    } else if (st === "failed" || st === "closed" || st === "disconnected") {
      if (st !== "disconnected") handleEnded("连接已断开");
    }
  };
  peer.oniceconnectionstatechange = (arg: unknown) => {
    const st = peer.iceConnectionState;
    if (st === "connected" || st === "completed") {
      useCallStore.getState().connected();
    }
  };
  return peer;
}

/** 加入本地音频到 PC */
function attachLocalAudio(peer: RTCPeerConnection): void {
  if (!localStream) return;
  const tracks = localStream.getAudioTracks();
  for (const t of tracks) {
    peer.addTrack(t, localStream);
  }
}

/** 释放资源 */
function release(): void {
  try { localStream?.getTracks().forEach((t: MediaStreamTrack) => t.stop()); } catch {}
  try { localStream?.release(); } catch {}
  try { pc?.close(); } catch {}
  localStream = null;
  pc = null;
  currentPeer = null;
  isCaller = false;
}

/** 挂断本地 */
function handleEnded(reason?: string): void {
  release();
  useCallStore.getState().ended(reason);
}

/** 主叫发起 */
export async function startCall(peer: CallPeer): Promise<void> {
  const st = useCallStore.getState();
  if (st.phase !== "idle" && st.phase !== "ended") return;
  release();
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
  } catch (e) {
    handleEnded(e instanceof Error ? "无法获取麦克风/发起失败" : "发起失败");
  }
}

/** 被叫：收到 offer，进入响铃；由 UI 决定接听/拒接 */
export function onIncomingOffer(fromUserId: string, fromName: string | undefined, call: CallSignal): void {
  const st = useCallStore.getState();
  // 若正在通话或响铃，忽略新的呼入
  if (st.phase === "in-call" || st.phase === "calling" || st.phase === "ringing") {
    // 回拒接
    currentPeer = { userId: fromUserId, name: fromName };
    signal("reject");
    currentPeer = null;
    return;
  }
  release();
  currentPeer = { userId: fromUserId, name: fromName };
  isCaller = false;
  st.incoming(currentPeer);
  // 暂存 offer 供接听使用
  pendingOffer = call.sdp ?? null;
}

let pendingOffer: string | null = null;

/** 被叫：接听 */
export async function acceptCall(): Promise<void> {
  const peer = useCallStore.getState().peer;
  if (!peer) return;
  try {
    useCallStore.getState().accepted();
    localStream = await getLocalAudio();
    if (!currentPeer) return;
    const peerConn = createPC();
    attachLocalAudio(peerConn);
    if (pendingOffer) {
      await peerConn.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: pendingOffer }));
    }
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

/** 主叫/被叫：挂断 */
export function hangup(): void {
  signal("hangup");
  handleEnded();
}

/** 设置本机身份（会话页发起时调用） */
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
        await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: call.sdp }));
      }
      break;
    case "candidate":
      if (pc && call.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(call.candidate));
        } catch { /* 忽略候选时序问题 */ }
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

/** 当前是否在通话中（供抽屉控制全局状态/通知） */
export function isInCall(): boolean {
  const phase = useCallStore.getState().phase;
  return phase === "in-call" || phase === "calling" || phase === "ringing" || phase === "connecting";
}

/** 挂载信令监听（App 登录后调用一次）—— 把 wsLink 收到的通话信令路由到 callService */
let bootstrapped = false;
export function bootstrapCallService(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  wsLink.on({
    onCall: (msg) => {
      void handleSignal(msg);
    },
  });
}

/** 设置并更新本机身份（登录/登录后调用） */
export function setCallIdentityAndReload(userId: string, name?: string): void {
  setCallIdentity(userId, name);
}