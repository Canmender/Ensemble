/**
 * 桌面浏览器语音通话 —— 原生 WebRTC（无需额外依赖）
 * 信令复用云端 WS（wsClient.sendCall / onCall）。
 * 主叫 gather audio→createOffer→send；被叫接听→createAnswer；ICE 交换。
 */
import { wsClient, type CallSignal } from "./ws";
import { useCallStore, type CallPeer } from "./callStore";

/** ICE：STUN + host（同网可用）；跨公网需 TURN（可在此追加 turn 配置） */
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let remoteStream: MediaStream | null = null;
let currentPeer: CallPeer | null = null;
let isCaller = false;
let intentionalEnd = false;
let pendingOffer: string | null = null;
const pendingCandidates: unknown[] = [];
let callTimer: ReturnType<typeof setTimeout> | null = null;

function signal(kind: CallSignal["kind"], extra?: Partial<CallSignal>): void {
  if (!currentPeer?.userId) return;
  wsClient.sendCall(currentPeer.userId, { kind, ...extra });
}

async function getLocalAudio(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("浏览器不支持麦克风");
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

function clearCallTimer(): void { if (callTimer) { clearTimeout(callTimer); callTimer = null; } }

function createPC(): RTCPeerConnection {
  const peer = new RTCPeerConnection(ICE_SERVERS);
  pc = peer;
  intentionalEnd = false;
  peer.onicecandidate = (e) => { if (e.candidate) signal("candidate", { candidate: e.candidate.toJSON() }); };
  peer.ontrack = (e) => { if (e.streams?.[0]) remoteStream = e.streams[0]; };
  peer.oniceconnectionstatechange = () => {
    if (peer.iceConnectionState === "connected" || peer.iceConnectionState === "completed") useCallStore.getState().connected();
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "connected") { clearCallTimer(); useCallStore.getState().connected(); }
    else if (peer.connectionState === "failed" || peer.connectionState === "closed") { if (!intentionalEnd) handleEnded("连接已断开"); }
  };
  return peer;
}

function attachLocalAudio(peer: RTCPeerConnection): void {
  if (!localStream) return;
  for (const t of localStream.getTracks()) peer.addTrack(t, localStream);
}

function release(): void {
  intentionalEnd = true; clearCallTimer();
  try { localStream?.getTracks().forEach((t) => t.stop()); } catch {}
  try { pc?.close(); } catch {}
  localStream = null; remoteStream = null; pc = null; currentPeer = null; isCaller = false;
  pendingCandidates.length = 0;
}

function handleEnded(reason?: string): void {
  const phase = useCallStore.getState().phase;
  const wasMissed = !intentionalEnd && (phase === "ringing" || phase === "calling");
  release();
  useCallStore.getState().ended(wasMissed ? (reason || "对方未接听") : (reason || "通话已结束"));
}

function startCallTimer(): void {
  clearCallTimer();
  callTimer = setTimeout(() => { signal("hangup"); handleEnded("对方未接听"); }, 45000);
}

export async function startCall(peer: CallPeer): Promise<void> {
  const st = useCallStore.getState();
  if (st.phase !== "idle" && st.phase !== "ended") return;
  release(); pendingOffer = null; currentPeer = peer; isCaller = true;
  st.startCall(peer);
  try {
    localStream = await getLocalAudio();
    if (!currentPeer) return;
    const peerConn = createPC(); attachLocalAudio(peerConn);
    const offer = await peerConn.createOffer(); await peerConn.setLocalDescription(offer);
    signal("offer", { sdp: offer.sdp });
    st.ringing(); startCallTimer();
  } catch { handleEnded("无法获取麦克风"); }
}

export function onIncomingOffer(fromUserId: string, fromName: string | undefined, call: CallSignal): void {
  const st = useCallStore.getState();
  if (st.phase !== "idle" && st.phase !== "ended") {
    currentPeer = { userId: fromUserId, name: fromName }; signal("reject"); currentPeer = null; return;
  }
  release(); currentPeer = { userId: fromUserId, name: fromName }; isCaller = false;
  pendingOffer = call.sdp ?? null;
  st.incoming(currentPeer); startCallTimer();
}

export async function acceptCall(): Promise<void> {
  const peer = useCallStore.getState().peer;
  if (!peer || !pendingOffer) return;
  try {
    clearCallTimer(); useCallStore.getState().connecting();
    localStream = await getLocalAudio();
    if (!currentPeer) return;
    const peerConn = createPC(); attachLocalAudio(peerConn);
    await peerConn.setRemoteDescription({ type: "offer", sdp: pendingOffer });
    for (const c of pendingCandidates) { try { await peerConn.addIceCandidate(c as RTCIceCandidateInit); } catch {} }
    pendingCandidates.length = 0;
    const answer = await peerConn.createAnswer(); await peerConn.setLocalDescription(answer);
    signal("answer", { sdp: answer.sdp });
  } catch { handleEnded("接听失败"); }
}

export function rejectCall(): void { signal("reject"); release(); useCallStore.getState().ended("对方已拒接"); }
export function hangup(): void { signal("hangup"); handleEnded(); }

export async function handleSignal(msg: { fromUserId: string; fromName?: string; call: CallSignal }): Promise<void> {
  const { fromUserId, fromName, call } = msg;
  if (!call) return;
  switch (call.kind) {
    case "offer": onIncomingOffer(fromUserId, fromName, call); break;
    case "answer":
      if (pc && isCaller && call.sdp) {
        try {
          await pc.setRemoteDescription({ type: "answer", sdp: call.sdp });
          for (const c of pendingCandidates) { try { await pc.addIceCandidate(c as RTCIceCandidateInit); } catch {} }
          pendingCandidates.length = 0;
        } catch {}
      }
      break;
    case "candidate":
      if (pc && !intentionalEnd) {
        try { await pc.addIceCandidate(call.candidate as RTCIceCandidateInit); }
        catch { pendingCandidates.push(call.candidate); }
      } else if (!intentionalEnd) { pendingCandidates.push(call.candidate); }
      break;
    case "reject": if (isCaller) handleEnded("对方已拒接"); break;
    case "hangup": handleEnded("对方已挂断"); break;
  }
}

let bootstrapped = false;
export function bootstrapCallService(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  wsClient.onCall((msg) => { void handleSignal(msg); });
}
